# IDLE Arcade effort charts

Reproducible effort reports for [IDLE Arcade Project 1](https://github.com/orgs/idle-arcade/projects/1), implementing [game#148](https://github.com/idle-arcade/game/issues/148).

[Read the latest report](reports/idle-arcade-1/latest/analysis.md) · [Run the workflow](https://github.com/idle-arcade/charts/actions/workflows/report.yml)

TypeScript runs directly on Node 24. Apache ECharts renders modern SVG charts without a browser, and Sharp produces PNG copies. No hosted service, application server, or database is required.

## Run locally

```sh
npm ci
npm run check
npm run report
```

The default command fetches fresh project data and generates all four category charts, four sprint charts, a discipline × phase heatmap, an effort-flow Sankey, and a weekly completion chart, each as SVG and PNG, under `reports/idle-arcade-1/latest/`.

Authentication: set `SOURCE_TOKEN` in your environment or copy `.env.example` to `.env` and fill it locally. Alternatively, a signed-in GitHub CLI with `read:project` access is used automatically. `.env` is ignored. Never put a credential in `config/report.json`, a command-line argument, committed data, or logs.

Useful commands:

```sh
# Fetch only, with no chart generation.
npm run report -- fetch --snapshot .work/source.json

# Offline rendering: no API call and no token required.
npm run report -- render --snapshot reports/idle-arcade-1/latest/snapshot.json

# Generate one sprint using its stable iteration ID from snapshot.json.
npm run report -- generate --sprint ITERATION_ID

# Override the source project or report configuration.
npm run report -- generate --owner idle-arcade --project 1 --config config/report.json
```

Sprint output lives under `reports/OWNER-NUMBER/sprints/ITERATION_ID/`; it does not replace the overall report. The saved snapshot always contains the complete fetched board so it can be replayed for other sprint scopes. This is a current-state fetch, not a query for historical hours at an arbitrary date.

## Accounting rules

1. Only accessible **issues returned by the organization project's items connection** are candidates. No repository-wide issue search is performed. Both active and archived project items are fetched, including open issues. PRs, drafts, and inaccessible content are skipped and logged.
2. Count only **leaf issues**. An issue with any sub-issues is a rollup and contributes zero direct hours. This applies at every hierarchy level, even when some children are outside the board, invalid, or missing hours. An on-board leaf's own Actual Hours count; its parent's hours never do. Story Points are not used to estimate hours.
3. Deduplicate by stable issue node ID. One board issue contributes at most once.
4. Actual Hours must be present, finite, and non-negative. Explicit zero and fractional hours are valid. Missing does not mean zero.
5. Exactly one assignee and exactly one nonempty label from each configured label family are required. Invalid issues are excluded from **all** dimensions, keeping their denominators consistent. No inferred categories, equal splits, fabricated hours, or allocation overrides.
6. Per-person effort uses the sole assignee's GitHub **display name**, falling back to login when no public name is set. This is the team's agreed ownership attribution, not independently verified time-log authorship.
7. A missing Sprint is valid and produces no warning or data-quality entry. Its effort remains in overall totals and the **No sprint** group. A sprint-specific report includes only issues assigned that iteration ID. Sprint attribution is not a date of work.

Every skip or data-quality issue prints its issue URL/item ID and reason to the console and is saved in `quality.json`. Fix the original issues/project values and rerun. There is no ignore list or silent fallback. Parent exclusions are logged as `parent-rollup`, not treated as source errors. Percentages describe **valid included recorded effort**; skipped records mean the report may understate actual team effort. The four views describe the same hours and must not be added together.

## Worksheet mapping

Worksheet 2, section 1.B, explicitly asks for time per person, discipline, phase, and use case in addition to a standard burndown. Its Balzert illustration explains disciplines across phases and iterations; it does not prescribe a particular chart style. These reports use hours/percentage bars and sprint stacks. A daily burndown is not generated because current issue totals and current sprint assignments do not establish historical remaining work.

| Worksheet dimension | Project source / adaptation                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Person              | Exactly one issue assignee; GitHub display name, login fallback                                                      |
| Discipline          | `discipline:*`: requirements, design, implementation, testing, deployment, configuration, management, infrastructure |
| Phase               | `phase:*`: inception, elaboration, construction, transition, in that order                                           |
| Use case            | Exactly one `usecase:*` label; values are discovered from board issues                                               |
| Iteration           | `Sprint` iteration field, including completed iterations                                                             |
| Effort              | Numeric `Actual Hours` on leaf issues                                                                                |

The worksheet's business-modeling discipline currently has no dedicated project label; no historical allocation is invented. Requirements/design/testing/deployment labels are the project's equivalents of the worksheet terminology. `usecase:project-preparation` explicitly includes preparation, meetings, and planning rather than a player-facing use case. `kind:*` and unrelated labels are not chart categories.

## Configuration and extension

`config/report.json` defines project owner/number, field names, chart titles, label-family dimensions, and optional category order. Category values are discovered from the board, and colors are stable by category. Add another label-family dimension to generate its aggregates, overall chart, and sprint chart automatically. Dimension keys must be unique, safe file names.

The code separates API access (`github.ts`), accounting (`accounting.ts`), rendering (`render.ts`), report publication (`report.ts`), and the CLI (`cli.ts`). Fetching and offline rendering are separate operations. Snapshots are versioned with their schema and source identity.

## GitHub Actions setup

The workflow runs **Monday at 23:17 Europe/Berlin**, following daylight saving time, and on **manual dispatch only**. There is no push trigger. GitHub schedules can be delayed and are not an exact-time delivery guarantee. The workflow must be on the default branch; public repositories may have schedules disabled after 60 days without activity.

Create the repository Actions secret **`SOURCE_TOKEN`** in `idle-arcade/charts`:

- For the current public game repository: a classic PAT with only **`read:project`** is sufficient for project queries and public issue data. No `repo`, `project` write, or workflow scope is needed. The token owner's account must have access to the project. Use an expiration and rotate the secret before it expires.
- A GitHub App installation token is an alternative: organization Projects read and Issues read for the source repositories. Private source repositories additionally require appropriate repository read permission; do not broaden the current credential for hypothetical future sources.
- The destination repository's built-in `GITHUB_TOKEN` gets **`contents: write`** only and commits the reports. It is not used as the source-project credential. Repository/branch policy must allow the bot to push generated commits.

Do not commit the token. The workflow exposes it only to the fetch/generate step. Manual inputs select the source organization, project number, and optional sprint iteration ID; the destination always stays in this repository. Source data committed to this repository is visible to everyone who can read this repository, so only select a source with compatible visibility.

The workflow checks out the current default-branch head, installs locked dependencies, runs checks, fetches, validates, renders, and commits only changed files under `reports/`. Concurrent runs share a publication group with cancellation disabled. An intervening human push causes a safe push failure; rerun instead of force-pushing. GitHub may replace an older pending run with a newer pending run in this group.

Publication is staged. Fetch errors, partial GraphQL responses, pagination failures, invalid required project fields, reconciliation failures, or rendering failures do not replace the last valid report. Individual bad records are skipped, as described above. Generated files are uploaded as a workflow artifact as well, so output can be inspected if pushing fails. An upload after an earlier failure may contain the previous checked-out report; check the snapshot cutoff and step status.

## API load and snapshots

A fresh full fetch is used on each generation. At 1,000 board items, 100 items/page means ten item requests plus project metadata/field requests and any overflowing issue-label/assignee connections. Parent relationships and sub-issue counts are fetched inline, avoiding a request per issue. Each connection follows its own cursor and verifies its total count. Collection changes during pagination fail safely; rerun for a consistent fetch.

This workload is small for weekly/manual runs. Query cost and remaining GraphQL points are printed, and transient HTTP failures receive bounded retries. Incremental caching would complicate invalidation of changed hours, labels, assignees, rollups, archived state, and project fields for little benefit. npm dependency downloads are cached in Actions; source API data is always fetched fresh.

The committed source snapshot provides reproducibility and offline rendering. If the source is unchanged within the same reporting week, its original fetch window is retained so timestamps alone do not generate commits. A new Tuesday reporting week refreshes the cutoff so Current Week remains accurate. The Actions summary records the actual check time. Snapshots cannot recover deleted/removed project items or prove the exact time an issue's work happened. The fetch window is recorded because pagination is not an atomic database transaction.

## Generated files and verification

Each report contains `charts/*.svg`, `charts/*.png`, `snapshot.json`, `effort.csv`, `aggregates.json`, `quality.json`, and `analysis.md`. Git history preserves previous reports. Snapshot data contains only required project/issue metadata, never issue bodies, comments, or credentials.

Tests cover hand-calculated rollups and nested parents, off-board children, deduplication, missing/zero/fractional/invalid hours, assignee/display-name handling, missing/conflicting labels, missing sprint, archived/open issues, 1,000-item pagination, nested pagination, partial API failures, deterministic repeated SVG/PNG output, and preservation of the last report after a rendering failure. Run `npm run check` before changing the reporting rules. A second team member should review the accounting and charts before using them in blog 5.

References: [ECharts SVG SSR](https://echarts.apache.org/handbook/en/how-to/cross-platform/server/), [GitHub Projects API](https://docs.github.com/en/graphql/reference/projects), [GraphQL rate limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api), [workflow schedules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Initial verification (2026-11-04)

- [Successful first manual run](https://github.com/idle-arcade/charts/actions/runs/41901801717), which generated [report commit 2a7ef7e](https://github.com/idle-arcade/charts/commit/2a7ef7e).
- [Successful unchanged rerun](https://github.com/idle-arcade/charts/actions/runs/41901980545): fresh fetch, identical reports, no commit.
- Source coverage at that snapshot: 125 board items, 82 included leaf issues, 99.9997 recorded hours (displayed as 100.00 h); 23 parent rollups excluded. Missing-hours and assignee diagnostics overlap and are available in the report and run logs.
- The fetch used four GraphQL requests totaling eight reported rate-limit points. All initial 11 tests, typechecking, formatting, SVG/PNG generation, and automated report publication passed. A second team member's review remains separate from these automated checks.
- `SOURCE_TOKEN` is configured in this repository's Actions secrets. The initial read-only token expires on **2026-12-04**; rotate the secret before then. Local fresh fetches need their own `SOURCE_TOKEN` environment/`.env` value or a GitHub CLI credential with `read:project`; the repository secret cannot be downloaded. Offline snapshot replay needs neither.

## Additional charts and repository images

The discipline × phase heatmap and Person → discipline → use case Sankey use the same valid leaf effort records and reconcile to the existing total. Zero-hour records remain in the machine-readable aggregates; zero-width flows are omitted from the drawing. `insights.json` contains the cell values, Sankey nodes/links and completion records.

The weekly completion chart uses **GitHub-provided closing dates and completion reasons**, without keeping a local sequence of story snapshots or reconstructing historical states. It counts currently completed leaf issues on the current board, grouped by their latest closing timestamp. Parents and not-planned closures do not count. Each issue counts once. Reopened issues do not count until completed again, at which point they move to their latest closing week. Weeks run Tuesday–Monday in Europe/Berlin. Past labels use the ISO week-year and week number of the starting Tuesday (for example `'26 KW44`); the latest label is **Current Week**. Current weeks can be partial. This chart includes completed leaves without valid effort data, so its issue count can exceed the effort chart's record count. It describes the current cohort; it does not claim to reproduce the board's membership or hierarchy on each historic date.

A direct [GitHub native burn-up reference](https://github.com/orgs/idle-arcade/projects/1/insights) is included in each report. There is no documented public Insights time-series/export endpoint in the Projects schema checked during implementation. We therefore do not implement a reconstructed burn-up, poll daily project state, or add a story-history store. The existing source export remains a reproducibility input for the current report only; earlier exports are not used to derive trends.

The same Monday/manual workflow checks out `idle-arcade/game` independently and runs the existing **Repocarto** Action and captures a **Gource** still. Repocarto's action commit and npm release are pinned, and its automatic commit is disabled, and our existing final commit step publishes their outputs only to this charts repository under `reports/repository/`. The source game checkout is never edited or pushed. A separate disposable visualization clone has dependency/build folders, binary assets, drawing source files and lockfiles removed from its working tree/index to keep Repocarto focused on readable source structure. The source commit and renderer versions are recorded in `source.json`.

Manual dispatch accepts `source_ref` (default `main`) for the repository images. Every scheduled or manual run installs Gource, Xvfb, Mesa and FFmpeg on the disposable runner, renders real Git history using software OpenGL, and retains only the final **2560×1440 (16:9)** PNG. No video is written. Idle files stay visible; filenames/people are hidden and directory labels remain. `gource-source.json` records its source commit. Gource and Repocarto refresh together. Repository diagrams show file layout, not runtime dependencies or application architecture. Repo Visualizer has been removed; Gource and Repocarto are the selected repository visuals.

[Browse the generated repository images](reports/repository/README.md).
