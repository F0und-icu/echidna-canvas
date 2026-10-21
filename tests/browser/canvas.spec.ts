import { expect, test, type Page } from '@playwright/test';
import { readWorkspace } from './storage';

async function menu(page: Page, name: string) {
  await page.getByRole('button', { name: '主菜单', exact: true }).click();
  await page
    .getByRole('navigation', { name: '菜单内容' })
    .getByRole('button', { name, exact: true })
    .click();
}
async function close(page: Page) {
  await page.getByRole('button', { name: '关闭详情', exact: true }).click();
}
async function finish(page: Page) {
  for (let i = 0; i < 100; i++) {
    const button = page.getByRole('button', { name: '接收下一条演示事件', exact: true });
    if (await button.isDisabled()) return;
    await button.click();
  }
  throw new Error('Fixture did not reach a stop');
}
async function saved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: '已保存在此浏览器' })).toBeVisible();
}
async function eventCount(page: Page) {
  await saved(page);
  return (await readWorkspace(page)).events.length;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('historical prefix stays frozen while background results and child records arrive', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('combobox', { name: '查看模型采样轮次' }).selectOption('11');
  const snapshot = await page.locator('.round-record').allTextContents(),
    viewport = await page.locator('.canvas-world').getAttribute('style');
  await finish(page);
  expect(await page.locator('.round-record').allTextContents()).toEqual(snapshot);
  expect(await page.locator('.canvas-world').getAttribute('style')).toBe(viewport);
  await expect(page.locator('.agent-root')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '返回实时视图' })).toContainText('条新记录');
  await page.getByRole('button', { name: '返回实时视图' }).click();
  await expect(page.locator('.agent-root')).toHaveCount(2);
  await menu(page, '交接记录');
  await page.getByRole('button', { name: '溯源 → 审阅 · 已采纳有限范围', exact: true }).click();
  await expect(page.locator('.inspector')).toContainText('不认定真实环境已修复');
  await page.getByRole('button', { name: '查看子 Agent 记录' }).click();
  await expect(page.locator('.inspector')).toContainText('本轮没有返回可见摘要');
  await page.getByRole('button', { name: '返回父任务' }).click();
  await expect(page.locator('.replay-name')).toHaveText('溯源');
  expect(errors).toEqual([]);
});

test('a dialogue forks at the chosen event and retains the earlier path', async ({ page }) => {
  await page.getByRole('combobox', { name: '查看模型采样轮次' }).selectOption('11');
  const position = await page.locator('.round-record').first().getAttribute('style');
  await page.locator('.round-record.current .round-thought').click();
  await page.getByRole('button', { name: '补充信息，开启新路线' }).click();
  await page
    .getByRole('textbox', { name: '对话消息', exact: true })
    .fill('先核对真实环境，不修改文件');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('button', { name: '接收下一条演示事件', exact: true }).click();
  await expect(page.locator('.inspector')).toHaveCount(0);
  await page.locator('.round-record.current .round-thought').click();
  await page.getByRole('button', { name: '补充信息，开启新路线' }).click();
  await expect(page.getByRole('button', { name: '采用建议，开启新路线' })).toBeVisible();
  await page.getByRole('button', { name: '采用建议，开启新路线' }).click();
  await expect(page.locator('.round-record[data-round$="/r2/s1"]')).toHaveCount(1);
  expect(await page.locator('.round-record[data-round$="/r1/s1"]').getAttribute('style')).toBe(
    position,
  );
  await saved(page);
  const event = (await readWorkspace(page)).events.find(
    (e) => e.routeId === 'r2' && e.data.type === 'route.started',
  )!;
  if (event.data.type !== 'route.started') throw new Error('Missing route fixture');
  const origin = event.data.origin!;
  expect(origin.eventSeq).toBe(11);
  await page.reload();
  await expect(page.locator('.round-record[data-round$="/r2/s1"]')).toHaveCount(1);
});

test('three scene entries, canvas copying and the real project archive open', async ({ page }) => {
  for (const name of ['工具反馈改变判断', '用户中途纠正方向', '委派、复核与采纳']) {
    await menu(page, '示例场景');
    await page
      .getByRole('navigation', { name: '菜单内容' })
      .getByRole('button', { name, exact: true })
      .click();
    await expect(page.getByRole('button', { name: '切换画布' })).toContainText(name);
  }
  await finish(page);
  const count = await eventCount(page);
  await menu(page, '画布');
  await page
    .getByRole('navigation', { name: '菜单内容' })
    .getByRole('button', { name: '复制当前画布', exact: true })
    .click();
  expect(await eventCount(page)).toBe(count);
  await expect(page.locator('.agent-root')).toHaveCount(2);
  await menu(page, '项目档案');
  await expect(page.getByRole('dialog', { name: '项目档案' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '项目文件' })).toBeVisible();
  await expect(page.getByRole('button', { name: '刷新文件树' })).toBeEnabled();
  await page.getByRole('button', { name: '关闭项目档案' }).click();
});

