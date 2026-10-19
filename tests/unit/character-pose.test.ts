import { expect, it } from 'vitest';
import { graphWorkspace } from '../fixtures/canvas-graph';
import { project } from '../../web/model/projection';
import { executionPose, sessionPose } from '../../web/agents/characterPose';
import type { EventData } from '../../web/model/schema';

function at(type: EventData['type']) {
  const workspace = graphWorkspace();
  const end = workspace.events.findIndex((event) => event.data.type === type) + 1;
  expect(end).toBeGreaterThan(0);
  const view = project(workspace.events, end);
  const session = view.sessions['graph-agent'];
  const route = session.routes[0];
  return { view, session, route, round: route.rounds.at(-1)! };
}

it('changes actions from actual event prefixes without leaking future completion', () => {
  for (const [event, pose] of [
    ['round.started', 'thinking'],
    ['tool.started', 'working'],
    ['tool.finished', 'reading'],
    ['response.updated', 'talking'],
    ['round.terminated', 'reporting'],
  ] as const) {
    const { view, session, round, route } = at(event);
    expect(executionPose(session.id, round, route, view.events)).toBe(pose);
  }
});

it('opening chat does not replace running tools with a greeting', () => {
  const { view, session } = at('tool.started');
  expect(sessionPose(session, view.events, { kind: 'runtime-agent', sessionId: session.id })).toBe(
    'working',
  );
  expect(
    sessionPose(session, view.events, {
      kind: 'round',
      sessionId: session.id,
      routeId: 'r1',
      roundId: 'turn-1',
      nodeId: 'note:choice',
    }),
  ).toBe('pointing');
});

it('compares an incoming decision without requiring the user to select it', () => {
  const workspace = graphWorkspace();
  const end =
    workspace.events.findIndex(
      (event) => event.data.type === 'canvas.noted' && event.data.note.kind === 'decision',
    ) + 1;
  const view = project(workspace.events, end);
  expect(sessionPose(view.sessions['graph-agent'], view.events)).toBe('pointing');
  const last = view.events.at(-1)!;
  const next = {
    ...last,
    id: 'blank-summary',
    seq: last.seq + 1,
    data: { type: 'summary.updated' as const, roundId: 'turn-1', text: '\n\n' },
  };
  const withBlank = project([...view.events, next]);
  expect(sessionPose(withBlank.sessions['graph-agent'], withBlank.events)).toBe('pointing');
});

it('reacts to incoming annotations and keeps pause and unknown effects distinct from a report', () => {
  const { view, session, route, round } = at('canvas.noted');
  const event = view.events.at(-1)!;
  if (event.data.type !== 'canvas.noted') throw new Error('Expected note fixture');
  for (const [kind, pose] of [
    ['material', 'reading'],
    ['observation', 'reading'],
    ['result', 'reporting'],
    ['intent', 'thinking'],
  ] as const) {
    event.data.note.kind = kind;
    expect(sessionPose(session, view.events)).toBe(pose);
  }
  route.paused = true;
  expect(sessionPose(session, view.events)).toBe('waiting');
  route.paused = false;
  route.connected = false;
  expect(executionPose(session.id, round, route, view.events)).toBe('waiting');
});
