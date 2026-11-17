import { expect, test } from '@playwright/test';
import { ask, onboardWithDemo } from './helpers';

test('no key: open questions show the offline message with suggestions', async ({ page }) => {
  await onboardWithDemo(page);
  await page.goto('/#/ask');
  await expect(page.getByTestId('banner-no-key')).toBeVisible();
  await ask(page, 'which supplier gives the best rates on cooking oil');
  await expect(page.getByTestId('ask-error')).toContainText('Groq key');
});

test('offline mode (network blocked): dashboard, inventory and common questions still work', async ({ page, context }) => {
  await onboardWithDemo(page);
  await page.goto('/#/ask');
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByTestId('banner-offline')).toBeVisible();
  await ask(page, 'low stock items');
  await expect(page.getByTestId('answer-text')).toContainText('reorder level');
  await page.getByTestId('tab-inventory').click();
  await expect(page.getByTestId('product-row').first()).toBeVisible();
  await context.setOffline(false);
});

test('voice: mocked speech engine, tap-to-talk sends the transcript', async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __SS_MOCK_SPEECH__: boolean }).__SS_MOCK_SPEECH__ = true; });
  await onboardWithDemo(page);
  await page.goto('/#/ask');
  await page.getByTestId('mic').click();
  await expect(page.getByTestId('live-transcript')).toBeVisible();
  await page.evaluate(() => { (window as unknown as { __SS_MOCK_SPEECH__: { say: (t: string) => void } }).__SS_MOCK_SPEECH__.say('total sales this month'); });
  await expect(page.getByTestId('user-msg')).toHaveText('total sales this month', { timeout: 10_000 });
  await expect(page.getByTestId('answer-text')).toContainText('Total sales');
});

test('voice: continuous dictation keeps every segment across pauses until Send', async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as { __SS_MOCK_SPEECH__: boolean }).__SS_MOCK_SPEECH__ = true; });
  await onboardWithDemo(page);
  await page.goto('/#/ask');
  await page.getByTestId('continuous-toggle').click();
  await page.getByTestId('mic').click();
  for (const seg of ['compare sales', 'this month', 'vs last month']) {
    await page.evaluate((s) => { (window as unknown as { __SS_MOCK_SPEECH__: { say: (t: string) => void } }).__SS_MOCK_SPEECH__.say(s); }, seg);
    await page.waitForTimeout(600);
  }
  await expect(page.getByTestId('live-transcript')).toContainText('compare sales this month vs last month');
  await expect(page.getByTestId('user-msg')).toHaveCount(0);
  await page.getByTestId('dictation-send').click();
  await expect(page.getByTestId('user-msg')).toHaveText('compare sales this month vs last month');
  await expect(page.getByTestId('answer-text')).toContainText('this month');
});

test('voice write request becomes a confirmation card; nothing changes until Confirm', async ({ page }) => {
  await onboardWithDemo(page);
  await page.goto('/#/inventory');
  await page.getByTestId('inventory-search').fill('Tata Salt 1kg');
  const stockText = async () => (await page.getByTestId('product-row').first().textContent()) ?? '';
  const before = await stockText();
  await page.goto('/#/ask');
  await ask(page, 'received 24 Tata Salt 1kg at 21');
  await expect(page.getByTestId('action-summary')).toContainText('Add 24 of Tata Salt 1kg');
  await page.goto('/#/inventory');
  await page.getByTestId('inventory-search').fill('Tata Salt 1kg');
  await expect(page.getByTestId('product-row').first()).toHaveText(before);
  await page.goto('/#/ask');
  await page.getByTestId('action-confirm').click();
  await expect(page.getByTestId('action-status')).toContainText('Stock added');
});

