import { expect, test, type Page } from '@playwright/test';
import {
  createWorkspace,
  currentCanvas,
  deliveryBlock,
  duplicateCanvas,
  planKey,
  receiveNext,
  updateCanvas,
} from '../../web/model/workspace';
import type { Workspace } from '../../web/model/schema';
import { readWorkspace } from './storage';
import type { McpConnection } from '../../contracts/mcp';

async function seed(page: Page, workspace: Workspace, connections: McpConnection[] = []) {
  // No backend writes or model calls: this suite exercises persisted view edits.
  await page.route('**/api/runtime/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const metadata = path === '/api/runtime/mcp-connections';
    const session = path === '/api/runtime/session';
    return route.fulfill({
      status: metadata || session ? 200 : 503,
      contentType: 'application/json',
      body: JSON.stringify(
        metadata ? { connections } : session ? {} : { error: 'Offline view test' },
      ),
    });
  });
  await page.addInitScript(
    (raw) => localStorage.setItem('echidna-canvas.offline.v1', raw),
    JSON.stringify(workspace),
  );
  await page.goto('/');
  await saved(page);
}
async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: '已保存在此浏览器' })).toBeVisible();
}
async function menu(page: Page, name: string) {
  await page.getByRole('button', { name: '主菜单', exact: true }).click();
  await page
    .getByRole('navigation', { name: '菜单内容' })
    .getByRole('button', { name, exact: true })
    .click();
}
async function remove(page: Page, name: string) {
  await menu(page, '管理画布内容');
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认移除', exact: true }).click();
  await saved(page);
}

