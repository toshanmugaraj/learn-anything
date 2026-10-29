export type ConceptStatus = 'unexplored' | 'in_progress' | 'needs_practice' | 'mastered';

export interface FsEntry {
  name: string;
  path: string;
  isCargo: boolean;
}

export interface FsListing {
  path: string;
  parent: string | null;
  isCargo: boolean;
  entries: FsEntry[];
}

export interface FileRef {
  path: string;
  startLine: number;
  endLine: number;
}

export interface Functionality {
  id: string;
  title: string;
  description: string;
  requirements: string[];
  files: FileRef[];
  concepts: string[];
}

export interface Analysis {
  purpose: string;
  functionalities: Functionality[];
}

export interface Project {
  slug: string;
  name: string;
  path: string;
  status: 'idle' | 'running' | 'done' | 'error';
  error: string | null;
  analysis: Analysis | null;
  ticks: string[];
}

export interface Snippet extends FileRef {
  totalLines: number;
  code: string;
  language: 'rust' | 'toml';
}

export interface ConceptNote {
  slug: string;
  name: string;
  domain: string;
  note: string;
  file?: string;
  lines?: [number, number];
}

export interface FunctionalityDetail {
  functionality: Functionality;
  files: Snippet[];
  explanation: { summary: string; concepts: ConceptNote[] } | null;
  explainStatus: 'idle' | 'running' | 'done' | 'error';
  explainError: string | null;
}

export interface GraphConcept {
  name: string;
  slug: string;
  status: ConceptStatus;
  confidence: number;
  explain_count: number;
}

export interface Graph {
  topic: string;
  slug: string;
  domains: { name: string; slug: string; concepts: GraphConcept[] }[];
}

export interface ProgressResult {
  ticks: string[];
  graph: Graph;
}
