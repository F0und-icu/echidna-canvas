import { expect, test } from '@playwright/test';
import { graphWorkspace } from '../fixtures/canvas-graph';

test('canvas annotations use distinct shapes, real links and expandable detail', async ({
  page,
}) => {
  await page.setViewportSize({ width: 2400, height: 900 });
  await page.addInitScript(
    (workspace: string) => localStorage.setItem('echidna-canvas.offline.v1', workspace),
    JSON.stringify(graphWorkspace()),
  );
  await page.goto('/');
  await expect(page.locator('[data-canvas-node="decision"]')).toHaveCount(1);
  await expect(page.locator('[data-canvas-node="material"]')).toHaveCount(1);
  await expect(page.locator('[data-canvas-node="tool"]')).toHaveCount(1);
  await expect(page.locator('.runtime-options .selected')).toHaveText('SSE');
  await expect(page.locator('.lane-material[data-canvas-node="material"]')).toHaveCount(1);
  await expect(page.locator('.lane-action[data-canvas-node="tool"]')).toHaveCount(1);
  await expect(page.locator('.lane-judgment[data-canvas-node="decision"]')).toHaveCount(1);
  await expect(page.locator('.reply-card-excerpt')).toContainText('在此虚构样本中');
  await expect(page.locator('.runtime-origin')).toHaveText('固定示例');
  await expect(page.locator('.runtime-wires .reference')).toHaveCount(0);
  await expect(page.locator('.node-outline')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '查看依据：连续推送任务进展', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.runtime-wires [data-edge="local-reference"]')).toHaveCount(3);
  await page.getByRole('button', { name: '选择：选择 SSE 通道', exact: true }).hover();
  await expect(page.locator('.runtime-wires .reference')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/p3b-task-graph.png' });
  await page.getByRole('button', { name: '选择：选择 SSE 通道', exact: true }).click();
  await expect(page.locator('.inspector')).toContainText('明确的单向推送需求');
  await expect(page.locator('.inspector')).toContainText('Agent 标注');
  await expect(page.locator('.inspector .tool-record')).toHaveCount(0);
  await page.getByRole('button', { name: '查看整轮记录', exact: true }).click();
  await expect(page.locator('.inspector')).toContainText('fixture:receipt');
  await page.getByRole('button', { name: '工具：读取样本说明', exact: true }).click();
  await expect(page.locator('.inspector .command-content')).toHaveAttribute('open');
  await expect(page.locator('.inspector')).toContainText('Synthetic sample contents');
  await page
    .locator('.inspector')
    .getByRole('button', { name: '样本运行说明', exact: true })
    .click();
  await expect(page.locator('.inspector')).toContainText('此材料来自离线 Fixture');
  await page.getByRole('button', { name: '查看依据：连续推送任务进展', exact: true }).click();
  await expect(page.locator('.inspector')).toContainText('只需要服务到浏览器的进度流。');
});

test('an unannotated fixture round shows its reply rather than an empty judgment area', async ({
  page,
}) => {
  const workspace = graphWorkspace();
  workspace.events = workspace.events
    .filter((e) => e.data.type !== 'canvas.noted')
    .map((e, index) => ({ ...e, seq: index + 1 }));
  await page.addInitScript(
    (saved: string) => localStorage.setItem('echidna-canvas.offline.v1', saved),
    JSON.stringify(workspace),
  );
  await page.goto('/');
  await expect(page.locator('.reply-card-excerpt')).toContainText('在此虚构样本中');
  await expect(page.locator('[data-canvas-node="decision"]')).toHaveCount(0);
  await expect(page.locator('[data-canvas-node="tool"]')).toHaveCount(1);
  await expect(page.locator('.runtime-chapter-label')).toHaveCount(2);
  await page.getByRole('button', { name: '回复：对话记录', exact: true }).click();
  await expect(page.locator('.inspector')).toContainText('HTTP 命令配合 SSE');
});