test('remove Agent, project and MCP views without deleting facts or independent branches', async ({
  page,
}) => {
  let initial = createWorkspace();
  const key = planKey('agent/main', 'r1');
  while (!deliveryBlock(initial, key)) initial = receiveNext(initial, key);
  initial = updateCanvas(initial, (canvas) => ({
    ...canvas,
    projectRoots: ['/tmp/public-delete-project'],
    connectionIds: ['mcp/view-test'],
    positions: { ...canvas.positions, 'mcp:mcp/view-test': { x: 40, y: 160 } },
  }));
  initial = duplicateCanvas(initial);
  const errors: string[] = [],
    writes: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('/api/runtime/') && request.method() !== 'GET')
      writes.push(request.url());
  });
  await seed(page, initial);
  await menu(page, '管理画布内容');
  await page.getByRole('button', { name: '移除 Agent：溯源', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('任务不会被打断');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-agent="agent/main"]')).toHaveCount(1);
  await page.getByRole('button', { name: '移除 Agent：溯源', exact: true }).click();
  await page.getByRole('button', { name: '确认移除', exact: true }).click();
  await expect(page.locator('[data-agent="agent/main"]')).toHaveCount(0);
  await expect(page.locator('[data-agent="agent/main/r1/review"]')).toHaveCount(1);
  await remove(page, '移除项目档案：/tmp/public-delete-project');
  await expect(page.locator('.archive-canvas')).toHaveCount(0);
  await expect(page.locator('.project-region')).toHaveCount(0);
  await remove(page, '移除 MCP：mcp/view-test');
  await expect(page.locator('[data-mcp]')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-agent="agent/main"]')).toHaveCount(0);
  await expect(page.locator('.archive-canvas')).toHaveCount(0);
  await expect(page.locator('[data-mcp]')).toHaveCount(0);
  await menu(page, '管理画布内容');
  await page.getByText('可放回的 Agent', { exact: false }).click();
  await page.getByRole('button', { name: '放回 Agent：溯源', exact: true }).click();
  await expect(page.locator('[data-agent="agent/main"]')).toHaveCount(1);
  await page.getByText('可放回的项目', { exact: false }).click();
  await page
    .getByRole('button', { name: '放回项目档案：/tmp/public-delete-project', exact: true })
    .click();
  await expect(page.locator('.archive-canvas')).toHaveCount(1);
  await saved(page);
  const after = await readWorkspace(page);
  expect(after.events).toEqual(initial.events);
  expect(after.replays).toEqual(initial.replays);
  expect(after.canvases[0]).toEqual(initial.canvases[0]);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('deleting a canvas protects the other canvas and keeps a valid empty final canvas', async ({
  page,
}) => {
  const initial = duplicateCanvas(createWorkspace());
  await seed(page, initial);
  const deleteCurrent = async () => {
    await menu(page, '画布');
    await page.getByRole('button', { name: '删除当前画布', exact: true }).click();
  };
  await deleteCurrent();
  await expect(page.getByRole('dialog')).toContainText('其他画布不受影响');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await saved(page);
  expect((await readWorkspace(page)).canvases).toHaveLength(2);
  await deleteCurrent();
  await page.getByRole('button', { name: '确认删除画布', exact: true }).click();
  await saved(page);
  expect((await readWorkspace(page)).canvases).toEqual([initial.canvases[0]]);
  await deleteCurrent();
  await expect(page.getByRole('dialog')).toContainText('新空白画布');
  await page.getByRole('button', { name: '确认删除画布', exact: true }).click();
  await expect(page.getByRole('button', { name: '切换画布' })).toHaveText('新画布');
  await saved(page);
  await page.reload();
  await expect(page.locator('.agent-root')).toHaveCount(0);
  await expect(page.locator('.archive-canvas')).toHaveCount(0);
  await saved(page);
  const after = await readWorkspace(page);
  expect(after.canvases).toHaveLength(1);
  expect(after.events).toEqual(initial.events);
  await menu(page, '管理画布内容');
  await expect(page.getByText('可放回的 Agent', { exact: false })).toBeVisible();
});

test('putting back an MCP icon keeps its position and recorded binding without configuring tools again', async ({
  page,
}) => {
  const connection: McpConnection = {
    id: '00000000-0000-4000-8000-000000000001',
    revision: 2,
    name: 'Docker 测试',
    kind: 'docker',
    url: 'http://127.0.0.1:65534/mcp',
    auth: { method: 'none' },
    hasSecret: false,
  };
  const initial = createWorkspace();
  const creation = initial.events[0];
  if (creation.data.type !== 'session.created') throw new Error('Missing fixture session');
  creation.data.connections = [{ id: connection.id, revision: connection.revision }];
  initial.canvases[0].connectionIds = [connection.id];
  initial.canvases[0].positions['mcp:' + connection.id] = { x: 170, y: 220 };
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/runtime/') && request.method() !== 'GET')
      writes.push(request.url());
  });
  await seed(page, initial, [connection]);
  await remove(page, '移除 MCP：Docker 测试');
  await expect(page.locator('[data-mcp]')).toHaveCount(0);
  await menu(page, '管理画布内容');
  await page.getByText('可放回的接入', { exact: false }).click();
  await page.getByRole('button', { name: '放回 MCP：Docker 测试', exact: true }).click();
  await expect(page.locator('[data-mcp]')).toHaveCount(1);
  await saved(page);
  const after = await readWorkspace(page);
  expect(after.events).toEqual(initial.events);
  expect(currentCanvas(after).positions['mcp:' + connection.id]).toEqual({ x: 170, y: 220 });
  expect(currentCanvas(after).connectionIds).toEqual([connection.id]);
  expect(writes).toEqual([]);
});

