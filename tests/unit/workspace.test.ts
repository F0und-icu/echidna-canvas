import { describe, expect, it } from 'vitest';
import { project, activeRoute, visibleSessions } from '../../web/model/projection';
import {
  appendEvent,
  applyProposal,
  createWorkspace,
  currentCanvas,
  deliveryBlock,
  duplicateCanvas,
  editDrafts,
  moveDraftHistory,
  openScenario,
  parseWorkspace,
  planKey,
  receiveNext,
  removeDrafts,
  updateCanvas,
} from '../../web/model/workspace';
import { loadWorkspace, storageKey } from '../../web/model/storage';
import { roundPosition, zoomAt } from '../../web/canvas/geometry';
import type { Draft, Workspace } from '../../web/model/schema';

const key = planKey('agent/main', 'r1');
function drain(workspace: Workspace): Workspace {
  let next = workspace;
  for (let i = 0; i < 100 && !deliveryBlock(next, key); i++) next = receiveNext(next, key);
  return next;
}
const session = (w: Workspace) => project(w.events).sessions['agent/main'];

describe('observable events and immutable inputs', () => {
  it('receives streaming arguments without marking an incomplete call as running', () => {
    const initial = createWorkspace();
    const preparing = project(
      initial.events,
      initial.events.find((e) => e.data.type === 'tool.arguments.delta')!.seq,
    );
    const call = preparing.sessions['agent/main'].routes[0].rounds[1].calls[0];
    expect(call.status).toBe('preparing');
    expect(call.argumentText).toBe('{"argv":["python",');
    expect(call.receipt).toBeUndefined();
    expect(activeRoute(session(initial)).rounds[1].calls.map((c) => [c.id, c.status])).toEqual([
      ['c3', 'running'],
      ['c4', 'returned'],
    ]);
  });
  it('keeps model completion, parallel results and the next decision separate', () => {
    const full = drain(createWorkspace()),
      rounds = session(full).routes[0].rounds;
    expect(rounds[1].decisions[0].options[1].label).toBe('先核对格式');
    expect(rounds[2].decisions[0].refs).toEqual(['s2/c3', 's2/c4']);
    expect(rounds[2].assessments[0].source).toBe('示例事后评估');
    const model = full.events.find(
      (e) => e.data.type === 'model.completed' && e.data.roundId === 's2',
    )!;
    const receipt = full.events.find(
      (e) => e.data.type === 'tool.finished' && e.data.callId === 'c3',
    )!;
    expect(model.seq).toBeLessThan(receipt.seq);
  });
  it('does not change earlier input snapshots when model settings change', () => {
    let w = createWorkspace();
    const old = structuredClone(session(w).routes[0].rounds[0].input);
    w = appendEvent(w, 'agent/main', 'r1', {
      type: 'session.configured',
      config: { ...session(w).config, model: 'Claude（演示）' },
    });
    w = drain(w);
    expect(session(w).routes[0].rounds[0].input).toEqual(old);
    expect(session(w).routes[0].rounds[2].input.model).toBe('Claude（演示）');
  });
});

