import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { credential, fetchSnapshot, githubRequest } from './github.ts';
import { json, publish } from './report.ts';
import type { Config, Snapshot } from './types.ts';

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string', default: 'config/report.json' },
      snapshot: { type: 'string', default: '.work/snapshot.json' },
      owner: { type: 'string' },
      project: { type: 'string' },
      sprint: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(
      'npm run report -- [generate|fetch|render] [--owner idle-arcade] [--project 1] [--sprint ITERATION_ID] [--snapshot PATH] [--config PATH]\nGenerate (default): fresh fetch and publish. Fetch: save source only. Render: offline snapshot replay.',
    );
    return;
  }
  const command = positionals[0] ?? 'generate';
  if (
    positionals.length > 1 ||
    !['generate', 'fetch', 'render'].includes(command)
  )
    throw new Error('Expected generate, fetch, or render. See --help.');
  const config = JSON.parse(await readFile(values.config!, 'utf8')) as Config;
  config.owner = values.owner ?? config.owner;
  config.project = Number(values.project ?? config.project);
  if (
    !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(config.owner) ||
    !Number.isInteger(config.project) ||
    config.project < 1
  )
    throw new Error('Invalid source owner/project.');
  if (
    !config.hoursField ||
    !config.sprintField ||
    !config.title ||
    !Array.isArray(config.dimensions) ||
    !config.dimensions.length
  )
    throw new Error('Invalid report configuration.');
  const keys = new Set<string>();
  for (const dimension of config.dimensions) {
    if (
      !/^[a-z][a-z0-9-]*$/.test(dimension.key) ||
      keys.has(dimension.key) ||
      !dimension.title ||
      (dimension.source !== 'assignee' && !dimension.prefix)
    )
      throw new Error(
        'Dimensions need unique safe keys, titles, and a label prefix or assignee source.',
      );
    keys.add(dimension.key);
  }
  if (values.sprint && !/^[\w-]+$/.test(values.sprint))
    throw new Error('Invalid sprint ID.');
  const runStartedAt = new Date().toISOString();
  const snapshot =
    command === 'render'
      ? (JSON.parse(await readFile(values.snapshot!, 'utf8')) as Snapshot)
      : await fetchSnapshot(config, githubRequest(credential()));
  if (command === 'fetch') {
    await mkdir(dirname(resolve(values.snapshot!)), { recursive: true });
    await writeFile(values.snapshot!, json(snapshot));
    console.log(
      `Saved ${snapshot.items.length} board items to ${values.snapshot}`,
    );
    return;
  }
  const sourceKey = `${config.owner}-${config.project}`;
  const destination = resolve(
    'reports',
    sourceKey,
    values.sprint ? `sprints/${values.sprint}` : 'latest',
  );
  const result = await publish(snapshot, config, destination, values.sprint);
  const summary = `Fetched at ${runStartedAt}; published ${result.included.length} valid leaf issues, ${result.totalHours.toFixed(2)} h. ${result.diagnostics.length} diagnostics. Report: ${destination}`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
}
main().catch((error) => {
  console.error(`Report failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