test('delete respects editors, removes dependent draft lines, supports undo and clears background selection', async ({
  page,
}) => {
  const initial = updateCanvas(createWorkspace(), (canvas) => {
    const draft = {
      id: 'a',
      kind: 'action' as const,
      x: 180,
      y: 260,
      w: 180,
      h: 80,
      title: '手工 A',
      points: [],
      from: null,
      to: null,
    };
    return {
      ...canvas,
      rootSessions: [],
      selectedSession: null,
      drafts: [
        draft,
        { ...draft, id: 'b', x: 420, y: 300, title: '手工 B' },
        { ...draft, id: 'line', kind: 'relation', from: 'a', to: 'b', title: '' },
      ],
    };
  });
  await seed(page, initial);
  await page.getByRole('button', { name: '草稿 手工 A', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '草稿内容' });
  await editor.fill('待修改');
  await editor.press('Backspace');
  await expect(editor).toHaveValue('待修');
  await expect(page.locator('.draft')).toHaveCount(2);
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.draft')).toHaveCount(1);
  await expect(page.locator('.draft-relation')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销手工图形', exact: true }).click();
  await expect(page.locator('.draft')).toHaveCount(2);
  await expect(page.locator('.draft-relation')).toHaveCount(1);
  await page.locator('.draft-relation path').click();
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.draft')).toHaveCount(2);
  await expect(page.locator('.draft-relation')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销手工图形', exact: true }).click();
  await page.getByRole('button', { name: '草稿 手工 B', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.keyboard.press('Delete');
  await expect(page.getByRole('button', { name: '草稿 手工 B', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '撤销手工图形', exact: true }).click();
  await page.getByRole('button', { name: '草稿 手工 B', exact: true }).click();
  await page.mouse.click(800, 650);
  await page.keyboard.press('Backspace');
  await expect(page.locator('.draft')).toHaveCount(2);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await saved(page);
  expect((await readWorkspace(page)).events).toEqual(initial.events);
  expect(currentCanvas(await readWorkspace(page)).selectedDrafts).toEqual([]);
});

test('eraser sends drawings and canvas nodes to the persistent recycle bin and restores them without backend writes', async ({
  page,
}) => {
  const initial = createWorkspace();
  initial.events = initial.events.slice(0, 2);
  initial.replays = {};
  initial.canvases[0].connectionIds = ['eraser-mcp'];
  initial.canvases[0].projectRoots = ['/tmp/recovery-project'];
  initial.canvases[0].positions['mcp:eraser-mcp'] = { x: 390, y: 160 };
  initial.canvases[0].positions['project-archive:/tmp/recovery-project'] = { x: 620, y: 250 };
  initial.canvases[0].drafts = [
    {
      id: 'erase-a',
      kind: 'action',
      title: '橡皮草稿',
      x: 300,
      y: 600,
      w: 180,
      h: 80,
      points: [],
      from: null,
      to: null,
    },
  ];
  const writes: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/runtime/') && request.method() !== 'GET')
      writes.push(request.url());
  });
  await seed(page, initial);
  await page.getByRole('button', { name: '橡皮工具 X', exact: true }).click();
  await page.getByRole('button', { name: '草稿 橡皮草稿', exact: true }).click();
  await expect(page.locator('.draft')).toHaveCount(0);
  for (const selector of [
    '[data-agent="agent/main"]',
    '[data-mcp="eraser-mcp"]',
    '[data-archive-root="/tmp/recovery-project"]',
  ]) {
    await page.locator(selector).click();
    await page.getByRole('button', { name: '确认移除', exact: true }).click();
  }
  await saved(page);
  await page.reload();
  await menu(page, '回收站');
  for (const label of ['橡皮草稿', '溯源', 'MCP 接入', '/tmp/recovery-project'])
    await page.getByRole('button', { name: `恢复：${label}`, exact: true }).click();
  await saved(page);
  const restored = await readWorkspace(page);
  expect(restored.trash).toEqual([]);
  expect(restored.events).toEqual(initial.events);
  expect(currentCanvas(restored).drafts).toEqual(currentCanvas(initial).drafts);
  expect(currentCanvas(restored).projectRoots).toEqual(['/tmp/recovery-project']);
  expect(currentCanvas(restored).connectionIds).toEqual(['eraser-mcp']);
  await menu(page, '画布');
  await page.getByRole('button', { name: '删除当前画布', exact: true }).click();
  await page.getByRole('button', { name: '确认删除画布', exact: true }).click();
  await menu(page, '回收站');
  await page.getByRole('button', { name: '恢复：恢复路径', exact: true }).click();
  await expect(page.getByRole('button', { name: '切换画布' })).toHaveText('恢复路径');
  await saved(page);
  expect((await readWorkspace(page)).events).toEqual(initial.events);
  expect(writes).toEqual([]);
});

test('empty MCP responses show a recovery action and a manual reread clears the failure', async ({
  page,
}) => {
  await seed(page, createWorkspace());
  let available = false;
  await page.route('**/api/runtime/mcp-connections', (route) =>
    route.fulfill(
      available
        ? {
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ connections: [] }),
          }
        : { status: 503, body: '' },
    ),
  );
  await page.reload();
  await menu(page, '管理画布内容');
  await expect(page.getByRole('alert')).toContainText('请检查服务是否已启动');
  await expect(page.getByRole('alert')).not.toContainText('SyntaxError');
  available = true;
  await page.getByRole('button', { name: '重新读取接入配置', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