test('import an XLSX sales file, see the report, then undo', async ({ page }) => {
  await onboardWithDemo(page);
  await page.goto('/#/data/import');
  await page.getByTestId('import-file').setInputFiles('samples/demo_sales.xlsx');
  await expect(page.getByTestId('target-sales')).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });
  await page.getByTestId('import-next').click();
  await page.getByTestId('import-run').click();
  await expect(page.getByTestId('report-ok')).toHaveText('1,500', { timeout: 30_000 });
  await page.getByTestId('import-undo').click();
  await expect(page.getByText('Import undone').first()).toBeVisible();
});

test('a custom CSV becomes a table that can be asked about', async ({ page }) => {
  await onboardWithDemo(page);
  await page.goto('/#/data/import');
  await page.getByTestId('import-file').setInputFiles('tests/fixtures/custom_price_list.csv');
  await page.getByTestId('target-custom').click();
  await page.getByTestId('import-next').click();
  await page.getByTestId('import-run').click();
  await expect(page.getByTestId('report-ok')).toHaveText('6', { timeout: 20_000 });
  await page.goto('/#/data');
  await expect(page.getByTestId('table-u_custom_price_list')).toBeVisible();
});

test('product CRUD: add, adjust stock, search, persists after reload', async ({ page }) => {
  await onboardWithDemo(page);
  await page.goto('/#/inventory');
  await page.getByTestId('fab-add-product').click();
  await page.getByTestId('product-name').fill('Test Ghee 1L');
  await page.getByTestId('product-category').fill('Oils & Ghee');
  await page.getByTestId('product-cost').fill('500');
  await page.getByTestId('product-price').fill('560');
  await page.getByTestId('product-reorder').fill('3');
  await page.getByTestId('product-opening').fill('10');
  await page.getByTestId('product-save').click();
  await expect(page.getByTestId('product-title')).toHaveText('Test Ghee 1L');
  await expect(page.getByTestId('product-stock')).toContainText('10');
  await page.getByTestId('adjust-stock').click();
  await page.getByTestId('adjust-kind').getByRole('tab', { name: 'Damage' }).click();
  await page.getByTestId('adjust-qty').fill('2');
  await page.getByTestId('adjust-save').click();
  await expect(page.getByTestId('product-stock')).toContainText('8');
  await page.waitForTimeout(1500);
  await page.reload();
  await page.goto('/#/inventory');
  await page.getByTestId('inventory-search').fill('test ghee');
  await expect(page.getByTestId('product-row')).toHaveCount(1);
  await expect(page.getByTestId('product-row')).toContainText('8');
});

test('settings: privacy toggle, theme and diagnostics', async ({ page }) => {
  await onboardWithDemo(page);
  await page.goto('/#/more');
  await page.getByTestId('privacy-toggle').click();
  await expect(page.getByTestId('privacy-toggle')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('theme').getByRole('tab', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByTestId('eval-score')).not.toHaveText('');
  await page.getByTestId('api-key-test').click();
  await expect(page.getByRole('alert').first()).toContainText('Paste your key');
});

test('insights: reorder list, dead stock and charts', async ({ page }) => {
  await onboardWithDemo(page);
  await page.goto('/#/insights');
  await expect(page.getByTestId('reorder-list').locator('li').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('dead-stock').locator('li')).toHaveCount(10);
});

test('prompt-injection text in data is treated as data', async ({ page }) => {
  await onboardWithDemo(page);
  await page.goto('/#/data/import');
  await page.getByTestId('import-file').setInputFiles('tests/fixtures/custom_price_list.csv');
  await page.getByTestId('target-custom').click();
  await page.getByTestId('import-next').click();
  await page.getByTestId('import-run').click();
  await expect(page.getByTestId('report-ok')).toHaveText('6', { timeout: 20_000 });
  await page.goto('/#/ask');
  await ask(page, 'total sales last month');
  await expect(page.getByTestId('answer-text')).toHaveText(/^Total sales for [A-Z][a-z]{2} \d{4} were ₹[\d.]+ lakh \(₹[\d,]+\) from [\d,]+ orders\.$/);
});
