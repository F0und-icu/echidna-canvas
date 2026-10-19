import { expect, test, type Page } from '@playwright/test';
import { readWorkspace } from './storage';

async function connect(page: Page) {
  await page.getByRole('button', { name: '主菜单', exact: true }).click();
  await page.getByRole('button', { name: 'Agent 连接', exact: true }).click();
  await page.getByRole('button', { name: '连接本地服务', exact: true }).click();
  await expect(page.getByText('已连接 · 记录由本地服务保存')).toBeVisible();
}
async function create(page: Page) {
  await connect(page);
  await page
    .getByRole('complementary', { name: 'Agent 连接', exact: true })
    .getByRole('button', { name: '创建 Agent', exact: true })
    .click();
  await page.getByText('形象与描述', { exact: false }).click();
  await page
    .getByRole('textbox', { name: '名称', exact: true })
    .fill(`Codex-${test.info().testId.slice(-5)}`);
  await page.getByRole('textbox', { name: '任务', exact: true }).fill('核对项目文件并说明结果。');
  await page.getByRole('button', { name: '创建 Agent', exact: true }).click();
  await page
    .getByRole('textbox', { name: '对话消息', exact: true })
    .fill('核对项目文件并说明结果。');
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('Agent brush auto-connects and binds the selected harness without executing the task', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Agent工具 A', exact: true }).click();
  await page.mouse.click(180, 310);
  const form = page.getByRole('complementary', { name: '创建 Agent', exact: true });
  await expect(form.getByRole('status')).toContainText('协议演示 已连接');
  await form.getByRole('button', { name: '选择 协议演示 Harness', exact: true }).click();
  await expect(form.getByRole('combobox', { name: '模型', exact: true })).toContainText('协议示例');
  const before = await (await page.request.get('/api/runtime')).json();
  await form.getByRole('button', { name: '创建 Agent', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '对话消息', exact: true })).toBeVisible();
  const after = await (await page.request.get('/api/runtime')).json();
  expect(after.events.at(-2).data.config.name).toContain('协议演示');
  expect(after.events.at(-1).data.task).toBe('自由交流');
  const added = after.commands.filter(
    (command: { commandId: string }) =>
      !before.commands.some(
        (prior: { commandId: string }) => prior.commandId === command.commandId,
      ),
  );
  expect(added.map((command: { type: string }) => command.type)).toEqual(['agent.create']);
  expect(after.agents.find((agent: { id: string }) => agent.id === added[0].agentId)).toMatchObject(
    {
      state: 'idle',
      turnId: null,
    },
  );
});

