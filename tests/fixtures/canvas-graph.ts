import { createWorkspace, emptyCanvas } from '../../web/model/workspace';
import { eventSchema, type EventData } from '../../web/model/schema';

export function graphWorkspace() {
  const workspace = createWorkspace();
  const data: EventData[] = [
    {
      type: 'session.created',
      config: { name: '图形测试', model: 'fixture', avatar: 'echidna', personality: '' },
      parentId: null,
    },
    { type: 'route.started', task: '比较通信并核对材料', materials: [], origin: null },
    {
      type: 'round.started',
      roundId: 'turn-1',
      unit: 'turn',
      title: '通信方式核对',
      refs: [],
      input: {
        task: '为本地画布选择通信方式',
        model: 'fixture',
        personality: '',
        materials: [],
        contractVersion: 'runtime-v1',
      },
    },
    {
      type: 'canvas.noted',
      roundId: 'turn-1',
      noteId: 'goal',
      note: {
        kind: 'intent',
        title: '连续推送任务进展',
        detail: '只需要服务到浏览器的进度流。',
        refs: [],
        options: [],
      },
    },
    {
      type: 'canvas.noted',
      roundId: 'turn-1',
      noteId: 'choice',
      note: {
        kind: 'decision',
        title: '选择 SSE 通道',
        detail: '明确的单向推送需求。',
        refs: ['note:goal'],
        options: [
          { id: 'sse', label: 'SSE', selected: true },
          { id: 'ws', label: 'WebSocket', selected: false },
        ],
      },
    },
    {
      type: 'tool.started',
      roundId: 'turn-1',
      callId: 'read',
      title: '读取样本说明',
      tool: 'fixture.read',
      args: { path: 'README.md' },
    },
    {
      type: 'tool.finished',
      roundId: 'turn-1',
      callId: 'read',
      result: 'Synthetic sample contents',
      artifact: '样本说明',
      receipt: 'fixture:receipt',
    },
    {
      type: 'canvas.noted',
      roundId: 'turn-1',
      noteId: 'source',
      note: {
        kind: 'material',
        title: '样本运行说明',
        detail: '此材料来自离线 Fixture，不是真实项目。',
        refs: ['tool:read'],
        options: [],
      },
    },
    {
      type: 'canvas.noted',
      roundId: 'turn-1',
      noteId: 'result',
      note: {
        kind: 'result',
        title: '命令与事件分离',
        detail: '用户命令走 HTTP，进度由 SSE 返回。',
        refs: ['note:choice', 'note:source'],
        options: [],
      },
    },
    {
      type: 'response.updated',
      roundId: 'turn-1',
      text: '在此虚构样本中，HTTP 命令配合 SSE 进度推送符合需求。',
    },
    { type: 'round.terminated', roundId: 'turn-1', status: 'completed', error: null },
  ];
  workspace.events = data.map((entry, i) =>
    eventSchema.parse({
      id: 'graph/' + i,
      seq: i + 1,
      sessionId: 'graph-agent',
      routeId: 'r1',
      source: 'fixture',
      data: entry,
    }),
  );
  const canvas = emptyCanvas('graph', '图形演示');
  canvas.rootSessions = ['graph-agent'];
  canvas.selectedSession = 'graph-agent';
  canvas.positions = { 'graph-agent': { x: 40, y: 300 } };
  canvas.follow = false;
  workspace.canvases = [canvas];
  workspace.activeCanvas = canvas.id;
  workspace.replays = {};
  return workspace;
}
