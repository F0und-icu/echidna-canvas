import { useState, type FormEvent } from 'react';
import { useApp } from '../app/context';
import { activeRoute } from '../model/projection';
import type { AgentConfig, Avatar, Point } from '../model/schema';
import { appendEvent, applyProposal, sourceFor, updateCanvas } from '../model/workspace';
import { sampleConfig } from '../model/fixtures';
import { Character, avatarNames } from './Character';
import { CreateAgent } from './CreateAgent';

export function AgentSettings({ sessionId, point }: { sessionId?: string; point?: Point }) {
  return sessionId ? <OfflineAgentSettings sessionId={sessionId} /> : <CreateAgent point={point} />;
}

function OfflineAgentSettings({ sessionId }: { sessionId: string }) {
  const { workspace, live, setWorkspace, openPanel, focusAgent } = useApp(),
    session = live.sessions[sessionId];
  const initial = session?.config ?? { ...sampleConfig, name: '新 Agent' };
  const [config, setConfig] = useState<AgentConfig>(initial),
    [task, setTask] = useState(session?.routes.at(-1)?.task ?? '');
  const [error, setError] = useState('');
  if (!session) return <p role="alert">此 Agent 已不存在，请关闭面板后重新选择。</p>;
  if (!session.routes.length) return <p>Agent 已创建，正在等待任务绑定记录。</p>;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const cleaned = { ...config, name: config.name.trim() };
    if (!cleaned.name || !task.trim()) {
      setError('名称和任务不能只包含空白。');
      return;
    }
    const route = activeRoute(session),
      origin = sourceFor(workspace, session.id, route.id, null);
    setWorkspace((w) => {
      let next = appendEvent(w, session.id, route.id, {
        type: 'session.configured',
        config: cleaned,
      });
      if (task.trim() !== route.task) {
        next = updateCanvas(next, (c) => ({
          ...c,
          proposal: { text: task.trim(), source: origin },
        }));
        next = applyProposal(next);
      }
      return next;
    });
    openPanel(null);
    focusAgent(session.id, true);
  };
  return (
    <form className="stack" onSubmit={submit}>
      {error && <p role="alert">{error}</p>}
      <fieldset>
        <legend>角色形象</legend>
        <div className="avatar-picker">
          {Object.entries(avatarNames).map(([id, label]) => (
            <button
              type="button"
              key={id}
              aria-label={`选择${label}形象`}
              aria-pressed={config.avatar === id}
              onClick={() => setConfig((c) => ({ ...c, avatar: id as Avatar }))}
            >
              <Character avatar={id as Avatar} height={68} />
              <small>{label}</small>
            </button>
          ))}
        </div>
      </fieldset>
      <label>
        名称
        <input
          required
          maxLength={24}
          value={config.name}
          onChange={(e) => setConfig((c) => ({ ...c, name: e.target.value }))}
        />
      </label>
      <label>
        任务
        <textarea
          required
          maxLength={4000}
          rows={3}
          value={task}
          onChange={(e) => setTask(e.target.value)}
        />
      </label>
      <label>
        工作偏好 / 人格
        <textarea
          maxLength={2000}
          rows={3}
          value={config.personality}
          onChange={(e) => setConfig((c) => ({ ...c, personality: e.target.value }))}
        />
      </label>
      <label>
        模型（离线示例）
        <select
          value={config.model}
          onChange={(e) => setConfig((c) => ({ ...c, model: e.target.value }))}
        >
          {['GPT 系列（演示）', 'DeepSeek（演示）', 'Claude（演示）'].map((model) => (
            <option key={model}>{model}</option>
          ))}
        </select>
      </label>
      <details>
        <summary>账户与能力</summary>
        <p>此角色为离线画布示例。创建真实 Agent 时，可在 Harness 中选择已接入的 Codex。</p>
      </details>
      <button className="primary-button" type="submit">
        保存设置
      </button>
    </form>
  );
}
