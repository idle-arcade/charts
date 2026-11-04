import type { Config, Result, Snapshot } from './types.ts';

export function effortInsights(result: Result, config: Config) {
  const phase = config.dimensions.find((d) => d.key === 'phase');
  const phases = [
    ...new Set([
      ...(phase?.order ?? []),
      ...(result.aggregates.phase ?? []).map((row) => row.category),
    ]),
  ];
  const disciplines = (result.aggregates.discipline ?? []).map(
    (row) => row.category,
  );
  const heatmap = disciplines.flatMap((discipline) =>
    phases.map((phase) => ({
      discipline,
      phase,
      hours: result.included
        .filter(
          (row) =>
            row.categories.discipline === discipline &&
            row.categories.phase === phase,
        )
        .reduce((sum, row) => sum + row.hours, 0),
    })),
  );
  const stages = ['person', 'discipline', 'usecase'];
  const nodes = stages.flatMap((stage, depth) =>
    (result.aggregates[stage] ?? []).map((row) => ({
      id: `${stage}:${row.category}`,
      category: row.category,
      stage,
      depth,
      hours: row.hours,
    })),
  );
  const pairs = new Map<
    string,
    { source: string; target: string; value: number }
  >();
  for (const row of result.included) {
    if (row.hours === 0 || stages.some((stage) => !row.categories[stage]))
      continue;
    for (let i = 0; i < stages.length - 1; i++) {
      const source = `${stages[i]}:${row.categories[stages[i]]}`;
      const target = `${stages[i + 1]}:${row.categories[stages[i + 1]]}`;
      const key = JSON.stringify([source, target]);
      const link = pairs.get(key) ?? { source, target, value: 0 };
      link.value += row.hours;
      pairs.set(key, link);
    }
  }
  return {
    heatmap,
    phases,
    disciplines,
    sankey: { nodes, links: [...pairs.values()] },
  };
}

// Use GitHub's actual latest closing timestamp, never a history inferred from saved reports.
export function weeklyCompletions(snapshot: Snapshot, sprintId?: string) {
  const parents = new Set(
    snapshot.items.flatMap((item) =>
      item.issue?.parentId ? [item.issue.parentId] : [],
    ),
  );
  const seen = new Set<string>();
  const issues: { id: string; url: string; closedAt: string; week: string }[] =
    [];
  for (const item of snapshot.items) {
    const issue = item.issue;
    if (!issue || seen.has(issue.id)) continue;
    seen.add(issue.id);
    if (
      issue.subIssueCount ||
      parents.has(issue.id) ||
      (sprintId && item.sprint?.id !== sprintId)
    )
      continue;
    if (
      issue.state !== 'CLOSED' ||
      issue.stateReason !== 'COMPLETED' ||
      !issue.closedAt
    )
      continue;
    const timestamp = new Date(issue.closedAt);
    if (!Number.isFinite(timestamp.valueOf()))
      throw new Error(`Invalid GitHub closing date: ${issue.url}`);
    const localDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(timestamp);
    const monday = new Date(`${localDate}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    issues.push({
      id: issue.id,
      url: issue.url,
      closedAt: issue.closedAt,
      week: monday.toISOString().slice(0, 10),
    });
  }
  issues.sort(
    (a, b) => a.closedAt.localeCompare(b.closedAt) || a.id.localeCompare(b.id),
  );
  const counts = new Map<string, number>();
  for (const issue of issues)
    counts.set(issue.week, (counts.get(issue.week) ?? 0) + 1);
  const weeks: { week: string; count: number }[] = [];
  if (issues.length) {
    const first = new Date(`${issues[0].week}T00:00:00Z`);
    const cutoffDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(snapshot.fetchedAt));
    const last = new Date(`${cutoffDate}T00:00:00Z`);
    for (
      const date = first;
      date <= last;
      date.setUTCDate(date.getUTCDate() + 7)
    ) {
      const week = date.toISOString().slice(0, 10);
      weeks.push({ week, count: counts.get(week) ?? 0 });
    }
  }
  return {
    timezone: 'Europe/Berlin',
    definition:
      'Currently completed leaf issues on the current board, grouped by their latest GitHub closing timestamp. Each issue counts once. This does not reconstruct former board membership or count repeated completion events.',
    weeks,
    issues,
  };
}