test('create, draw, undo and persist view without executing the new Agent', async ({ page }) => {
  await menu(page, '画布');
  await page
    .getByRole('navigation', { name: '菜单内容' })
    .getByRole('button', { name: '新建画布', exact: true })
    .click();
  await page.getByRole('button', { name: 'Agent工具 A', exact: true }).click();
  await page.mouse.click(180, 310);
  await page.getByRole('button', { name: '离线画布示例', exact: true }).click();
  await page.getByText('形象与描述', { exact: false }).click();
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('测试角色');
  await page.getByRole('textbox', { name: '任务', exact: true }).fill('离线验证');
  await page
    .getByRole('complementary', { name: '创建 Agent', exact: true })
    .getByRole('button', { name: '创建 Agent', exact: true })
    .click();
  await expect(page.getByRole('button', { name: '与测试角色对话' })).toBeVisible();
  const facts = await eventCount(page);
  const actorBefore = await page.getByRole('button', { name: '与测试角色对话' }).boundingBox();
  await page.mouse.move(actorBefore!.x + 60, actorBefore!.y + 60);
  await page.mouse.down();
  await page.mouse.move(actorBefore!.x + 100, actorBefore!.y + 100, { steps: 6 });
  await page.mouse.up();
  const actorAfter = await page.getByRole('button', { name: '与测试角色对话' }).boundingBox();
  expect(actorAfter!.x - actorBefore!.x).toBeCloseTo(40, 0);
  const viewBefore = await page.locator('.canvas-world').getAttribute('style');
  await page.getByRole('button', { name: '漫游工具 H', exact: true }).click();
  await page.mouse.move(600, 550);
  await page.mouse.down();
  await page.mouse.move(640, 580, { steps: 6 });
  await page.mouse.up();
  expect(await page.locator('.canvas-world').getAttribute('style')).not.toBe(viewBefore);
  await page.getByRole('button', { name: '行动工具 R', exact: true }).click();
  await page.mouse.click(430, 320);
  await page.getByRole('textbox', { name: '草稿内容' }).fill('手工计划');
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await close(page);
  await expect(page.getByRole('button', { name: '草稿 手工计划' })).toBeVisible();
  await page.getByRole('button', { name: '撤销手工图形', exact: true }).click();
  await page.getByRole('button', { name: '撤销手工图形', exact: true }).click();
  await expect(page.locator('.draft')).toHaveCount(0);
  expect(await eventCount(page)).toBe(facts);
  await page.getByRole('button', { name: '重做手工图形', exact: true }).click();
  await expect(page.locator('.draft')).toHaveCount(1);
  await menu(page, '主题与外观');
  await page.getByRole('button', { name: '鼠尾草纸', exact: true }).click();
  await page.getByRole('combobox', { name: '画布底纹', exact: true }).selectOption('dots');
  await close(page);
  await saved(page);
  await page.reload();
  await expect(page.locator('.agent-name')).toContainText('测试角色');
  await expect(page.locator('.draft')).toHaveCount(1);
  await expect(page.locator('.canvas-board')).toHaveClass(/paper-dots/);
  expect(await eventCount(page)).toBe(facts);
});

test('pause, cancellation and reconnection retain real fixture results', async ({ page }) => {
  await menu(page, '运行与恢复');
  await page.getByRole('button', { name: '请求取消：检查格式', exact: true }).click();
  await expect(page.locator('.round-record.current')).toContainText('取消待确认');
  await page.getByRole('button', { name: '演示连接中断', exact: true }).click();
  await expect(page.getByRole('button', { name: '接收下一条演示事件' })).toBeDisabled();
  await page.getByRole('button', { name: '恢复事件连接', exact: true }).click();
  await page.getByRole('button', { name: '暂停后续采样', exact: true }).click();
  await close(page);
  await page.getByRole('button', { name: '接收下一条演示事件' }).click();
  await page.getByRole('button', { name: '接收下一条演示事件' }).click();
  await expect(page.getByRole('button', { name: '接收下一条演示事件' })).toBeDisabled();
  await expect(page.locator('.round-record')).toHaveCount(2);
  await page.locator('.round-record.current .round-thought').click();
  await expect(page.locator('.inspector')).toContainText('取消请求之后收到了真实回传');
});

