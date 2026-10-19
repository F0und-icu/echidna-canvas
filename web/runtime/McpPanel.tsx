import { useEffect, useState, type FormEvent } from 'react';
import { PlugZap, Plus } from 'lucide-react';
import { useApp } from '../app/context';
import { newId, updateCanvas } from '../model/workspace';
import {
  mcpConnectionSchema,
  mcpServerName,
  mcpStatusSchema,
  type McpConnection,
  type SaveMcp,
} from '../../contracts/mcp';
import { project, visibleSessions } from '../model/projection';
import { agentPosition } from '../canvas/geometry';
import type { RuntimeCommand } from '../../contracts/runtime';
import { requestRuntime, RuntimeCommandRejected } from './connection';
import { OptionPicker } from '../app/OptionPicker';

export function McpIcon({ kind, size = 30 }: { kind: McpConnection['kind']; size?: number }) {
  if (kind === 'mcp') return <PlugZap size={size} aria-hidden="true" />;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="currentColor" aria-hidden="true">
      <path d="M3 25h29c3 0 5-2 5-5-2-1-3-3-2-6 3 0 5 3 5 5 3-1 5 0 6 1-1 4-5 6-9 6-3 10-10 14-19 14C9 40 4 35 3 25Z" />
      {[
        [9, 18],
        [17, 18],
        [25, 18],
        [17, 10],
        [25, 10],
        [25, 2],
      ].map(([x, y]) => (
        <rect key={x + '/' + y} x={x} y={y} width="6" height="6" rx=".7" />
      ))}
      <circle cx="10" cy="29" r="1.3" fill="var(--ec-paper)" />
    </svg>
  );
}

