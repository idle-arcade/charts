import { execFileSync } from 'node:child_process';
import type { Config, Item, Snapshot, Sprint } from './types.ts';

type Connection<T> = {
  nodes: T[];
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};
type User = { login: string; name: string | null };
type RawIssue = {
  __typename: string;
  id: string;
  number: number;
  url: string;
  title: string;
  state: string;
  updatedAt: string;
  closedAt: string | null;
  stateReason: string | null;
  parent: { id: string } | null;
  subIssues: { totalCount: number };
  labels: Connection<{ name: string }>;
  assignees: Connection<User>;
};
type RawItem = {
  id: string;
  isArchived: boolean;
  type: string;
  hours: { number?: number } | null;
  sprint: (Omit<Sprint, 'id'> & { iterationId: string }) | null;
  content: RawIssue | { __typename: string } | null;
};
export type Request = <T>(
  query: string,
  variables: Record<string, unknown>,
) => Promise<T>;
const page = 'pageInfo { hasNextPage endCursor } totalCount';

export function credential(): string {
  const token =
    process.env.SOURCE_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN;
  if (token) return token;
  try {
    return execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error(
      'Set SOURCE_TOKEN in the environment or .env, or authenticate gh with read:project access.',
    );
  }
}

export function githubRequest(
  token: string,
  log: (message: string) => void = console.log,
): Request {
  return async <T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'idle-arcade-charts',
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(60_000),
      });
      if (
        response.status === 429 ||
        response.status >= 500 ||
        (response.status === 403 &&
          response.headers.get('x-ratelimit-remaining') === '0')
      ) {
        if (attempt === 3)
          throw new Error(
            `GitHub request failed after retries (HTTP ${response.status}).`,
          );
        const retrySeconds = Number(
          response.headers.get('retry-after') ?? 2 ** (attempt + 1),
        );
        if (retrySeconds > 60)
          throw new Error(
            'GitHub rate limit requires a wait exceeding 60s; retry this run later.',
          );
        log(`GitHub HTTP ${response.status}; retrying in ${retrySeconds}s.`);
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(1, retrySeconds) * 1000),
        );
        continue;
      }
      if (!response.ok)
        throw new Error(
          `GitHub HTTP ${response.status}; verify source credential and Projects/Issues read access.`,
        );
      const body = (await response.json()) as {
        data?: T;
        errors?: { message: string }[];
      };
      // GraphQL can return HTTP 200 with partial data. Never publish it.
      if (body.errors?.length || !body.data)
        throw new Error(
          `GitHub GraphQL returned errors or incomplete data: ${body.errors?.map((error) => error.message).join('; ') ?? 'no data'}`,
        );
      const rate = (
        body.data as { rateLimit?: { cost: number; remaining: number } }
      ).rateLimit;
      if (rate)
        log(
          `GitHub query cost ${rate.cost}; ${rate.remaining} points remaining.`,
        );
      return body.data;
    }
    throw new Error('GitHub retry loop exhausted.');
  };
}

export async function collect<T>(
  load: (cursor: string | null) => Promise<Connection<T>>,
): Promise<T[]> {
  const nodes: T[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  let expected: number | undefined;
  for (;;) {
    const connection = await load(cursor);
    if (
      !connection ||
      !Array.isArray(connection.nodes) ||
      !connection.pageInfo ||
      !Number.isInteger(connection.totalCount)
    )
      throw new Error('Malformed GitHub connection.');
    expected ??= connection.totalCount;
    if (
      expected !== connection.totalCount ||
      connection.nodes.some((node) => node === null)
    )
      throw new Error(
        'GitHub collection changed or contains unavailable nodes; rerun for a complete snapshot.',
      );
    nodes.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) break;
    const next = connection.pageInfo.endCursor;
    if (!next || cursors.has(next))
      throw new Error('GitHub pagination did not advance.');
    cursors.add(next);
    cursor = next;
  }
  if (nodes.length !== expected)
    throw new Error(
      `Incomplete GitHub pagination: expected ${expected}, got ${nodes.length}.`,
    );
  return nodes;
}

