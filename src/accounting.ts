import type { Config, Diagnostic, Effort, Result, Snapshot } from './types.ts';

export function account(
  snapshot: Snapshot,
  config: Config,
  sprintId?: string,
  log: (text: string) => void = console.warn,
): Result {
  const diagnostics: Diagnostic[] = [];
  const included: Effort[] = [];
  const seen = new Set<string>();
  const parentIds = new Set(
    snapshot.items.flatMap((item) =>
      item.issue?.parentId ? [item.issue.parentId] : [],
    ),
  );
  for (const item of snapshot.items) {
    const issue = item.issue;
    const warn = (code: string, message: string) => {
      diagnostics.push({ itemId: item.id, url: issue?.url, code, message });
      log(`[${code}] ${issue?.url ?? item.id}: ${message}`);
    };
    if (!issue) {
      warn(
        'unsupported-item',
        `Skipping ${item.type}; only accessible issues are counted.`,
      );
      continue;
    }
    if (seen.has(issue.id)) {
      warn('duplicate', 'Skipping duplicate project entry for this issue.');
      continue;
    }
    seen.add(issue.id);
    // Parent totals roll up children. Never substitute a parent when a child is missing or invalid.
    if (issue.subIssueCount > 0 || parentIds.has(issue.id)) {
      warn(
        'parent-rollup',
        'Skipping parent total; only leaf issue hours count.',
      );
      continue;
    }
    if (sprintId && item.sprint?.id !== sprintId) continue;
    let valid = true;
    if (item.hours === null || !Number.isFinite(item.hours) || item.hours < 0) {
      warn(
        'invalid-hours',
        'Missing, negative, or non-finite Actual Hours; skipping issue.',
      );
      valid = false;
    }
    if (issue.assignees.length !== 1) {
      warn(
        'invalid-assignee',
        `Expected exactly one assignee; found ${issue.assignees.length}. Skipping issue.`,
      );
      valid = false;
    }
    const categories: Record<string, string> = {};
    for (const dimension of config.dimensions) {
      if (dimension.source === 'assignee') {
        const person = issue.assignees[0];
        if (person)
          categories[dimension.key] = person.name?.trim() || person.login;
      } else {
        const labels = issue.labels.filter((label) =>
          label.startsWith(dimension.prefix!),
        );
        if (
          labels.length !== 1 ||
          !labels[0].slice(dimension.prefix!.length).trim()
        ) {
          warn(
            'invalid-category',
            `Expected one ${dimension.prefix} label; found ${JSON.stringify(labels)}. Skipping issue.`,
          );
          valid = false;
        } else
          categories[dimension.key] = labels[0].slice(dimension.prefix!.length);
      }
    }
    if (!item.sprint)
      warn(
        'missing-sprint',
        'No Sprint; valid effort remains in overall totals and the Unassigned sprint group.',
      );
    if (valid)
      included.push({
        issueId: issue.id,
        itemId: item.id,
        url: issue.url,
        title: issue.title,
        hours: item.hours!,
        sprint: item.sprint,
        categories,
      });
  }
  included.sort((a, b) => a.url.localeCompare(b.url, 'en'));
  const totalHours = included.reduce((sum, entry) => sum + entry.hours, 0);
  if (!Number.isFinite(totalHours))
    throw new Error('Included hours overflow; refusing to publish.');
  const aggregates = Object.fromEntries(
    config.dimensions.map((dimension) => {
      const buckets = new Map<string, { hours: number; issues: number }>();
      for (const entry of included) {
        const category = entry.categories[dimension.key];
        const bucket = buckets.get(category) ?? { hours: 0, issues: 0 };
        bucket.hours += entry.hours;
        bucket.issues++;
        buckets.set(category, bucket);
      }
      const order = dimension.order ?? [];
      const rank = (value: string) =>
        order.includes(value) ? order.indexOf(value) : order.length;
      const rows = [...buckets]
        .map(([category, bucket]) => ({
          category,
          ...bucket,
          percentage: totalHours ? (bucket.hours / totalHours) * 100 : 0,
        }))
        .sort(
          (a, b) =>
            rank(a.category) - rank(b.category) ||
            b.hours - a.hours ||
            a.category.localeCompare(b.category, 'en'),
        );
      const sum = rows.reduce((value, row) => value + row.hours, 0);
      if (Math.abs(sum - totalHours) > Math.max(1, totalHours) * 1e-10)
        throw new Error(`Reconciliation failed for ${dimension.key}`);
      return [dimension.key, rows];
    }),
  );
  return { totalHours, included, diagnostics, aggregates };
}
