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