test('a failed auto-connection retains the form and requires an explicit offline choice', async ({
  page,
}) => {
  await page.route('**/api/runtime/session', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: '验收：本地服务不可用' }),
    }),
  );
  await page.getByRole('button', { name: 'Agent工具 A', exact: true }).click();
  await page.mouse.click(180, 310);
  const form = page.getByRole('complementary', { name: '创建 Agent', exact: true });
  await form.getByText('形象与描述', { exact: false }).click();
  await form.getByRole('textbox', { name: '名称', exact: true }).fill('保留的创建请求');
  await form.getByRole('textbox', { name: '任务', exact: true }).fill('连接恢复后创建。');
  await expect(form.getByRole('alert')).toContainText('本地服务不可用');
  await expect(form.getByRole('button', { name: '创建 Agent', exact: true })).toBeDisabled();
  await expect(form.getByRole('button', { name: '自动选择 Harness', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.unroute('**/api/runtime/session');
  await form.getByRole('button', { name: '重新连接', exact: true }).click();
  await expect(form.getByRole('status')).toContainText('协议演示 已连接');
  await expect(form.getByRole('textbox', { name: '名称', exact: true })).toHaveValue(
    '保留的创建请求',
  );
  await expect(form.getByRole('button', { name: '创建 Agent', exact: true })).toBeEnabled();
});

test('Codex fixture events grow the canvas, remain source-linked, and survive refresh', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await create(page);
  await page
    .getByRole('textbox', { name: '对话消息', exact: true })
    .fill('这是我的自定义消息\n请保持原文和换行。');
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.locator('.replay-name').click();
  await expect(page.getByRole('textbox', { name: '对话消息', exact: true })).toHaveValue(
    '这是我的自定义消息\n请保持原文和换行。',
  );
  await page.reload();
  await page.locator('.replay-name').click();
  await expect(page.getByRole('textbox', { name: '对话消息', exact: true })).toHaveValue(
    '这是我的自定义消息\n请保持原文和换行。',
  );
  await expect(page.locator('.runtime-chat-header')).toContainText('离线演示 · 固定示例回复');
  await page.getByRole('button', { name: '连接本地服务，补齐记录', exact: true }).click();
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
  await page.getByRole('textbox', { name: '对话消息', exact: true }).press('Enter');
  await expect(page.getByRole('log', { name: '对话记录' })).toContainText('这是我的自定义消息');
  await expect(page.getByRole('log', { name: '对话记录' })).toContainText(
    '协议演示：已列出两个文件',
  );
  await expect(page.getByRole('textbox', { name: '对话消息', exact: true })).toHaveValue('');
  await expect(page.locator('.runtime-round')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/p2-codex-bridge.png' });
  await page.getByRole('button', { name: '查看最近回合' }).click();
  await expect(page.locator('.inspector')).toContainText('回合已结束');
  await expect(page.locator('.inspector')).toContainText('协议演示：已列出两个文件');
  await page.getByText('参数与原始回传', { exact: true }).click();
  await expect(page.locator('.inspector')).toContainText('item-completed');
  await page.getByText('不可变输入快照', { exact: true }).click();
  await expect(page.locator('.inspector')).toContainText('codex-p2-v1');
  await expect(page.getByRole('status').filter({ hasText: '已保存在此浏览器' })).toBeVisible();
  const count = (await readWorkspace(page)).events.filter((e) => e.runtime).length;
  await page.reload();
  await connect(page);
  const after = (await readWorkspace(page)).events.filter((e) => e.runtime).length;
  expect(after).toBeGreaterThanOrEqual(count);
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
  await page.getByRole('button', { name: '切换画布' }).click();
  await page.getByRole('button', { name: '复制当前画布', exact: true }).click();
  expect(await page.locator('.runtime-round').count()).toBe(1);
  expect(errors).toEqual([]);
});
test('a lost runtime result stays unknown and disables new dispatches', async ({ page }) => {
  await create(page);
  await page.getByText('任务与运行设置', { exact: true }).click();
  await page.getByRole('combobox', { name: '协议场景' }).selectOption('disconnect');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.locator('.inspector')).toContainText('状态待核对；不能重新派发已有命令');
  await expect(page.locator('.runtime-connection-fault')).toContainText('运行时连接中断');
  await expect(page.locator('.runtime-round .round-header')).toContainText('结果待核对');
  await expect(page.locator('.runtime-round .round-warning')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '发送' })).toBeDisabled();
  await page.getByRole('button', { name: '查看最近回合' }).click();
  await expect(page.locator('.inspector')).toContainText('状态待核对');
  await expect(page.locator('.inspector')).not.toContainText('回合已结束');
});

test('branches from a selected reply without displaying or inheriting later messages', async ({
  page,
}) => {
  await create(page);
  const input = page.getByRole('textbox', { name: '对话消息', exact: true });
  await input.fill('早期上下文 · 分支保留');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '从此回复后分支', exact: true }).first(),
  ).toBeEnabled();
  await input.fill('后续上下文 · 分支排除');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '从此回复后分支', exact: true }).last(),
  ).toBeEnabled();
  await page.getByRole('button', { name: '从此回复后分支', exact: true }).first().click();
  const log = page.getByRole('log', { name: '对话记录' });
  await expect(log).toContainText('继承的对话上下文');
  await expect(log).toContainText('早期上下文 · 分支保留');
  await expect(log).not.toContainText('后续上下文 · 分支排除');
  await expect(page.locator('[data-edge="context-branch"]')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: '对话消息', exact: true })).toBeEmpty();
  await page.getByRole('button', { name: '从此消息发送前分支', exact: true }).first().click();
  await expect(page.getByRole('log', { name: '对话记录' })).not.toContainText(
    '早期上下文 · 分支保留',
  );
  await expect(page.getByRole('textbox', { name: '对话消息', exact: true })).toHaveValue(
    '早期上下文 · 分支保留',
  );
});
