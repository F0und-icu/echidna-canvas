import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { Workspace } from '../model/schema';
import type { RuntimeCommand, RuntimeState, BackendStatus } from '../../contracts/runtime';
import {
  mergeRuntime,
  parseRuntimeFeed,
  requestRuntime,
  runtimeSnapshot,
  sendRuntimeCommand,
  readBackend,
  loginRuntime,
  RuntimeCommandRejected,
} from './connection';

export function useRuntime(
  workspace: Workspace,
  setWorkspace: Dispatch<SetStateAction<Workspace>>,
) {
  const [state, setState] = useState<RuntimeState | null>(null),
    [backend, setBackend] = useState<BackendStatus | null>(null),
    [error, setError] = useState(''),
    [connected, setConnected] = useState(false);
  const stream = useRef<EventSource | null>(null),
    current = useRef(workspace),
    connecting = useRef<Promise<BackendStatus | undefined> | null>(null);
  const latest = useRef<RuntimeState | null>(null);
  current.current = workspace;
  const accept = useCallback(
    (feed: RuntimeState) => {
      if (latest.current?.storeId === feed.storeId && feed.revision < latest.current.revision)
        return;
      // Validate before scheduling a React update so malformed input cannot crash rendering.
      const base = current.current;
      const merged = mergeRuntime(base, feed);
      current.current = merged;
      setWorkspace((w) => (w === base ? merged : mergeRuntime(w, feed)));
      setState(feed);
      latest.current = feed;
    },
    [setWorkspace],
  );
  const connect = useCallback(() => {
    if (connecting.current) return connecting.current;
    const operation = async () => {
      stream.current?.close();
      setConnected(false);
      try {
        await requestRuntime('/session');
        const snapshot = await runtimeSnapshot();
        accept(snapshot);
        const status = await readBackend();
        setBackend(status);
        const source = new EventSource(`/api/runtime/events?after=${snapshot.cursor}`);
        stream.current = source;
        source.onopen = () => {
          setConnected(true);
          setError('');
        };
        source.onmessage = (event) => {
          try {
            accept(parseRuntimeFeed(event.data));
          } catch (failure) {
            source.close();
            setConnected(false);
            setError(String(failure));
          }
        };
        source.onerror = () => {
          source.close();
          setConnected(false);
          setError('事件连接中断。重新连接只补齐记录，不重复派发命令。');
        };
        return status;
      } catch (failure) {
        setConnected(false);
        setError(`无法连接本地服务：${String(failure)}`);
      } finally {
        connecting.current = null;
      }
    };
    connecting.current = operation();
    return connecting.current;
  }, [accept]);
  useEffect(() => () => stream.current?.close(), []);
  const command = useCallback(
    async (input: RuntimeCommand) => {
      setError('');
      try {
        const result = await sendRuntimeCommand(input);
        // Notifications and this response may race; obtain one committed prefix afterwards.
        accept(await runtimeSnapshot());
        return result;
      } catch (failure) {
        if (failure instanceof RuntimeCommandRejected) {
          setError(failure.message);
          throw failure;
        }
        stream.current?.close();
        setConnected(false);
        setError(`命令结果未确认，请先核对记录：${String(failure)}`);
        throw failure;
      }
    },
    [accept],
  );
  const refreshBackend = async () => {
    try {
      setBackend(await readBackend());
      setError('');
    } catch (failure) {
      setError(String(failure));
    }
  };
  return {
    state,
    backend,
    error,
    connected,
    connect,
    command,
    refreshBackend,
    login: loginRuntime,
  };
}
export type RuntimeConnection = ReturnType<typeof useRuntime>;