export function McpPanel({ id }: { id?: string }) {
  const { mcp, runtime, openPanel } = useApp();
  useEffect(() => {
    void runtime.connect();
  }, [runtime.connect]);
  const existing = mcp.connections.find((connection) => connection.id === id);
  if (id && !existing)
    return (
      <div className="stack">
        <p>MCP 配置尚未加载。</p>
        {mcp.error && <p role="alert">{mcp.error}</p>}
        <button onClick={() => void mcp.refresh()}>重新读取接入</button>
      </div>
    );
  return (
    <div className="stack">
      {runtime.error && <p role="alert">{runtime.error}</p>}
      {!id && (
        <p className="fine-print">接入独立于 Agent 保存。放到画布后，用连线工具连接目标角色。</p>
      )}
      <McpEditor key={id ?? 'new'} existing={existing} />
      {!id && mcp.connections.length > 0 && (
        <section className="stack">
          <h4>已有接入</h4>
          {mcp.connections.map((connection) => (
            <button
              className="mcp-list-item"
              key={connection.id}
              onClick={() => openPanel({ kind: 'mcp', id: connection.id })}
            >
              <McpIcon kind={connection.kind} size={24} />
              <span>
                {connection.name}
                <small>
                  {new URL(connection.url).host} · v{connection.revision}
                </small>
              </span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

function McpEditor({ existing }: { existing?: McpConnection }) {
  const { mcp, runtime, canvas, live, setWorkspace, openPanel } = useApp();
  const [kind, setKind] = useState<McpConnection['kind']>(existing?.kind ?? 'docker');
  const [name, setName] = useState(existing?.name ?? 'Docker MCP'),
    [url, setUrl] = useState(existing?.url ?? '');
  const [method, setMethod] = useState<SaveMcp['auth']['method']>(existing?.auth.method ?? 'none');
  const [header, setHeader] = useState(
    existing?.auth.method === 'header' ? existing.auth.headerName : 'X-API-Key',
  );
  const [secret, setSecret] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const place = (connection: McpConnection) =>
    setWorkspace((workspace) =>
      updateCanvas(workspace, (board) => {
        const view = project(workspace.events);
        const agents = visibleSessions(view, board.rootSessions).map((session) =>
          agentPosition(session, view, board),
        );
        const at = agents.length
          ? {
              x: Math.min(...agents.map((at) => at.x)) - 240,
              y:
                (Math.min(...agents.map((at) => at.y)) + Math.max(...agents.map((at) => at.y))) /
                  2 +
                (board.connectionIds?.length ?? 0) * 140,
            }
          : {
              x: (160 - board.viewport.x) / board.viewport.zoom,
              y: (250 - board.viewport.y) / board.viewport.zoom,
            };
        return {
          ...board,
          connectionIds: [...new Set([...(board.connectionIds ?? []), connection.id])],
          positions: board.connectionIds?.includes(connection.id)
            ? board.positions
            : { ...board.positions, ['mcp:' + connection.id]: at },
          follow: false,
        };
      }),
    );
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const submittedSecret = secret;
    setSecret('');
    try {
      const connection = mcpConnectionSchema.parse(
        await requestRuntime('/mcp-connections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(existing ? { id: existing.id, baseRevision: existing.revision } : {}),
            name,
            kind,
            url,
            auth: method === 'header' ? { method, headerName: header } : { method },
            ...(submittedSecret ? { secret: submittedSecret } : {}),
          }),
        }),
      );
      mcp.remember(connection);
      place(connection);
      openPanel({ kind: 'mcp', id: connection.id });
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <form className="stack" onSubmit={(event) => void save(event)}>
        <div className="auth-methods" role="group" aria-label="接入图标">
          <button
            type="button"
            aria-pressed={kind === 'docker'}
            onClick={() => {
              setKind('docker');
              if (!existing) setName('Docker MCP');
            }}
          >
            <McpIcon kind="docker" />
            <span>Docker</span>
          </button>
          <button
            type="button"
            aria-pressed={kind === 'mcp'}
            onClick={() => {
              setKind('mcp');
              if (!existing) setName('MCP 接入');
            }}
          >
            <PlugZap size={27} />
            <span>通用 MCP</span>
          </button>
        </div>
        <label>
          接入名称
          <input
            required
            maxLength={40}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          MCP 地址
          <input
            required
            type="url"
            placeholder="http://localhost:8811/mcp"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <OptionPicker
          label="MCP 认证方式"
          value={method}
          disabled={busy}
          onChange={(value) => {
            setMethod(value as SaveMcp['auth']['method']);
            setSecret('');
          }}
          options={[
            { value: 'none', label: '无需认证' },
            { value: 'bearer', label: 'Bearer Token' },
            { value: 'header', label: 'API Key / 自定义 Header' },
            { value: 'oauth', label: 'OAuth 外部登录' },
          ]}
        />
        {method === 'header' && (
          <label>
            Header 名称
            <input required value={header} onChange={(event) => setHeader(event.target.value)} />
          </label>
        )}
        {(method === 'bearer' || method === 'header') && (
          <label>
            认证密钥
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={secret}
              placeholder={
                existing?.hasSecret
                  ? '留空保留当前密钥；改地址后需重新填写'
                  : '仅交给本机接入服务保存'
              }
              onChange={(event) => setSecret(event.target.value)}
            />
          </label>
        )}
        <p className="fine-print">
          Streamable HTTP
          接入。密钥保存在本机专用凭据目录，不进入画布、配置列表或导出。修改配置生成新版本，已有绑定保持原版，需重新应用。
        </p>
        {(error || mcp.error) && <p role="alert">{error || mcp.error}</p>}
        <button className="primary-button" disabled={busy || !runtime.connected} type="submit">
          {busy ? '正在保存…' : existing ? '保存接入配置' : '创建并放到画布'}
        </button>
      </form>
      {existing && (
        <>
          {!canvas.connectionIds?.includes(existing.id) && (
            <button onClick={() => place(existing)}>
              <Plus size={15} /> 放到当前画布
            </button>
          )}
          <h4>连接到 Agent</h4>
          <p className="fine-print">
            也可用连线工具 L，从接入图标拖到不同项目的 Agent。配置确认后才显示接入线。
          </p>
          {canvas.rootSessions
            .filter((id) => live.sessions[id]?.runtime?.backendId === 'codex')
            .map((id) => (
              <button
                key={id}
                onClick={() =>
                  openPanel({ kind: 'mcp-bind', connectionId: existing.id, agentId: id })
                }
              >
                {live.sessions[id].config.name}{' '}
                {live.sessions[id].connections?.some((ref) => ref.id === existing.id)
                  ? '· 已绑定'
                  : ''}
              </button>
            ))}
        </>
      )}
    </>
  );
}

export function McpBinding({ connectionId, agentId }: { connectionId: string; agentId: string }) {
  const { view, canvas, runtime, mcp, notify, setWorkspace } = useApp();
  const connection = mcp.connections.find((connection) => connection.id === connectionId),
    session = view.sessions[agentId];
  const history = canvas.historySeq !== null;
  const [pending, setPending] = useState<Extract<
    RuntimeCommand,
    { type: 'agent.mcp.configure' }
  > | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [authUrl, setAuthUrl] = useState('');
  const [inventory, setInventory] = useState<ReturnType<typeof mcpStatusSchema.parse> | null>(null);
  if (!connection || !session) return <p>请连接服务并选择已加载的接入与 Agent。</p>;
  const bound = session.connections?.find((ref) => ref.id === connectionId);
  const apply = async (remove = false) => {
    setBusy(true);
    setError('');
    setInventory(null);
    const command: Extract<RuntimeCommand, { type: 'agent.mcp.configure' }> = pending ?? {
      version: 1,
      commandId: newId(),
      type: 'agent.mcp.configure',
      agentId,
      connections: [
        ...(session.connections ?? []).filter((ref) => ref.id !== connectionId),
        ...(remove ? [] : [{ id: connection.id, revision: connection.revision }]),
      ],
    };
    setPending(command);
    try {
      const result = await runtime.command(command);
      if (result.status === 'acknowledged') {
        setPending(null);
        notify(remove ? 'MCP 接入已从此 Agent 移除' : '接入配置已绑定，工具可用性请查看实际状态');
      } else {
        if (result.status === 'rejected') setPending(null);
        setError(result.error ?? '接入配置结果待核对。');
      }
    } catch (cause) {
      if (cause instanceof RuntimeCommandRejected) setPending(null);
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const check = async () => {
    setBusy(true);
    setError('');
    try {
      setInventory(
        mcpStatusSchema.parse(
          await requestRuntime('/mcp-status?agentId=' + encodeURIComponent(agentId)),
        ),
      );
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const login = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await requestRuntime('/mcp-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, connectionId }),
      });
      setAuthUrl((result as { url: string }).url);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const status = inventory?.find((entry) => entry.id === mcpServerName(connection.id));
  return (
    <div className="stack">
      <div className="mcp-binding-title">
        <McpIcon kind={connection.kind} size={38} />
        <strong>{connection.name}</strong>
        <span>→</span>
        <strong>{session.config.name}</strong>
      </div>
      <small>{session.projectRoot}</small>
      {history && (
        <p className="fine-print">
          历史视图只查看当时的绑定。
          <button
            onClick={() =>
              setWorkspace((workspace) =>
                updateCanvas(workspace, (board) => ({ ...board, historySeq: null })),
              )
            }
          >
            返回实时后配置
          </button>
        </p>
      )}
      <p className="fine-print">
        在 Agent 空闲时应用。Codex
        会继承已记录对话并创建新的底层会话，原历史保留；不会启动模型或重新执行工具。
      </p>
      <p>
        {bound ? `当前绑定 v${bound.revision}，配置最新 v${connection.revision}` : '尚未绑定此接入'}
      </p>
      {(error || runtime.error) && <p role="alert">{error || runtime.error}</p>}
      <button
        className="primary-button"
        disabled={
          history || busy || !runtime.connected || !runtime.backend?.backend.capabilities.mcp
        }
        onClick={() => void apply()}
      >
        {busy ? '正在处理…' : pending ? '核对同一请求' : bound ? '应用当前配置' : '连接到此 Agent'}
      </button>
      {bound && (
        <>
          <button disabled={history || busy || !!pending} onClick={() => void apply(true)}>
            断开此 Agent 的接入
          </button>
          <button disabled={history || busy || !!pending} onClick={() => void check()}>
            读取实际工具状态
          </button>
          {bound.revision === connection.revision && connection.auth.method === 'oauth' && (
            <button disabled={history || busy || !!pending} onClick={() => void login()}>
              在外部登录此 MCP
            </button>
          )}
          {authUrl && (
            <a href={authUrl} target="_blank" rel="noopener noreferrer">
              打开 MCP 授权页面
            </a>
          )}
        </>
      )}
      {inventory && (
        <p role="status">
          {status
            ? `${status.toolCount} 个实际返回的工具 · ${status.authStatus === 'unsupported' ? '服务未声明 OAuth' : '认证状态 ' + status.authStatus}`
            : '当前返回的 MCP 目录中没有此接入，尚未确认可用。'}
        </p>
      )}
      {status?.error && <p role="alert">{status.error}</p>}
      {status?.state && <small>连接状态：{status.state}</small>}
      {pending && <p className="fine-print">保留同一命令身份核对；未知结果不会自动再次派发。</p>}
    </div>
  );
}
