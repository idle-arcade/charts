import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publish } from '../src/report.ts';
import { renderSvg } from '../src/render.ts';
import { config, item, snapshot } from './fixtures.ts';

async function files(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const [name, bytes] of Object.entries(
        await files(join(directory, entry.name)),
      ))
        result[`${entry.name}/${name}`] = bytes;
    } else
      result[entry.name] = createHash('sha256')
        .update(await readFile(join(directory, entry.name)))
        .digest('hex');
  }
  return result;
}

test('renders SVG/PNG, preserves unchanged bytes and the last valid report on rendering failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arcade-charts-test-'));
  const destination = join(root, 'latest');
  try {
    const source = snapshot([item('a'), item('b', { hours: 0.75 })]);
    await publish(source, config, destination);
    const before = await files(destination);
    assert.equal(Object.keys(before).length, 28); // eleven SVG/PNG pairs + six data/report files
    assert.ok(
      (await readFile(join(destination, 'charts/person.svg'), 'utf8')).includes(
        'Bastian',
      ),
    );
    assert.equal(
      (await readFile(join(destination, 'charts/person.png')))
        .subarray(1, 4)
        .toString(),
      'PNG',
    );
    await publish(
      {
        ...source,
        fetchedAt: '2026-11-02T12:00:00Z',
        fetchCompletedAt: '2026-11-02T12:00:01Z',
      },
      config,
      destination,
    );
    assert.deepEqual(await files(destination), before);
    await assert.rejects(
      publish(source, config, destination, undefined, async () => {
        throw new Error('render failed');
      }),
      /render failed/,
    );
    assert.deepEqual(await files(destination), before);
    await assert.rejects(
      publish(source, config, destination, 'unknown'),
      /Unknown sprint/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('chart rendering is deterministic within the same process', () => {
  const option = {
    xAxis: {},
    yAxis: {},
    series: [{ type: 'bar' as const, data: [1] }],
  };
  assert.equal(renderSvg(option, 440, 'Test'), renderSvg(option, 440, 'Test'));
});
