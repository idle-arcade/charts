import { test } from 'node:test';
import assert from 'node:assert/strict';
import { account } from '../src/accounting.ts';

import { config, item, snapshot } from './fixtures.ts';
const quiet = () => {};

test('counts leaf hours once; ignores nested parents, off-board children, and duplicate items', () => {
  const parent = item('parent', { hours: 99 });
  parent.issue!.subIssueCount = 2;
  const intermediate = item('middle', { hours: 88 });
  intermediate.issue!.parentId = 'parent';
  intermediate.issue!.subIssueCount = 1;
  const child = item('child');
  child.issue!.parentId = 'middle';
  const offBoardParent = item('off-board-parent', { hours: 50 });
  offBoardParent.issue!.subIssueCount = 1;
  const duplicate = { ...child, id: 'duplicate' };
  const result = account(
    snapshot([parent, intermediate, child, duplicate, offBoardParent]),
    config,
    undefined,
    quiet,
  );
  assert.equal(result.totalHours, 1.25);
  assert.equal(result.included.length, 1);
  assert.equal(
    result.diagnostics.filter((entry) => entry.code === 'parent-rollup').length,
    3,
  );
});

test('missing, negative and invalid hours are skipped; zero and fractional hours are retained', () => {
  const result = account(
    snapshot([
      item('a'),
      item('b', { hours: 0 }),
      item('c', { hours: null }),
      item('d', { hours: -1 }),
      item('e', { hours: NaN }),
    ]),
    config,
    undefined,
    quiet,
  );
  assert.equal(result.totalHours, 1.25);
  assert.equal(result.included.length, 2);
  assert.equal(
    result.diagnostics.filter((entry) => entry.code === 'invalid-hours').length,
    3,
  );
});

test('skips the whole issue for missing/conflicting labels or assignees; all dimensions reconcile', () => {
  const missing = item('missing');
  missing.issue!.labels = ['phase:construction', 'discipline:implementation'];
  const multiple = item('multiple');
  multiple.issue!.labels.push('phase:elaboration');
  const nobody = item('nobody');
  nobody.issue!.assignees = [];
  const two = item('two');
  two.issue!.assignees.push({ login: 'other', name: 'Other' });
  const empty = item('empty');
  empty.issue!.labels = [
    'phase:',
    'discipline:implementation',
    'usecase:darts',
  ];
  const result = account(
    snapshot([item('good'), missing, multiple, nobody, two, empty]),
    config,
    undefined,
    quiet,
  );
  assert.equal(result.included.length, 1);
  assert.equal(result.totalHours, 1.25);
  for (const rows of Object.values(result.aggregates))
    assert.equal(
      rows.reduce((sum, row) => sum + row.hours, 0),
      1.25,
    );
  assert.equal(result.aggregates.person[0].category, 'Bastian');
});

test('includes archived and open board issues without a sprint quietly, uses login fallback', () => {
  const record = item('a', { archived: true, sprint: null });
  record.issue!.state = 'OPEN';
  record.issue!.assignees[0].name = null;
  const messages: string[] = [];
  const result = account(snapshot([record]), config, undefined, (text) =>
    messages.push(text),
  );
  assert.equal(result.totalHours, 1.25);
  assert.equal(result.aggregates.person[0].category, 'crafter');
  assert.deepEqual(messages, []);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.included[0].sprint, null);
});

test('sprint scope filters by iteration identity and never substitutes parent rollups', () => {
  const parent = item('p', { hours: 20 });
  parent.issue!.subIssueCount = 1;
  assert.equal(
    account(
      snapshot([parent, item('a'), item('b', { sprint: null })]),
      config,
      's1',
      quiet,
    ).totalHours,
    1.25,
  );
});