describe('history and delegation', () => {
  it('reconstructs a frozen prefix without future roles, adoption or records', () => {
    const initial = createWorkspace(),
      prefix = initial.events.length,
      snapshot = project(initial.events),
      before = JSON.stringify(initial.events);
    const complete = drain(initial);
    expect(project(complete.events, prefix)).toEqual(snapshot);
    expect(JSON.stringify(initial.events)).toBe(before);
    expect(Object.keys(snapshot.sessions)).toHaveLength(1);
    expect(Object.keys(project(complete.events).sessions)).toHaveLength(2);
    expect(Object.values(snapshot.delegations)).toHaveLength(0);
  });
  it('preserves selected material versions and independent child call identities', () => {
    const w = drain(createWorkspace()),
      p = project(w.events),
      child = p.sessions['agent/main/r1/review'];
    expect(child.routes[0].materials).toEqual(['snapshot@v2', 's2/c3', 's2/c4']);
    expect(child.routes[0].origin).toMatchObject({
      sessionId: 'agent/main',
      routeId: 'r1',
      roundId: 's3',
    });
    expect(child.routes[0].origin?.eventSeq).toBe(Object.values(p.delegations)[0].createdSeq);
    expect(child.routes[0].originKind).toBe('fixture');
    expect(child.routes[0].rounds[0].summary).toBe('');
    expect(child.routes[0].rounds[0].calls[0].id).toBe('c1');
    expect(child.routes[0].rounds[0].calls[0].receipt).not.toBe(
      p.sessions['agent/main'].routes[0].rounds[0].calls[0].receipt,
    );
    const link = Object.values(p.delegations)[0];
    const returned = w.events.find((e) => e.data.type === 'delegation.returned')!,
      adopted = w.events.find((e) => e.data.type === 'delegation.adopted')!;
    expect(returned.seq).toBeLessThan(adopted.seq);
    expect(link.scope).toContain('不认定真实环境已修复');
    expect(visibleSessions(p, ['agent/main'])).toHaveLength(2);
  });
  it('keeps previously placed nodes stable as child events and routes arrive', () => {
    let w = createWorkspace();
    const p = project(w.events),
      c = currentCanvas(w),
      at = roundPosition(p.sessions['agent/main'], 'r1', 's1', p, c);
    w = drain(w);
    const after = project(w.events);
    expect(
      roundPosition(after.sessions['agent/main'], 'r1', 's1', after, currentCanvas(w)),
    ).toEqual(at);
  });
  it('opens all three deterministic scenes and reopens an existing scene without replay', () => {
    let w = createWorkspace();
    for (const scenario of ['feedback', 'steering', 'handoff'] as const) {
      w = openScenario(w, scenario);
      const count = w.events.length,
        canvases = w.canvases.length;
      w = openScenario(w, scenario);
      expect(w.events.length).toBe(count);
      expect(w.canvases.length).toBe(canvases);
    }
  });
});

describe('operator steering', () => {
  it('can receive an older route receipt after a correction without another dispatch', () => {
    let w = createWorkspace();
    w = updateCanvas(w, (c) => ({
      ...c,
      proposal: {
        text: '改用只读检查',
        source: {
          sessionId: 'agent/main',
          routeId: 'r1',
          roundId: 's2',
          eventSeq: w.events.length,
        },
      },
    }));
    w = applyProposal(w);
    expect(session(w).routes[0].rounds[1].calls[0].status).toBe('running');
    w = receiveNext(w, key);
    expect(session(w).routes[0].rounds[1].calls[0].status).toBe('returned');
    expect(
      w.events.filter((e) => e.data.type === 'tool.started' && e.data.callId === 'c3'),
    ).toHaveLength(1);
  });
  it('does not pause an independent child when only the parent sampling is paused', () => {
    let w = createWorkspace();
    while (w.replays[key].steps[w.replays[key].cursor].data.type !== 'delegation.accepted')
      w = receiveNext(w, key);
    w = receiveNext(w, key);
    w = appendEvent(w, 'agent/main', 'r1', { type: 'operator.paused' });
    w = drain(w);
    const p = project(w.events);
    expect(p.sessions['agent/main/r1/review'].routes[0].rounds).toHaveLength(2);
    expect(Object.values(p.delegations)[0].status).toBe('returned');
    expect(p.sessions['agent/main'].routes[0].rounds).toHaveLength(3);
  });
  it('binds the selected prefix even after later results arrive', () => {
    let w = createWorkspace();
    const old = structuredClone(session(w).routes[0].rounds),
      sourceSeq = old[0].lastSeq;
    w = updateCanvas(w, (c) => ({
      ...c,
      historySeq: sourceSeq,
      proposal: {
        text: '先验证真实环境',
        source: { sessionId: 'agent/main', routeId: 'r1', roundId: 's1', eventSeq: sourceSeq },
      },
    }));
    w = receiveNext(w, key);
    w = applyProposal(w);
    const routes = session(w).routes;
    expect(routes[1].origin?.eventSeq).toBe(sourceSeq);
    expect(routes[1].rounds[0].input.task).toBe('先验证真实环境');
    expect(routes[0].rounds[0]).toEqual(old[0]);
    expect(routes[0].paused).toBe(true);
    expect(currentCanvas(w).historySeq).toBeNull();
  });
  it('drains already dispatched results while pausing the next model request', () => {
    let w = appendEvent(createWorkspace(), 'agent/main', 'r1', { type: 'operator.paused' });
    w = drain(w);
    expect(session(w).routes[0].rounds).toHaveLength(2);
    expect(session(w).routes[0].rounds[1].calls.every((call) => call.status === 'returned')).toBe(
      true,
    );
    expect(deliveryBlock(w, key)).toBe('后续采样已暂停');
    w = appendEvent(w, 'agent/main', 'r1', { type: 'operator.resumed' });
    expect(deliveryBlock(w, key)).toBeNull();
  });
  it('does not manufacture cancellation or replay a command after reconnection', () => {
    let w = appendEvent(createWorkspace(), 'agent/main', 'r1', {
      type: 'tool.cancel.requested',
      roundId: 's2',
      callId: 'c3',
    });
    w = appendEvent(w, 'agent/main', 'r1', { type: 'connection.lost' });
    expect(receiveNext(w, key)).toBe(w);
    w = appendEvent(w, 'agent/main', 'r1', { type: 'connection.restored' });
    w = drain(w);
    const call = session(w).routes[0].rounds[1].calls[0];
    expect(call.status).toBe('returned');
    expect(call.cancelRequested).toBe(true);
    expect(
      w.events.filter((e) => e.data.type === 'tool.started' && e.data.callId === 'c3'),
    ).toHaveLength(1);
  });
});

