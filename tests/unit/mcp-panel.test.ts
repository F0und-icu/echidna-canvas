import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AppContext, type AppContextValue } from '../../web/app/context';
import { McpBinding } from '../../web/runtime/McpPanel';
import { addAgent, createWorkspace } from '../../web/model/workspace';
import { sampleConfig } from '../../web/model/fixtures';
import { project } from '../../web/model/projection';

it('shows historical bindings without exposing enabled runtime controls in a history view', () => {
  const workspace = addAgent(createWorkspace(), sampleConfig, '历史任务', 64, 320, 'agent');
  const view = project(workspace.events),
    connectionId = '8a4d1e4e-0c42-40e8-a9e1-d6ab2a86b65a';
  const value: AppContextValue = {
    workspace,
    canvas: { ...workspace.canvases[0], historySeq: workspace.events.length },
    view,
    live: view,
    setWorkspace: () => {},
    panel: null,
    openPanel: () => {},
    notify: () => {},
    focusAgent: () => {},
    focusArchive: () => {},
    mcp: {
      connections: [
        {
          id: connectionId,
          revision: 1,
          name: 'Docker fixture',
          kind: 'docker',
          url: 'http://localhost:8811/mcp',
          auth: { method: 'none' },
          hasSecret: false,
        },
      ],
      error: '',
      refresh: async () => {},
      remember: () => {},
    },
    runtime: {
      state: null,
      connected: true,
      backend: {
        backend: {
          id: 'codex',
          label: 'Codex',
          mode: 'live',
          capabilities: { chat: true, login: true, interrupt: true, mcp: true },
        },
        account: 'signed-in',
        models: [],
        notices: [],
      },
      error: '',
      connect: async () => undefined,
      refreshBackend: async () => {},
      command: async () => {
        throw new Error('Rendering cannot dispatch');
      },
      login: async () => {
        throw new Error('Rendering cannot authenticate');
      },
    },
  };
  const html = renderToStaticMarkup(
    createElement(
      AppContext.Provider,
      { value },
      createElement(McpBinding, { connectionId, agentId: 'agent' }),
    ),
  );
  expect(html).toContain('历史视图只查看当时的绑定');
  const button = html.match(/<button[^>]*>连接到此 Agent<\/button>/)![0];
  expect(button).toContain('disabled=""');
  expect(html).toContain('返回实时后配置');
});
