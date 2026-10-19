import { useCallback, useEffect, useState } from 'react';
import { mcpIndexSchema, type McpConnection } from '../../contracts/mcp';
import { requestRuntime } from './connection';

export function mergeMcp(current: McpConnection[], incoming: McpConnection[]) {
  const entries = new Map(current.map((connection) => [connection.id, connection]));
  for (const connection of incoming)
    if (!entries.has(connection.id) || entries.get(connection.id)!.revision <= connection.revision)
      entries.set(connection.id, connection);
  return [...entries.values()];
}

export function useMcp(connected: boolean) {
  const [connections, setConnections] = useState<McpConnection[]>([]),
    [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      await requestRuntime('/session');
      const incoming = mcpIndexSchema.parse(await requestRuntime('/mcp-connections')).connections;
      setConnections((current) => mergeMcp(current, incoming));
      setError('');
    } catch (cause) {
      setError(String(cause));
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [connected, refresh]);
  const remember = (connection: McpConnection) =>
    setConnections((current) => mergeMcp(current, [connection]));
  return { connections, error, refresh, remember };
}