test('box selection, group dragging, draft links, eraser and ink preserve event records', async ({
  page,
}) => {
  await menu(page, '画布');
  await page
    .getByRole('navigation', { name: '菜单内容' })
    .getByRole('button', { name: '新建画布', exact: true })
    .click();
  const facts = await eventCount(page);
  for (const [name, x, y] of [
    ['行动工具 R', 220, 260],
    ['判断工具 D', 440, 260],
  ] as const) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.mouse.click(x, y);
    await close(page);
  }
  await page.mouse.move(190, 230);
  await page.mouse.down();
  await page.mouse.move(680, 400, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator('.draft.selected')).toHaveCount(2);
  const before = await page.locator('.draft').first().boundingBox();
  await page.mouse.move(280, 290);
  await page.mouse.down();
  await page.mouse.move(310, 310, { steps: 6 });
  await page.mouse.up();
  const after = await page.locator('.draft').first().boundingBox();
  expect(after!.x - before!.x).toBeCloseTo(30, 0);
  expect(after!.y - before!.y).toBeCloseTo(20, 0);
  await page.getByRole('button', { name: '连线工具 L', exact: true }).click();
  await page.locator('.draft').nth(0).click();
  await page.locator('.draft').nth(1).click();
  await expect(page.locator('.draft-relation')).toHaveCount(1);
  await page.getByRole('button', { name: '橡皮工具 X', exact: true }).click();
  await page.locator('.draft-relation path').click();
  await expect(page.locator('.draft-relation')).toHaveCount(0);
  for (const [name, x, y] of [
    ['材料工具 E', 200, 450],
    ['区域工具 F', 440, 450],
    ['批注工具 T', 220, 600],
  ] as const) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.mouse.click(x, y);
    await close(page);
  }
  await page.getByRole('button', { name: '自由画笔工具 P', exact: true }).click();
  await page.mouse.move(640, 650);
  await page.mouse.down();
  await page.mouse.move(730, 700, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('svg.ink-wire[data-draft]')).toHaveCount(1);
  await page.getByRole('button', { name: '撤销手工图形', exact: true }).click();
  await expect(page.locator('svg.ink-wire[data-draft]')).toHaveCount(0);
  expect(await eventCount(page)).toBe(facts);
});

test('temporary Agent connections record a request without inventing acceptance', async ({
  page,
}) => {
  await finish(page);
  await page.getByRole('button', { name: '显示全部', exact: true }).click();
  await page.getByRole('button', { name: '连线工具 L', exact: true }).click();
  await page.getByRole('button', { name: '与溯源对话', exact: true }).click();
  await page.getByRole('button', { name: '与审阅对话', exact: true }).click();
  await page.getByRole('textbox', { name: '希望对方协助的问题' }).fill('仅核对选定材料');
  await page.getByRole('button', { name: '创建协作请求', exact: true }).click();
  await expect(page.locator('.inspector')).toContainText('请求已记录');
  await expect(page.locator('.inspector')).toContainText('尚无接收或执行回传');
});

test('invalid persisted data stays intact until an explicit recovery action', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('echidna-canvas.offline.v1', '{broken'));
  await page.reload();
  await expect(page.getByRole('heading', { name: '浏览器记录暂时无法打开' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('echidna-canvas.offline.v1'))).toBe(
    '{broken',
  );
  await page.getByRole('button', { name: '重置本地演示' }).click();
  await expect(page.locator('.round-record')).toHaveCount(2);
});

test('an old route can still receive an already dispatched result after steering', async ({
  page,
}) => {
  await page.locator('.round-record.current .round-thought').click();
  await page.getByRole('button', { name: '补充信息，开启新路线' }).click();
  await page.getByRole('textbox', { name: '对话消息', exact: true }).fill('先核对环境');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('button', { name: '采用建议，开启新路线' }).click();
  await menu(page, '运行与恢复');
  await page.getByRole('button', { name: '继续接收旧路线 R1', exact: true }).click();
  await close(page);
  await saved(page);
  const records = (await readWorkspace(page)).events;
  expect(
    records.filter(
      (e) => e.routeId === 'r1' && e.data.type === 'tool.finished' && e.data.callId === 'c3',
    ),
  ).toHaveLength(1);
  expect(
    records.filter(
      (e) => e.routeId === 'r1' && e.data.type === 'tool.started' && e.data.callId === 'c3',
    ),
  ).toHaveLength(1);
});

for (const width of [320, 736, 1024])
  test(`layout, theme and reduced motion at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(overflow).toBe(false);
    await page.getByRole('combobox', { name: '查看模型采样轮次' }).selectOption('11');
    const bars = await page
      .locator('.floating-bar')
      .evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().toJSON()));
    for (let i = 0; i < bars.length; i++)
      for (let j = i + 1; j < bars.length; j++) {
        const a = bars[i],
          b = bars[j];
        expect(
          a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
        ).toBe(true);
      }
    await menu(page, '主题与外观');
    const inspector = page.locator('.inspector');
    await expect(inspector).toBeVisible();
    expect(await inspector.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByRole('button', { name: '夜间胡桃', exact: true }).click();
    await close(page);
    expect(
      await page
        .locator('.character-figure')
        .first()
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe('none');
    await page.screenshot({ path: `test-results/canvas-${width}.png`, fullPage: true });
  });
