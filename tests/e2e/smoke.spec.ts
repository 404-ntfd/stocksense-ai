import { expect, test } from '@playwright/test';
import { ask, onboardWithDemo } from './helpers';

test('onboarding -> demo data -> dashboard with 6 KPIs and 4 charts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await onboardWithDemo(page);
  for (const k of ['kpi-revenue', 'kpi-profit', 'kpi-net', 'kpi-inventory', 'kpi-lowstock', 'kpi-dead']) await expect(page.getByTestId(k)).toBeVisible();
  for (const c of ['chart-trend', 'chart-monthly', 'chart-top', 'chart-category']) await expect(page.getByTestId(c).locator('canvas')).toHaveCount(1);
  await expect(page.getByTestId('kpi-lowstock-value')).toHaveText('11');
  await page.getByTestId('period-fy').click();
  await expect(page.getByText(/FY2026-27/).first()).toBeVisible();
  await page.getByTestId('chart-trend-viewdata').click();
  await expect(page.getByTestId('chart-trend').locator('table')).toBeVisible();
  expect(errors).toEqual([]);
});

test('all five tabs navigate, and data survives a reload', async ({ page }) => {
  await onboardWithDemo(page);
  for (const [tab, id] of [['inventory', 'page-inventory'], ['data', 'page-data'], ['more', 'page-settings'], ['home', 'dashboard']] as const) {
    await page.getByTestId(`tab-${tab}`).click();
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await page.getByTestId('tab-ask').click();
  await expect(page.getByTestId('page-ask')).toBeVisible();
  await page.waitForTimeout(1500); // the worker saves 0.4 s after the last change
  await page.goto('/');
  await page.reload();
  await expect(page.getByTestId('kpi-revenue-value')).not.toHaveText('₹0', { timeout: 20_000 });
});

test('ask by typing: offline answer with chart, table and SQL', async ({ page }) => {
  await onboardWithDemo(page);
  await page.goto('/#/ask');
  await ask(page, 'What were my total sales last month?');
  await expect(page.getByTestId('answer-text')).toContainText('₹3,83,449');
  await expect(page.getByTestId('answer-kpi')).toBeVisible();
  await page.getByTestId('toggle-sql').click();
  await expect(page.getByTestId('answer-sql')).toContainText('v_sales');
  await ask(page, 'top 5 products last month');
  await expect(page.getByTestId('answer-chart').last()).toBeVisible();
  await page.getByTestId('answer-tabs').last().getByRole('tab', { name: 'Table' }).click();
  await expect(page.getByTestId('answer-table').last()).toBeVisible();
  await ask(page, 'When will Sugar 1kg run out?');
  await expect(page.getByTestId('answer-text').last()).toContainText('estimate based on your past sales');
});
