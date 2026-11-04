import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { account } from './accounting.ts';
import {
  effortInsights,
  weeklyCompletions,
  reportingWeekStart,
} from './insights.ts';
import { renderCharts } from './render.ts';
import type { Config, Result, Snapshot } from './types.ts';

export const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
export const semanticSnapshot = (snapshot: Snapshot) =>
  JSON.stringify({
    ...snapshot,
    fetchedAt: undefined,
    fetchCompletedAt: undefined,
  });
export const fingerprint = (snapshot: Snapshot) =>
  createHash('sha256').update(semanticSnapshot(snapshot)).digest('hex');
const csv = (value: string | number) =>
  `"${String(value).replaceAll('"', '""')}"`;
const md = (value: string) =>
  value.replaceAll('|', '\\|').replaceAll('\n', ' ');

export async function publish(
  snapshot: Snapshot,
  config: Config,
  destination: string,
  sprintId?: string,
  renderer = renderCharts,
): Promise<Result> {
  if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.items))
    throw new Error('Unsupported or malformed snapshot.');
  if (
    snapshot.project.owner !== config.owner ||
    snapshot.project.number !== config.project ||
    snapshot.fields.hours !== config.hoursField ||
    snapshot.fields.sprint !== config.sprintField
  )
    throw new Error(
      'Snapshot does not match configured source project/fields.',
    );
  if (
    sprintId &&
    !snapshot.iterations.some((sprint) => sprint.id === sprintId) &&
    !snapshot.items.some((item) => item.sprint?.id === sprintId)
  )
    throw new Error(
      `Unknown sprint ID '${sprintId}'. Use an iteration ID from the snapshot.`,
    );
  // Keep the cutoff of the last identical source snapshot so unchanged runs produce no timestamp-only commits.
  try {
    const previous = JSON.parse(
      await readFile(join(destination, 'snapshot.json'), 'utf8'),
    ) as Snapshot;
    if (
      semanticSnapshot(previous) === semanticSnapshot(snapshot) &&
      reportingWeekStart(previous.fetchedAt) ===
        reportingWeekStart(snapshot.fetchedAt)
    )
      snapshot = previous;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const result = account(snapshot, config, sprintId);
  const sprint =
    snapshot.iterations.find((value) => value.id === sprintId) ??
    snapshot.items.find((item) => item.sprint?.id === sprintId)?.sprint;
  const scope = sprintId ? `Sprint: ${sprint!.title}` : 'All project effort';
  await mkdir(dirname(destination), { recursive: true });
  const stage = await mkdtemp(join(dirname(destination), '.stage-'));
  const backup = `${stage}-previous`;
  let hadPrevious = false;
  try {
    await renderer(
      join(stage, 'charts'),
      config,
      snapshot,
      result,
      scope,
      sprintId,
    );
    await writeFile(join(stage, 'snapshot.json'), json(snapshot));
    await writeFile(
      join(stage, 'insights.json'),
      json({
        effort: effortInsights(result, config),
        completions: weeklyCompletions(snapshot, sprintId),
      }),
    );
    await writeFile(
      join(stage, 'aggregates.json'),
      json({
        totalHours: result.totalHours,
        scope,
        dimensions: result.aggregates,
      }),
    );
    await writeFile(
      join(stage, 'quality.json'),
      json({
        boardItems: snapshot.items.length,
        archivedItems: snapshot.items.filter((item) => item.archived).length,
        includedIssues: result.included.length,
        excludedItems: snapshot.items.length - result.included.length,
        diagnostics: result.diagnostics,
      }),
    );
    const headers = [
      'issue',
      'title',
      'hours',
      'sprint',
      ...config.dimensions.map((dimension) => dimension.key),
    ];
    await writeFile(
      join(stage, 'effort.csv'),
      [
        headers,
        ...result.included.map((entry) => [
          entry.url,
          entry.title,
          entry.hours,
          entry.sprint?.title ?? '',
          ...config.dimensions.map(
            (dimension) => entry.categories[dimension.key],
          ),
        ]),
      ]
        .map((row) => row.map(csv).join(','))
        .join('\n') + '\n',
    );
    const sections = config.dimensions.map((dimension) => {
      const rows = result.aggregates[dimension.key];
      return `## ${dimension.title}\n\n![${dimension.title}](charts/${dimension.key}.svg)\n\n| Category | Hours | Share | Issues |\n| --- | ---: | ---: | ---: |\n${rows.map((row) => `| ${md(row.category)} | ${row.hours.toFixed(2)} | ${row.percentage.toFixed(1)}% | ${row.issues} |`).join('\n')}\n\n![${dimension.title} by sprint](charts/${dimension.key}-by-sprint.svg)`;
    });
    if (
      config.dimensions.some((d) => d.key === 'discipline') &&
      config.dimensions.some((d) => d.key === 'phase')
    )
      sections.push(
        '## Discipline × phase\n\n![Effort heatmap](charts/discipline-phase.svg)',
      );
    if (
      ['person', 'discipline', 'usecase'].every((key) =>
        config.dimensions.some((d) => d.key === key),
      )
    )
      sections.push(
        '## Effort flow\n\n![Person to discipline to use case](charts/effort-flow.svg)\n\nEach stage represents the same recorded hours. Links aggregate adjacent categories.',
      );
    sections.push(
      '## Completed leaf issues by week\n\n![Completed leaf issues](charts/completed-by-week.svg)\n\nCounts currently completed leaf issues on the current board by their latest GitHub closing date, including issues without recorded hours. Not-planned closures and parents are excluded. Each issue counts once; reopened issues are absent until completed again, then move to their latest closing week. This is a current-cohort completion distribution, not a reconstruction of historical board scope. Weeks run Tuesday–Monday in Europe/Berlin and use the ISO calendar-week number of their starting Tuesday; the current week may be partial.',
    );
    sections.push(
      `## Native burn-up\n\n[View the GitHub-provided historical burn-up](https://github.com/orgs/${config.owner}/projects/${config.project}/insights?period=max). No local story-history snapshots or reconstructed burn-up are used. GitHub Insights has its own scope rules, including exclusion of archived/deleted items.\n\n[Repository maps and Gource trial](../../repository/README.md)`,
    );
    const qualityCounts = new Map<string, number>();
    for (const diagnostic of result.diagnostics)
      qualityCounts.set(
        diagnostic.code,
        (qualityCounts.get(diagnostic.code) ?? 0) + 1,
      );
    await writeFile(
      join(stage, 'analysis.md'),
      `# ${config.title}\n\n${scope} · **${result.totalHours.toFixed(2)} recorded hours** · ${result.included.length} included leaf issues.\n\nSource: [${snapshot.project.title}](${snapshot.project.url}). Snapshot fetch window: ${snapshot.fetchedAt} to ${snapshot.fetchCompletedAt}. Source SHA-256: \`${fingerprint(snapshot)}\`.\n\n${result.included.length ? '' : '**No valid effort records in this scope.**\n\n'}${sections.join('\n\n')}\n\n## Accounting and coverage\n\nOnly issues on the project board count, including archived items and open issues. Parent totals are excluded even when their children are outside the board or have missing data. One issue, one assignee, one label per category dimension. Invalid records are skipped for every dimension; percentages therefore describe valid included recorded effort, not all actual work. Zero hours are valid; absent hours are not zero. Person means assigned person (GitHub display name, login fallback), as agreed by the team.\n\nThe views describe the same hours and must not be added together. Every dimension reconciles to ${result.totalHours.toFixed(2)} h. Sprint charts use current sprint attribution, not dated work entries. The source is current at the fetch window; it does not reconstruct historical field values. Removed/deleted items are unavailable, and inaccessible content is skipped with diagnostics.\n\n## Data quality\n\n${snapshot.items.length} board items fetched (${snapshot.items.filter((item) => item.archived).length} archived); ${result.included.length} valid leaf issues included in this scope.\n\n${[...qualityCounts].map(([code, count]) => `- ${code}: ${count}`).join('\n') || 'No data-quality diagnostics.'}\n\nSee [quality.json](quality.json) for issue-level reasons and [effort.csv](effort.csv) for counted records. Diagnostics are also printed to the console. Fix sources and rerun.\n`,
    );
    try {
      await rename(destination, backup);
      hadPrevious = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      await rename(stage, destination);
    } catch (error) {
      if (hadPrevious) await rename(backup, destination);
      throw error;
    }
    if (hadPrevious) await rm(backup, { recursive: true, force: true });
    return result;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
