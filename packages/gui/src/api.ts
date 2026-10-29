import type { FsListing, FunctionalityDetail, Graph, ProgressResult, Project } from './types';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  listDirs: (path = '') => request<FsListing>('GET', `/api/fs?path=${enc(path)}`),
  openProject: (path: string, refresh = false) =>
    request<Project>('POST', '/api/projects', { path, refresh }),
  getProject: (slug: string) => request<Project>('GET', `/api/projects/${enc(slug)}`),
  getFunctionality: (slug: string, id: string) =>
    request<FunctionalityDetail>('GET', `/api/projects/${enc(slug)}/functionalities/${enc(id)}`),
  explain: (slug: string, id: string, refresh = false) =>
    request<FunctionalityDetail>(
      'POST',
      `/api/projects/${enc(slug)}/functionalities/${enc(id)}/explain`,
      { refresh },
    ),
  setProgress: (project: string, conceptSlug: string, checked: boolean) =>
    request<ProgressResult>('PUT', '/api/progress', { project, conceptSlug, checked }),
  getGraph: () => request<Graph>('GET', '/api/graph'),
};
