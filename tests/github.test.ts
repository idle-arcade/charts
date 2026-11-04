import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collect, fetchSnapshot, githubRequest } from '../src/github.ts';
import type { Request } from '../src/github.ts';
import { config } from './fixtures.ts';

test('paginates 1000 items without truncation', async () => {
  let calls = 0;
  const all = await collect(async (after) => {
    calls++;
    const start = after ? Number(after) : 0;
    return {
      nodes: Array.from({ length: 100 }, (_, offset) => start + offset),
      totalCount: 1000,
      pageInfo: { hasNextPage: start < 900, endCursor: String(start + 100) },
    };
  });
  assert.equal(all.length, 1000);
  assert.equal(calls, 10);
  assert.equal(all[999], 999);
});

test('rejects stalled pagination, changed counts and truncated pages', async () => {
  await assert.rejects(
    collect(async () => ({
      nodes: [1],
      totalCount: 3,
      pageInfo: { hasNextPage: true, endCursor: 'same' },
    })),
    /advance/,
  );
  await assert.rejects(
    collect(async () => ({
      nodes: [1],
      totalCount: 2,
      pageInfo: { hasNextPage: false, endCursor: null },
    })),
    /Incomplete/,
  );
  await assert.rejects(
    collect(async (after) => ({
      nodes: [1],
      totalCount: after ? 3 : 2,
      pageInfo: { hasNextPage: !after, endCursor: 'next' },
    })),
    /changed/,
  );
});

test('GraphQL errors with HTTP 200 fail instead of accepting partial data', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: { node: {} },
        errors: [{ message: 'insufficient permissions' }],
      }),
      { status: 200 },
    );
  try {
    await assert.rejects(
      githubRequest('test-token')('query {}', {}),
      /insufficient permissions/,
    );
  } finally {
    globalThis.fetch = previous;
  }
});

test('fetches only board items, requests archived records and follows overflowing issue labels', async () => {
  const queries: string[] = [];
  const connection = <T>(nodes: T[], more = false, total = nodes.length) => ({
    nodes,
    totalCount: total,
    pageInfo: { hasNextPage: more, endCursor: more ? 'next' : null },
  });
  const request = (async (
    query: string,
    variables: Record<string, unknown>,
  ) => {
    queries.push(query);
    if (query.includes('organization(login:'))
      return {
        organization: {
          projectV2: {
            id: 'p1',
            title: 'Project',
            url: 'https://github.com/orgs/idle-arcade/projects/1',
          },
        },
      };
    if (query.includes('fields(first:'))
      return {
        node: {
          fields: connection([
            {
              __typename: 'ProjectV2Field',
              name: 'Actual Hours',
              dataType: 'NUMBER',
            },
            {
              __typename: 'ProjectV2IterationField',
              name: 'Sprint',
              configuration: { iterations: [], completedIterations: [] },
            },
          ]),
        },
      };
    if (query.includes('items(first:'))
      return {
        node: {
          items: connection([
            {
              id: 'i1',
              isArchived: true,
              type: 'ISSUE',
              hours: { number: 0.5 },
              sprint: null,
              content: {
                __typename: 'Issue',
                id: 'a',
                number: 1,
                url: 'https://github.com/idle-arcade/game/issues/1',
                title: 'Issue',
                state: 'OPEN',
                updatedAt: '2026-11-01T12:00:00Z',
                parent: null,
                subIssues: { totalCount: 0 },
                labels: connection([{ name: 'a' }], true, 2),
                assignees: connection([{ login: 'crafter', name: 'Bastian' }]),
              },
            },
          ]),
        },
      };
    return {
      node: {
        labels: connection(
          [{ name: variables.after ? 'b' : 'a' }],
          !variables.after,
          2,
        ),
      },
    };
  }) as Request;
  const result = await fetchSnapshot(config, request);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].archived, true);
  assert.deepEqual(result.items[0].issue!.labels, ['a', 'b']);
  assert.ok(
    queries.some((query) =>
      query.includes('archivedStates: [ARCHIVED, NOT_ARCHIVED]'),
    ),
  );
  assert.ok(!queries.some((query) => query.includes('repository(')));
});
