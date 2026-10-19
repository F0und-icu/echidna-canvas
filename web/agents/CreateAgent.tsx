import { useEffect, useState, type FormEvent } from 'react';
import {
  Cable,
  CircleCheck,
  LoaderCircle,
  Sparkles,
  TerminalSquare,
  PencilLine,
  Folder,
  FolderPlus,
  Cpu,
} from 'lucide-react';
import { fileProjectsSchema, type FileProjects } from '../../contracts/files';
import { useApp } from '../app/context';
import { addAgent, newId } from '../model/workspace';
import { sampleConfig } from '../model/fixtures';
import { attachRuntimeAgent } from '../runtime/placement';
import { requestRuntime, RuntimeCommandRejected } from '../runtime/connection';
import { project } from '../model/projection';
import { currentCanvas } from '../model/workspace';
import { projectRegionBounds } from '../canvas/projectRegions';
import { useProjectArchive } from '../files/archive';
import type { AgentConfig, Avatar, Point } from '../model/schema';
import type { RuntimeCommand } from '../../contracts/runtime';
import { Character, avatarNames } from './Character';
import { OptionPicker } from '../app/OptionPicker';
import { HarnessAuth } from '../runtime/HarnessAuth';

export function CreateAgent({ point }: { point?: Point }) {
  const { runtime, setWorkspace, openPanel, focusAgent } = useApp();
  const archive = useProjectArchive();
  const [config, setConfig] = useState({ ...sampleConfig, name: '', personality: '' });
  const [task, setTask] = useState('');
  const [choice, setChoice] = useState('auto');
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [projects, setProjects] = useState<FileProjects | null>(null);
  const [projectChoice, setProjectChoice] = useState(''),
    [projectPath, setProjectPath] = useState('');
  const selectedProject = projectChoice === 'custom' ? projectPath.trim() : projectChoice;
  const [pending, setPending] = useState<Extract<RuntimeCommand, { type: 'agent.create' }> | null>(
    null,
  );
  const status = runtime.backend,
    offline = choice === 'offline';
  const selectedEntry =
    status?.models.find((entry) => entry.id === model) ??
    status?.models.find((entry) => entry.isDefault) ??
    (status?.models.length === 1 ? status.models[0] : undefined);
  const selectedModel = offline ? config.model : (selectedEntry?.id ?? '');
  const name =
    config.name.trim() ||
    (offline
      ? '离线 Agent'
      : `${status?.backend.label ?? 'Agent'}${selectedProject ? ' · ' + selectedProject.split('/').at(-1) : ''}`
    ).slice(0, 24);
  const fields = selectedEntry?.settings ?? [];
  const harness = choice === 'auto' ? status?.backend.id : choice.slice('harness:'.length);
  const ready =
    status !== null &&
    runtime.connected &&
    status.backend.id === harness &&
    status.account !== 'signed-out' &&
    status.backend.capabilities.chat;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const status = await runtime.connect();
        if (status) {
          const available = fileProjectsSchema.parse(await requestRuntime('/file-projects'));
          if (active) {
            setProjects(available);
            setProjectChoice(available.root);
          }
        }
      } catch (cause) {
        if (active) setError(String(cause));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [runtime.connect]);

  const reconnect = async () => {
    setLoading(true);
    setError('');
    try {
      const status = await runtime.connect();
      if (status) {
        const available = fileProjectsSchema.parse(await requestRuntime('/file-projects'));
        setProjects(available);
        setProjectChoice((current) => current || available.root);
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const initialTask = task.trim() || '自由交流';
    if (offline) {
      const id = newId(),
        at = point ?? { x: 64, y: 320 };
      setWorkspace((workspace) =>
        addAgent(workspace, { ...config, name }, initialTask, at.x, at.y, id),
      );
      openPanel(null);
      return;
    }
    if (
      !status ||
      !ready ||
      (!pending && !selectedProject) ||
      (!pending && (!selectedModel || !status.models.some((entry) => entry.id === selectedModel)))
    ) {
      setError('请连接所选 harness，并选择它提供的模型。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      let request = pending;
      if (!request) {
        const selected = fileProjectsSchema.parse(
          await requestRuntime('/file-projects/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ root: selectedProject }),
          }),
        );
        request = {
          version: 1,
          commandId: newId(),
          type: 'agent.create',
          harnessId: harness,
          projectRoot: selected.root,
          config: {
            ...config,
            name,
            model: selectedModel,
            ...(fields.length
              ? {
                  harnessSettings: Object.fromEntries(
                    fields
                      .map((field) => [field.key, settings[field.key] ?? field.defaultValue])
                      .filter(([, value]) => value !== ''),
                  ) as AgentConfig['harnessSettings'],
                }
              : {}),
          },
          task: initialTask,
        };
        setPending(request);
      }
      const result = await runtime.command(request);
      if (result.status !== 'acknowledged') {
        if (result.status === 'rejected') setPending(null);
        setError(result.error ?? '创建结果待核对，请保持此请求继续核对。');
        return;
      }
      setWorkspace((workspace) => {
        const board = currentCanvas(workspace),
          view = project(workspace.events),
          root = view.sessions[result.agentId].projectRoot!;
        const separate = !point && board.projectRoots?.length && !board.projectRoots.includes(root);
        const at = separate
          ? {
              x: 64,
              y:
                Math.max(
                  ...board.projectRoots!.map((project) => {
                    const box = projectRegionBounds(project, view, board, archive.indexes[project]);
                    return box.y + box.h;
                  }),
                ) + 240,
            }
          : point;
        return attachRuntimeAgent(workspace, result.agentId, at);
      });
      focusAgent(result.agentId);
      openPanel({ kind: 'runtime-agent', sessionId: result.agentId });
    } catch (cause) {
      if (cause instanceof RuntimeCommandRejected) setPending(null);
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack agent-create" onSubmit={(event) => void submit(event)}>
      <fieldset disabled={busy || !!pending} className="harness-picker">
        <legend>Harness</legend>
        <div role="group" aria-label="Harness" className="harness-cards">
          {[
            {
              id: 'auto',
              label: '自动选择',
              detail: status?.backend.label ?? '发现本地接入',
              icon: <Sparkles size={20} />,
            },
            ...(status
              ? [
                  {
                    id: 'harness:' + status.backend.id,
                    label: status.backend.label,
                    detail: status.backend.mode === 'fixture' ? '协议夹具' : '本地接入',
                    icon: <TerminalSquare size={20} />,
                  },
                ]
              : []),
            {
              id: 'offline',
              label: '离线画布',
              detail: '固定示例',
              icon: <PencilLine size={20} />,
            },
          ].map((entry) => (
            <button
              type="button"
              key={entry.id}
              aria-pressed={choice === entry.id}
              aria-label={
                entry.id === 'auto'
                  ? '自动选择 Harness'
                  : entry.id === 'offline'
                    ? '离线画布示例'
                    : `选择 ${entry.label} Harness`
              }
              onClick={() => {
                setChoice(entry.id);
                setError('');
              }}
            >
              <span className="harness-mark">{entry.icon}</span>
              <strong>{entry.label}</strong>
              <small>{entry.detail}</small>
            </button>
          ))}
        </div>
      </fieldset>
      {!offline && (
        <div className="harness-connection" data-connected={runtime.connected} role="status">
          {loading ? (
            <LoaderCircle size={16} className="connecting-icon" />
          ) : runtime.connected ? (
            <CircleCheck size={16} />
          ) : (
            <Cable size={16} />
          )}
          <span>
            {loading
              ? '正在自动连接本地 harness…'
              : runtime.connected
                ? `${status?.backend.label} 已连接${status?.backend.mode === 'fixture' ? ' · 固定示例' : ''}`
                : 'Harness 尚未连接'}
          </span>
          {!loading && !runtime.connected && (
            <button type="button" onClick={() => void reconnect()}>
              重新连接
            </button>
          )}
        </div>
      )}
      {(error || (!offline && runtime.error)) && <p role="alert">{error || runtime.error}</p>}
      {!offline && <HarnessAuth runtime={runtime} disabled={busy || !!pending} />}
      {!offline && (
        <fieldset className="agent-create-fields" disabled={busy || !!pending}>
          <OptionPicker
            label="项目档案"
            value={projectChoice}
            onChange={setProjectChoice}
            disabled={busy || !!pending}
            placeholder="选择本地项目目录"
            options={[
              ...(projects?.projects.map((root) => ({
                value: root,
                label: root.split('/').at(-1)!,
                description: root,
                icon: <Folder size={19} />,
              })) ?? []),
              {
                value: 'custom',
                label: '选择其他目录…',
                description: '绑定已有的本地文件夹',
                icon: <FolderPlus size={19} />,
              },
            ]}
          />
          {projectChoice === 'custom' && (
            <label>
              项目目录
              <input
                required
                aria-label="项目目录"
                placeholder="输入已有项目的绝对路径"
                maxLength={4096}
                value={projectPath}
                onChange={(event) => setProjectPath(event.target.value)}
              />
            </label>
          )}
          <small className="fine-print">
            创建 Agent 时同时添加项目档案与虚线项目区域，工作目录使用所选项目。
          </small>
        </fieldset>
      )}
      {!offline && (
        <fieldset className="agent-create-fields" disabled={busy || !!pending}>
          <OptionPicker
            label="模型"
            value={selectedModel}
            disabled={busy || !!pending}
            placeholder="等待 harness 提供模型"
            onChange={(value) => {
              setModel(value);
              setSettings({});
            }}
            options={
              status?.models.map((entry) => ({
                value: entry.id,
                label: entry.label,
                description: entry.isDefault ? 'Harness 默认模型' : entry.description,
                icon: <Cpu size={19} />,
              })) ?? []
            }
          />
          {fields.map((field) => (
            <OptionPicker
              key={selectedModel + '/' + field.key}
              label={field.label}
              value={settings[field.key] ?? field.defaultValue}
              disabled={busy || !!pending}
              options={field.options}
              onChange={(value) => setSettings((current) => ({ ...current, [field.key]: value }))}
            />
          ))}
        </fieldset>
      )}
      <details className="agent-identity">
        <summary>
          形象与描述 <span>{name}</span>
        </summary>
        <fieldset disabled={busy || !!pending}>
          <legend>角色形象</legend>
          <div className="avatar-picker">
            {Object.entries(avatarNames).map(([id, label]) => (
              <button
                type="button"
                key={id}
                aria-label={`选择${label}形象`}
                aria-pressed={config.avatar === id}
                onClick={() => setConfig((current) => ({ ...current, avatar: id as Avatar }))}
              >
                <Character avatar={id as Avatar} height={68} />
                <small>{label}</small>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="agent-create-fields" disabled={busy || !!pending}>
          <label>
            名称
            <input
              maxLength={24}
              value={config.name}
              placeholder={name}
              onChange={(event) =>
                setConfig((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>
          <label>
            任务（可稍后开始）
            <textarea
              aria-label="任务"
              maxLength={4000}
              rows={3}
              value={task}
              placeholder="自由交流；创建后发送消息才开始任务"
              onChange={(event) => setTask(event.target.value)}
            />
          </label>
          {offline && (
            <label>
              模型（离线示例）
              <select
                required
                value={selectedModel}
                onChange={(event) =>
                  setConfig((current) => ({ ...current, model: event.target.value }))
                }
              >
                {['GPT 系列（演示）', 'DeepSeek（演示）', 'Claude（演示）'].map((entry) => (
                  <option key={entry}>{entry}</option>
                ))}
              </select>
            </label>
          )}
          <details>
            <summary>画布备注 / 工作偏好</summary>
            <p className="fine-print">
              仅保存为画布备注，不追加到模型提示。运行时人格仅在模型支持时提供。
            </p>
            <textarea
              aria-label="工作偏好 / 人格"
              maxLength={2000}
              rows={3}
              value={config.personality}
              onChange={(event) =>
                setConfig((current) => ({ ...current, personality: event.target.value }))
              }
            />
          </details>
        </fieldset>
      </details>
      {!!pending && (
        <p className="fine-print">
          创建结果待核对，保留同一请求。连接中断时先重新连接，再核对创建结果。
        </p>
      )}
      <button
        className="primary-button"
        type="submit"
        disabled={
          busy ||
          (!offline && (!ready || loading || (!pending && (!selectedModel || !selectedProject))))
        }
      >
        {busy ? '正在创建…' : pending ? '核对创建结果' : '创建 Agent'}
      </button>
      <p className="fine-print">
        {offline
          ? '离线示例不连接真实 harness。'
          : '角色外观与 harness 独立。创建后打开独立会话，发送消息才开始任务。'}
      </p>
    </form>
  );
}
