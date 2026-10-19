import type { AgentConfig, EventData, FixtureStep } from './schema';

export const sampleConfig: AgentConfig = {
  name: '溯源',
  avatar: 'echidna',
  model: 'GPT 系列（演示）',
  personality: '严谨地核对依据，区分已观察事实与未验证事项。',
};
export const sampleTask = '排查会话重启后未恢复';
export const materials = ['snapshot@v2', 'source@v3'];

export function makeFixture(
  sessionId: string,
  routeId: string,
  task: string,
  config: AgentConfig,
  corrected = false,
): FixtureStep[] {
  const steps: FixtureStep[] = [],
    childId = `${sessionId}/${routeId}/review`,
    delegationId = `${sessionId}/${routeId}/delegation`;
  const push = (data: EventData, actor = sessionId, route = routeId) =>
    steps.push({ sessionId: actor, routeId: route, data });
  const start = (roundId: string, title: string, refs: string[]) =>
    push({
      type: 'round.started',
      roundId,
      title,
      refs,
      input: {
        task,
        model: config.model,
        personality: config.personality,
        materials,
        contractVersion: 'offline-v1',
      },
    });
  const finish = (roundId: string, callId: string, result: string, artifact: string) =>
    push({
      type: 'tool.finished',
      roundId,
      callId,
      result,
      artifact,
      receipt: `fixture://${sessionId}/${routeId}/${roundId}/${callId}`,
    });
  start('s1', corrected ? '重新核对材料' : '先看实际输入', [corrected ? '用户补充' : '当前任务']);
  push({
    type: 'summary.delta',
    roundId: 's1',
    text: corrected ? '补充信息改变了检查顺序。' : '快照存在，只说明有文件。',
  });
  push({ type: 'summary.delta', roundId: 's1', text: '需要同时核对内容与恢复代码。' });
  push({
    type: 'tool.started',
    roundId: 's1',
    callId: 'c1',
    title: '读取快照',
    tool: 'read_file',
    args: { path: 'session.snapshot' },
  });
  push({
    type: 'tool.started',
    roundId: 's1',
    callId: 'c2',
    title: '读取恢复入口',
    tool: 'read_file',
    args: { path: 'src/session.rs' },
  });
  push({ type: 'model.completed', roundId: 's1' });
  finish('s1', 'c2', 'restore_session → validate_snapshot → load_records', '入口调用顺序');
  finish('s1', 'c1', '{"version":2,"record_count":8}', '快照 version = 2');
  push({ type: 'round.finished', roundId: 's1' });
  start('s2', '先区分两种解释', ['s1/c1', 's1/c2']);
  push({ type: 'summary.delta', roundId: 's2', text: '文件读取成功，' });
  push({ type: 'summary.delta', roundId: 's2', text: '仍不能区分入口未执行与格式不兼容。' });
  push({
    type: 'decision.recorded',
    roundId: 's2',
    options: [
      { id: 'entry', label: '先追踪入口', selected: false },
      { id: 'schema', label: '先核对格式', selected: true },
    ],
    reason: '格式检查成本更低；入口是否执行仍保留为待验证解释。',
    refs: ['s1/c1', 's1/c2'],
  });
  push({
    type: 'tool.prepared',
    roundId: 's2',
    callId: 'c3',
    title: '检查格式',
    tool: 'exec_command',
  });
  push({ type: 'tool.arguments.delta', roundId: 's2', callId: 'c3', text: '{"argv":["python",' });
  push({
    type: 'tool.arguments.delta',
    roundId: 's2',
    callId: 'c3',
    text: '"inspect_snapshot.py","session.snapshot"]}',
  });
  push({
    type: 'tool.started',
    roundId: 's2',
    callId: 'c3',
    title: '检查格式',
    tool: 'exec_command',
    args: { argv: ['python', 'inspect_snapshot.py', 'session.snapshot'] },
  });
  push({
    type: 'tool.started',
    roundId: 's2',
    callId: 'c4',
    title: '查兼容处理',
    tool: 'exec_command',
    args: { argv: ['rg', 'version|migrate', 'src/session'] },
  });
  push({ type: 'model.completed', roundId: 's2' });
  finish(
    's2',
    'c4',
    'validator: expected_version = 3; no migration handler in fixture',
    '读取器要求 v3',
  );
  finish(
    's2',
    'c3',
    'version_mismatch: expected 3, observed 2; payload readable',
    '格式检查未通过',
  );
  push({ type: 'round.finished', roundId: 's2' });
  start('s3', '反馈改变了下一步', ['s2/c3', 's2/c4']);
  push({
    type: 'summary.delta',
    roundId: 's3',
    text: '两项回传都指向版本差异。先做最小复现，并让独立 Agent 核对结论边界。',
  });
  push({
    type: 'decision.recorded',
    roundId: 's3',
    options: [
      { id: 'entry', label: '继续追踪入口', selected: false },
      { id: 'reproduce', label: '复现并独立复核', selected: true },
    ],
    reason: '新的工具回传缩小了检查范围；示例定位与真实影响仍需分别验证。',
    refs: ['s2/c3', 's2/c4'],
  });
  push({
    type: 'assessment.recorded',
    roundId: 's3',
    source: '示例事后评估',
    text: '上一轮选择是检查顺序，不是对真实环境根因的最终确认。',
  });
  push({
    type: 'tool.started',
    roundId: 's3',
    callId: 'c5',
    title: '复现加载',
    tool: 'exec_command',
    args: { argv: ['python', 'reproduce_restore.py', '--fixture', 'v2'] },
  });
  push({
    type: 'tool.started',
    roundId: 's3',
    callId: 'c6',
    title: '委派独立复核',
    tool: 'agent.spawn',
    args: { task: '核对版本差异的结论边界', input_refs: ['snapshot@v2', 's2/c3', 's2/c4'] },
  });
  push({ type: 'model.completed', roundId: 's3' });
  const childConfig: AgentConfig = {
    name: '审阅',
    avatar: 'deepseek-chibi',
    model: config.model,
    personality: '独立核对材料与验证边界。',
  };
  push({
    type: 'delegation.created',
    roundId: 's3',
    delegationId,
    childId,
    task: '独立复核版本差异的定位边界',
    materials: ['snapshot@v2', 's2/c3', 's2/c4'],
    criterion: '引用原始回传，区分示例与实际环境',
  });
  push({ type: 'session.created', config: childConfig, parentId: sessionId }, childId, 'r1');
  push(
    {
      type: 'route.started',
      task: '独立复核版本差异的定位边界',
      materials: ['snapshot@v2', 's2/c3', 's2/c4'],
      origin: null,
    },
    childId,
    'r1',
  );
  finish(
    's3',
    'c6',
    JSON.stringify({ agent_id: childId, status: 'created', task_status: 'waiting_for_acceptance' }),
    '子 Agent 创建回执',
  );
  finish(
    's3',
    'c5',
    'fixture reproduces VersionMismatch before load_records; production execution not tested',
    '示例复现记录',
  );
  push({ type: 'round.finished', roundId: 's3' });
  push({ type: 'delegation.accepted', delegationId });
  const childStart = (roundId: string, title: string, refs: string[]) =>
    push(
      {
        type: 'round.started',
        roundId,
        title,
        refs,
        input: {
          task: '独立复核版本差异的定位边界',
          model: config.model,
          personality: childConfig.personality,
          materials: ['snapshot@v2', 's2/c3', 's2/c4'],
          contractVersion: 'offline-v1',
        },
      },
      childId,
      'r1',
    );
  childStart('s1', '独立核对回传', ['snapshot@v2', '父 Agent 选定回传']);
  push(
    {
      type: 'tool.started',
      roundId: 's1',
      callId: 'c1',
      title: '核对复现记录',
      tool: 'read_artifact',
      args: { refs: ['s2/c3', 's2/c4'] },
    },
    childId,
    'r1',
  );
  push({ type: 'model.completed', roundId: 's1' }, childId, 'r1');
  push(
    {
      type: 'tool.finished',
      roundId: 's1',
      callId: 'c1',
      result: '回传可支持示例格式差异；没有真实环境收据',
      artifact: '独立复核材料',
      receipt: `fixture://${childId}/s1/c1`,
    },
    childId,
    'r1',
  );
  push({ type: 'round.finished', roundId: 's1' }, childId, 'r1');
  childStart('s2', '返回复核边界', ['s1/c1']);
  push(
    {
      type: 'response.delta',
      roundId: 's2',
      text: '采纳示例版本差异的定位。真实环境影响与修复有效性仍未验证。',
    },
    childId,
    'r1',
  );
  push({ type: 'model.completed', roundId: 's2' }, childId, 'r1');
  push({ type: 'usage.reported', roundId: 's2', input: 286, output: 76 }, childId, 'r1');
  push({ type: 'round.finished', roundId: 's2' }, childId, 'r1');
  push({
    type: 'delegation.returned',
    delegationId,
    result: '示例中存在版本不兼容；不能声称生产问题已修复。',
    artifact: 'review/result@1',
  });
  start('s4', '整理可交付的结论', ['s3/c5', `delegation/${delegationId}`]);
  push({
    type: 'summary.delta',
    roundId: 's4',
    text: '示例支持版本不兼容这条解释，实际环境影响还没有验证。',
  });
  push({
    type: 'decision.recorded',
    roundId: 's4',
    options: [
      { id: 'patch', label: '直接修改代码', selected: false },
      { id: 'report', label: '先交付定位结果', selected: true },
    ],
    reason: '复现只覆盖了示例输入，先交付观察到的差异与验证边界。',
    refs: ['s3/c5'],
  });
  push({
    type: 'delegation.adopted',
    delegationId,
    scope: '采纳示例定位与验证边界；不认定真实环境已修复',
    actor: sessionId,
  });
  push({ type: 'response.delta', roundId: 's4', text: '示例快照为 v2，读取器要求 v3。' });
  push({
    type: 'response.delta',
    roundId: 's4',
    text: '最小复现停在格式校验，尚未进入记录加载。实际环境仍待验证。',
  });
  push({ type: 'model.completed', roundId: 's4' });
  push({ type: 'usage.reported', roundId: 's4', input: 814, output: 207 });
  push({ type: 'round.finished', roundId: 's4' });
  return steps;
}