export async function fetchSnapshot(
  config: Config,
  request: Request,
): Promise<Snapshot> {
  const fetchedAt = new Date().toISOString();
  const metadata = await request<{
    organization: {
      projectV2: { id: string; title: string; url: string };
    } | null;
  }>(
    'query($owner: String!, $number: Int!) { organization(login: $owner) { projectV2(number: $number) { id title url } } rateLimit { cost remaining } }',
    { owner: config.owner, number: config.project },
  );
  const project = metadata.organization?.projectV2;
  if (!project)
    throw new Error(
      'Project not found; verify owner/number and source token read:project permission.',
    );
  type Field = {
    __typename: string;
    name: string;
    dataType?: string;
    configuration?: { iterations: Sprint[]; completedIterations: Sprint[] };
  };
  const fields = await collect<Field>(async (after) => {
    const result = await request<{ node: { fields: Connection<Field> } }>(
      `query($id: ID!, $after: String) { node(id: $id) { ... on ProjectV2 { fields(first: 100, after: $after) { nodes { __typename ... on ProjectV2Field { name dataType } ... on ProjectV2IterationField { name configuration { iterations { id title startDate duration } completedIterations { id title startDate duration } } } ... on ProjectV2SingleSelectField { name } } ${page} } } } rateLimit { cost remaining } }`,
      { id: project.id, after },
    );
    return result.node.fields;
  });
  const hoursField = fields.find((field) => field.name === config.hoursField);
  const sprintField = fields.find((field) => field.name === config.sprintField);
  if (hoursField?.dataType !== 'NUMBER')
    throw new Error(`Required numeric field '${config.hoursField}' not found.`);
  if (sprintField?.__typename !== 'ProjectV2IterationField')
    throw new Error(
      `Required iteration field '${config.sprintField}' not found.`,
    );
  const rawItems = await collect<RawItem>(async (after) => {
    const result = await request<{ node: { items: Connection<RawItem> } }>(
      `query($id: ID!, $after: String, $hours: String!, $sprint: String!) {
        node(id: $id) { ... on ProjectV2 { items(first: 100, after: $after, archivedStates: [ARCHIVED, NOT_ARCHIVED]) {
          nodes { id isArchived type
            hours: fieldValueByName(name: $hours) { ... on ProjectV2ItemFieldNumberValue { number } }
            sprint: fieldValueByName(name: $sprint) { ... on ProjectV2ItemFieldIterationValue { iterationId title startDate duration } }
            content { __typename ... on Issue { id number url title state updatedAt closedAt stateReason parent { id } subIssues(first: 1) { totalCount }
              labels(first: 100) { nodes { name } ${page} }
              assignees(first: 100) { nodes { login name } ${page} }
            } }
          } ${page}
        } } } rateLimit { cost remaining }
      }`,
      {
        id: project.id,
        after,
        hours: config.hoursField,
        sprint: config.sprintField,
      },
    );
    return result.node.items;
  });
  const items: Item[] = [];
  for (const item of rawItems) {
    let issue: Item['issue'] = null;
    if (item.content?.__typename === 'Issue') {
      const raw = item.content as RawIssue;
      // Re-fetch overflowing nested connections with their own cursor, never the project cursor.
      const nested = async <T>(
        field: 'labels' | 'assignees',
        selection: string,
        initial: Connection<T>,
      ) => {
        if (!initial.pageInfo.hasNextPage) {
          if (initial.nodes.length !== initial.totalCount)
            throw new Error(`Incomplete ${field} for ${raw.url}`);
          return initial.nodes;
        }
        return collect<T>(async (after) => {
          const result = await request<{ node: Record<string, Connection<T>> }>(
            `query($id: ID!, $after: String) { node(id: $id) { ... on Issue { ${field}(first: 100, after: $after) { nodes { ${selection} } ${page} } } } }`,
            { id: raw.id, after },
          );
          return result.node[field];
        });
      };
      const labels = await nested('labels', 'name', raw.labels);
      const assignees = await nested('assignees', 'login name', raw.assignees);
      issue = {
        id: raw.id,
        number: raw.number,
        url: raw.url,
        title: raw.title,
        state: raw.state,
        updatedAt: raw.updatedAt,
        closedAt: raw.closedAt ?? null,
        stateReason: raw.stateReason ?? null,
        parentId: raw.parent?.id ?? null,
        subIssueCount: raw.subIssues.totalCount,
        labels: labels.map((label) => label.name).sort(),
        assignees: assignees.sort((a, b) =>
          a.login.localeCompare(b.login, 'en'),
        ),
      };
    }
    items.push({
      id: item.id,
      archived: item.isArchived,
      type: item.type,
      hours: item.hours?.number ?? null,
      sprint: item.sprint?.iterationId
        ? {
            id: item.sprint.iterationId,
            title: item.sprint.title,
            startDate: item.sprint.startDate,
            duration: item.sprint.duration,
          }
        : null,
      issue,
    });
  }
  return {
    schemaVersion: 1,
    fetchedAt,
    fetchCompletedAt: new Date().toISOString(),
    project: { ...project, owner: config.owner, number: config.project },
    fields: { hours: config.hoursField, sprint: config.sprintField },
    iterations: [
      ...sprintField.configuration!.iterations,
      ...sprintField.configuration!.completedIterations,
    ].sort(
      (a, b) =>
        a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id),
    ),
    items: items.sort((a, b) => a.id.localeCompare(b.id, 'en')),
  };
}
