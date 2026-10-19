import { requestRuntime } from '../runtime/connection';

// Pin every file operation to its project, including requests already in flight during a switch.
export function requestProject(root: string, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set('X-Echidna-Project', encodeURIComponent(root));
  headers.set('X-Echidna-Project-Bound', 'true');
  return requestRuntime(path, { ...init, headers });
}
