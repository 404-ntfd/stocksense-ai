import { expect, test } from '@playwright/test';

test('app shell loads and all five tabs navigate', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('tab-home')).toBeVisible();
  for (const tab of ['inventory', 'data', 'more', 'home']) {
    await page.getByTestId(`tab-${tab}`).click();
  }
  await page.getByTestId('tab-ask').click();
  await expect(page).toHaveURL(/#\/ask/);
});