describe('view documents and persistence boundaries', () => {
  it('copies the view with the same history provenance, without a new execution plan', () => {
    const w = drain(createWorkspace()),
      copy = duplicateCanvas(w);
    expect(copy.events).toBe(w.events);
    expect(copy.replays).toBe(w.replays);
    expect(currentCanvas(copy).rootSessions).toEqual(currentCanvas(w).rootSessions);
    expect(currentCanvas(copy).id).not.toBe(currentCanvas(w).id);
  });
  it('undoes, removes and restores a connected draft without changing execution facts', () => {
    const initial = createWorkspace(),
      base: Draft = {
        id: 'a',
        kind: 'action',
        title: '计划',
        x: 10,
        y: 10,
        w: 180,
        h: 80,
        points: [],
        from: null,
        to: null,
      };
    let w = editDrafts(initial, [
      base,
      { ...base, id: 'b' },
      { ...base, id: 'line', kind: 'relation', from: 'a', to: 'b' },
    ]);
    w = removeDrafts(w, ['a']);
    expect(currentCanvas(w).drafts.map((d) => d.id)).toEqual(['b']);
    w = moveDraftHistory(w, false);
    expect(currentCanvas(w).drafts).toHaveLength(3);
    expect(w.events).toBe(initial.events);
    expect(parseWorkspace(JSON.stringify(w))).toEqual(w);
  });
  it('keeps the zoom anchor fixed in screen space', () => {
    const viewport = { x: -150, y: 90, zoom: 0.8 },
      anchor = { x: 411, y: 273 },
      world = {
        x: (anchor.x - viewport.x) / viewport.zoom,
        y: (anchor.y - viewport.y) / viewport.zoom,
      };
    const next = zoomAt(viewport, 1.2, anchor);
    expect(world.x * next.zoom + next.x).toBeCloseTo(anchor.x);
    expect(world.y * next.zoom + next.y).toBeCloseTo(anchor.y);
  });
  it('preserves corrupt stored bytes and reports failure instead of silently resetting', () => {
    const raw = '{broken';
    const storage = {
      getItem: (key: string) => {
        expect(key).toBe(storageKey);
        return raw;
      },
    };
    const result = loadWorkspace(storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.raw).toBe(raw);
    expect(() => parseWorkspace(JSON.stringify({ ...createWorkspace(), version: 2 }))).toThrow();
  });
  it('rejects events whose source call does not exist', () => {
    const w = appendEvent(createWorkspace(), 'agent/main', 'r1', {
      type: 'tool.finished',
      roundId: 's2',
      callId: 'unknown',
      result: 'bad',
      artifact: 'bad',
      receipt: 'bad',
    });
    expect(() => parseWorkspace(JSON.stringify(w))).toThrow('Missing call');
  });
});
