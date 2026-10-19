import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';
import type { CanvasDocument, Point, Source, Workspace } from '../model/schema';
import type { Projection } from '../model/projection';
import type { RuntimeConnection } from '../runtime/useRuntime';
import type { useMcp } from '../runtime/useMcp';

export type Panel =
  | { kind: 'mcp'; id?: string }
  | { kind: 'mcp-bind'; connectionId: string; agentId: string }
  | { kind: 'create'; point?: Point }
  | { kind: 'agent'; sessionId: string }
  | { kind: 'chat'; source: Source }
  | { kind: 'round'; sessionId: string; routeId: string; roundId: string; nodeId?: string }
  | { kind: 'draft'; id: string }
  | { kind: 'link'; from: string; to: string }
  | { kind: 'handoff'; id: string }
  | { kind: 'runtime-agent'; sessionId: string }
  | { kind: 'files'; root?: string; path?: string; revisionId?: number }
  | {
      kind: 'appearance' | 'execution' | 'budget' | 'events' | 'relations' | 'handoffs' | 'runtime';
    };
export interface AppContextValue {
  workspace: Workspace;
  canvas: CanvasDocument;
  view: Projection;
  live: Projection;
  setWorkspace: Dispatch<SetStateAction<Workspace>>;
  panel: Panel | null;
  openPanel: (panel: Panel | null) => void;
  notify: (text: string) => void;
  focusAgent: (id: string, latest?: boolean) => void;
  focusArchive: (root?: string) => void;
  runtime: RuntimeConnection;
  mcp: ReturnType<typeof useMcp>;
}
export const AppContext = createContext<AppContextValue>(null!);
export const useApp = () => useContext(AppContext);
