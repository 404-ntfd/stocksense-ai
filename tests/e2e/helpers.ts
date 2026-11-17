import { expect, type Page } from '@playwright/test';

/** Fresh app with the demo shop loaded through onboarding. */
export async function onboardWithDemo(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('onboarding').waitFor();
  await page.getByTestId('onb-next').click();
  await page.getByTestId('onb-demo').click();
  await page.getByTestId('onb-finish').click();
  await expect(page.getByTestId('kpi-revenue-value')).toBeVisible({ timeout: 20_000 });
}

export async function ask(page: Page, q: string): Promise<void> {
  const before = await page.getByTestId('answer').count();
  await page.getByTestId('ask-input').fill(q);
  await page.getByTestId('ask-send').click();
  await expect(page.getByTestId('answer').or(page.getByTestId('ask-error')).or(page.getByTestId('action-card')).or(page.getByTestId('clarify'))).toHaveCount(before + 1, { timeout: 20_000 }).catch(() => {});
}
