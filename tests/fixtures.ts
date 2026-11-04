import { readFile } from 'node:fs/promises';
import type { Config, Item, Snapshot } from '../src/types.ts';
export const config = JSON.parse(
  await readFile(new URL('../config/report.json', import.meta.url), 'utf8'),
) as Config;
export function item(id: string, patch: Partial<Item> = {}): Item {
  return {
    id: `item-${id}`,
    archived: false,
    type: 'ISSUE',
    hours: 1.25,
    sprint: {
      id: 's1',
      title: 'Sprint 1',
      startDate: '2026-10-05',
      duration: 7,
    },
    issue: {
      id,
      number: 1,
      url: `https://github.com/idle-arcade/game/issues/${id}`,
      title: `Issue ${id}`,
      state: 'CLOSED',
      updatedAt: '2026-11-01T12:00:00Z',
      parentId: null,
      subIssueCount: 0,
      labels: [
        'discipline:implementation',
        'phase:construction',
        'usecase:darts',
      ],
      assignees: [{ login: 'crafter', name: 'Bastian' }],
    },
    ...patch,
  };
}
export function snapshot(items: Item[]): Snapshot {
  return {
    schemaVersion: 1,
    fetchedAt: '2026-11-01T12:00:00Z',
    fetchCompletedAt: '2026-11-01T12:00:01Z',
    project: {
      id: 'p1',
      owner: 'idle-arcade',
      number: 1,
      title: 'IDLE Arcade',
      url: 'https://github.com/orgs/idle-arcade/projects/1',
    },
    fields: { hours: 'Actual Hours', sprint: 'Sprint' },
    iterations: [
      { id: 's1', title: 'Sprint 1', startDate: '2026-10-05', duration: 7 },
    ],
    items,
  };
}
