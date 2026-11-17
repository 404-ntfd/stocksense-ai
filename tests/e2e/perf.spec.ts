import { expect, test } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

// Section 12.3 budgets, measured on the production build with the CPU slowed down 4x (a mid-range phone).
test('performance budgets with CPU throttle x4', async ({ page }) => {
  test.setTimeout(120_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const t0 = Date.now();
  await page.goto('/');
  await page.getByTestId('onboarding').waitFor();
  const coldStart = Date.now() - t0;
  await page.getByTestId('onb-next').click();
  const t1 = Date.now();
  await page.getByTestId('onb-demo').click();
  await page.getByTestId('onb-finish').waitFor({ timeout: 30_000 });
  const demoLoad = Date.now() - t1;
  await page.getByTestId('onb-finish').click();
  const t2 = Date.now();
  await page.getByTestId('chart-category').locator('canvas').waitFor();
  const dashboard = Date.now() - t2;
  await page.goto('/#/ask');
  const t3 = Date.now();
  await page.getByTestId('ask-input').fill('top 5 products last month');
  await page.getByTestId('ask-send').click();
  await page.getByTestId('answer').waitFor();
  const offlineAnswer = Date.now() - t3;
  const t4 = Date.now();
  await page.goto('/#/inventory');
  await page.getByTestId('product-row').first().waitFor();
  const inventory = Date.now() - t4;
  const result = { cpuThrottle: 4, coldStartMs: coldStart, demoLoadMs: demoLoad, dashboardMs: dashboard, offlineAnswerMs: offlineAnswer, inventoryMs: inventory };
  console.log(JSON.stringify(result));
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/perf.json', JSON.stringify(result, null, 2));
  expect(coldStart).toBeLessThan(3000);
  expect(dashboard).toBeLessThan(3000);
  expect(offlineAnswer).toBeLessThan(5000);
});
