import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Renders the screenshots used in docs/PRODUCT_DOCUMENT.md (npm run screenshots).
export default defineConfig({ ...base, testDir: './tests/screens', retries: 0, workers: 1 });
