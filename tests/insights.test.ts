import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effortInsights, weeklyCompletions } from '../src/insights.ts';
import { account } from '../src/accounting.ts';
import { config, item, snapshot } from './fixtures.ts';

test('heatmap counts each hour once and each Sankey stage reconciles', () => {
  const a = item('a', { hours: 1.5 });
  const b = item('b', { hours: 0.5 });
  b.issue!.labels = [
    'discipline:testing',
    'phase:elaboration',
    'usecase:darts',
  ];
  const result = account(snapshot([a, b]), config, undefined, () => {});
  const insights = effortInsights(result, config);
  assert.equal(
    insights.heatmap.reduce((sum, cell) => sum + cell.hours, 0),
    2,
  );
  assert.equal(
    insights.heatmap.find(
      (cell) => cell.discipline === 'testing' && cell.phase === 'elaboration',
    )!.hours,
    0.5,
  );
  for (const stage of ['person', 'discipline', 'usecase'])
    assert.equal(
      insights.sankey.nodes
        .filter((node) => node.stage === stage)
        .reduce((sum, node) => sum + node.hours, 0),
      2,
    );
  assert.equal(
    insights.sankey.links
      .filter((link) => link.source.startsWith('person:'))
      .reduce((sum, link) => sum + link.value, 0),
    2,
  );
  assert.equal(
    insights.sankey.links
      .filter((link) => link.source.startsWith('discipline:'))
      .reduce((sum, link) => sum + link.value, 0),
    2,
  );
});

test('weekly completion uses actual final closures and Berlin Monday boundaries, excludes parents and not planned', () => {
  const a = item('a', { hours: null });
  a.issue!.stateReason = 'COMPLETED';
  a.issue!.closedAt = '2026-10-11T22:30:00Z'; // Monday in Berlin
  const b = item('b');
  b.issue!.stateReason = 'COMPLETED';
  b.issue!.closedAt = '2026-10-11T21:30:00Z'; // Sunday in Berlin
  const parent = item('parent');
  parent.issue!.subIssueCount = 1;
  parent.issue!.stateReason = 'COMPLETED';
  parent.issue!.closedAt = a.issue!.closedAt;
  const reopened = item('open');
  reopened.issue!.state = 'OPEN';
  reopened.issue!.stateReason = 'REOPENED';
  reopened.issue!.closedAt = a.issue!.closedAt;
  const cancelled = item('cancelled');
  cancelled.issue!.stateReason = 'NOT_PLANNED';
  cancelled.issue!.closedAt = a.issue!.closedAt;
  const result = weeklyCompletions(
    snapshot([a, b, parent, reopened, cancelled, { ...a, id: 'duplicate' }]),
  );
  assert.equal(result.issues.length, 2);
  assert.deepEqual(result.weeks.slice(0, 2), [
    { week: '2026-10-05', count: 1 },
    { week: '2026-10-12', count: 1 },
  ]);
  assert.ok(result.weeks.some((row) => row.count === 0));
  assert.equal(weeklyCompletions(snapshot([a]), 'another').issues.length, 0);
});

test('includes the current Berlin week when Monday has begun before UTC Monday', () => {
  const record = item('boundary');
  record.issue!.stateReason = 'COMPLETED';
  record.issue!.closedAt = '2026-10-11T22:30:00Z';
  const source = snapshot([record]);
  source.fetchedAt = '2026-10-11T23:00:00Z';
  assert.deepEqual(weeklyCompletions(source).weeks, [
    { week: '2026-10-12', count: 1 },
  ]);
});
