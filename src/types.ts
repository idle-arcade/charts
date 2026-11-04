export type Dimension = {
  key: string;
  title: string;
  prefix?: string;
  source?: 'assignee';
  order?: string[];
  colors?: Record<string, string>;
};
export type Config = {
  owner: string;
  project: number;
  hoursField: string;
  sprintField: string;
  title: string;
  dimensions: Dimension[];
};
export type Sprint = {
  id: string;
  title: string;
  startDate: string;
  duration: number;
};
export type Issue = {
  id: string;
  number: number;
  url: string;
  title: string;
  state: string;
  updatedAt: string;
  closedAt?: string | null;
  stateReason?: string | null;
  parentId: string | null;
  subIssueCount: number;
  labels: string[];
  assignees: { login: string; name: string | null }[];
};
export type Item = {
  id: string;
  archived: boolean;
  type: string;
  hours: number | null;
  sprint: Sprint | null;
  issue: Issue | null;
};
export type Snapshot = {
  schemaVersion: 1;
  fetchedAt: string;
  fetchCompletedAt: string;
  project: {
    id: string;
    owner: string;
    number: number;
    title: string;
    url: string;
  };
  fields: { hours: string; sprint: string };
  iterations: Sprint[];
  items: Item[];
};
export type Diagnostic = {
  itemId: string;
  url?: string;
  code: string;
  message: string;
};
export type Effort = {
  issueId: string;
  itemId: string;
  url: string;
  title: string;
  hours: number;
  sprint: Sprint | null;
  categories: Record<string, string>;
};
export type Bucket = {
  category: string;
  hours: number;
  percentage: number;
  issues: number;
};
export type Result = {
  totalHours: number;
  included: Effort[];
  diagnostics: Diagnostic[];
  aggregates: Record<string, Bucket[]>;
};
