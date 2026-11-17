// Fills docs/PRODUCT_DOCUMENT.template.md with sections taken straight from the code, so the
// document cannot drift from what ships: npm run docs
import { readFileSync, writeFileSync } from 'node:fs';
import { VIEW_DOCS } from '../src/core/db/semantic';
import { TARGET_FIELDS, TARGET_LABELS } from '../src/core/import/mapping';
import { INTENT_IDS } from '../src/core/ai/intents/engine';
import { NARRATE_SYSTEM } from '../src/core/ai/narrate';

const read = (p: string): string => readFileSync(p, 'utf8');
const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
const v = (name: string): string => (pkg.dependencies[name] ?? pkg.devDependencies[name] ?? '?').replace(/^file:vendor\/xlsx-/, '').replace(/\.tgz$/, '');
const score = JSON.parse(read('src/core/ai/evalScore.json')) as Record<string, { scorePct: number; passed: number; total: number }>;

const STACK: Array<[string, string, string, string]> = [
  ['App shell', `React ${v('react')}, TypeScript ${v('typescript')}, Vite ${v('vite')}`, 'One codebase for the APK, the Windows web app and Playwright tests', 'Flutter, React Native/Expo'],
  ['Android wrapper', `Capacitor ${v('@capacitor/core')} (compile/target SDK 36, minSdk 24, AGP 8.13, Gradle 8.14.3, JDK 21)`, 'Ships the same web build as a native app with plugins for speech, files, share, haptics', 'Native Kotlin rewrite'],
  ['Styling', `Tailwind CSS ${v('tailwindcss')}, lucide-react ${v('lucide-react')}`, 'Small CSS, no runtime styling cost, consistent tokens for light/dark', 'MUI, Ionic'],
  ['Routing / state', `React Router ${v('react-router-dom')} (hash routing), Zustand ${v('zustand')}`, 'Hash routes work identically from file://-like APK origins, GitHub Pages and vite preview', 'Redux'],
  ['Database', `sql.js ${v('sql.js')} (SQLite 3.54 WASM) in a Web Worker via Comlink ${v('comlink')}, persisted to IndexedDB`, 'Same engine on Android, Windows and in Node tests; no native plugin risk', '@capacitor-community/sqlite, DuckDB-WASM'],
  ['Charts', `Apache ECharts ${v('echarts')} (modular, canvas, animation off)`, 'Line, bar, donut, heatmap, Pareto and forecast bands in one library', 'Chart.js, D3'],
  ['CSV', `PapaParse ${v('papaparse')}`, 'Proven quoting and delimiter detection', 'Hand-written parser'],
  ['Excel', `SheetJS CE ${v('xlsx')} (vendored tarball from the official CDN)`, 'Reads xlsx/xls/xlsm/ods; avoids the vulnerable npm 0.18.5', 'exceljs (xlsx only)'],
  ['LLM', 'Groq OpenAI-compatible API: openai/gpt-oss-120b (SQL), openai/gpt-oss-20b (narration), qwen/qwen3.8-27b (fallback); Gemini optional', 'Fast, free tier, BYOK; llama-3.3-70b-versatile was retired', 'On-device LLM (v2)'],
  ['Speech', `@capgo/capacitor-speech-recognition ${v('@capgo/capacitor-speech-recognition')}; Web Speech API; Groq whisper-large-v3-turbo`, 'Free low-power native recogniser with partial results; Whisper where none exists', '@capacitor-community/speech-recognition 5.x'],
  ['Text to speech', `@capacitor-community/text-to-speech ${v('@capacitor-community/text-to-speech')}; speechSynthesis on the web`, 'Read answers aloud', 'Cloud TTS'],
  ['Secrets', `@aparajita/capacitor-secure-storage ${v('@aparajita/capacitor-secure-storage')}`, 'Android Keystore for the API key', 'Preferences / localStorage'],
  ['Other plugins', `@capacitor/app ${v('@capacitor/app')}, filesystem ${v('@capacitor/filesystem')}, share ${v('@capacitor/share')}, haptics ${v('@capacitor/haptics')}, keyboard ${v('@capacitor/keyboard')}, preferences ${v('@capacitor/preferences')}`, 'Back button and pause events, snapshot file, sharing backups/exports, haptics, keyboard resize', '—'],
  ['PWA', `vite-plugin-pwa ${v('vite-plugin-pwa')} (Workbox)`, 'Installable, offline web build for Windows and Android Chrome', '—'],
  ['Tests', `Vitest ${v('vitest')} + coverage-v8, Playwright ${v('@playwright/test')}`, 'Unit, integration (sql.js in Node) and E2E on the production build', 'Jest, Detox/Appium'],
  ['CI/CD', 'GitHub Actions: Node 22, Temurin JDK 21, Android SDK 36, apksigner/aapt2 verification, softprops/action-gh-release, peaceiris/actions-gh-pages', 'No extra accounts; works whatever the developer machine is', 'EAS, Capgo cloud build'],
];
const stack = ['| Layer | Choice and pinned version | Why | Alternative considered |', '| --- | --- | --- | --- |', ...STACK.map((r) => `| ${r.join(' | ')} |`)].join('\n');

const views = VIEW_DOCS.map((d) => `**\`${d.name}\`** — ${d.grain}. ${d.description}\n\n| Column | Type | Description |\n| --- | --- | --- |\n${d.columns.map((c) => `| \`${c.name}\` | ${c.type} | ${c.description}${c.sample ? ' (sample values sent to the AI unless privacy mode is on)' : ''} |`).join('\n')}`).join('\n\n') +
  '\n\n**`u_*` custom tables** — as uploaded; columns cleaned and described in `_meta_columns`.';

const INTENT_EXAMPLES: Record<string, string> = {
  compare_periods: 'Compare sales this month vs last month', stockout_forecast: 'When will Sugar 1kg run out?', forecast_product: 'Forecast for Maggi Noodles 70g',
  reorder: 'What should I reorder?', abc: 'ABC analysis', out_of_stock: 'Out of stock items', low_stock: 'Which items are running low?', dead_stock: 'Show dead stock / slow moving items',
  inventory_value: 'What is my stock worth?', margin_by_category: 'Margin by category / Which category is most profitable?', expenses_by_category: 'Where does my money go?',
  expenses_total: 'How much did I spend on rent last month?', top_customers: 'Top customers', busiest_day: 'Which day is busiest?', sales_by_category: 'Sales by category this month',
  top_products: 'Top 5 products by profit last month', bottom_products: 'Worst selling items this month', orders_count: 'How many orders this month? / Average order value',
  purchases_total: 'How much did we buy this month?', sales_trend: 'Sales trend last 30 days / Monthly sales', profit_total: 'Profit this month / Net profit last month',
  summary: 'How are we doing?', product_price: 'Price of Tata Salt 1kg', product_sales: 'Sales of Parle-G Biscuit 100g this month', stock_of_product: 'Stock of Sugar 1kg',
  product_count: 'How many products do I have?', sales_total: 'Total sales yesterday / this FY / in October',
};
const intents = `${INTENT_IDS.length} intents, matched in this order (the first that fits wins). Periods understood: today, yesterday, this/last week, this/last month, this/last quarter, this/last FY, this/last year, last N days/weeks/months, a named month (with or without a year), a date, all time. Products are matched exactly, as a family ("sugar" → all Sugar products) or fuzzily ("aashirvad atta 5 kg").\n\n| # | Intent | Example | Answer from |\n| --- | --- | --- | --- |\n` +
  INTENT_IDS.map((id, i) => `| ${i + 1} | \`${id}\` | ${INTENT_EXAMPLES[id] ?? ''} | ${['stockout_forecast', 'forecast_product', 'reorder', 'abc'].includes(id) ? 'forecast/insights tool' : 'parameterised SQL over the views'} |`).join('\n');

const synonyms = (Object.keys(TARGET_FIELDS) as Array<keyof typeof TARGET_FIELDS>).map((t) => `**${TARGET_LABELS[t]}**\n\n| Field | Required | Header names recognised |\n| --- | --- | --- |\n${TARGET_FIELDS[t].map((f) => `| ${f.label} | ${f.required ? 'yes' : ''} | ${f.synonyms.join(', ')} |`).join('\n')}`).join('\n\n');

const decisions = read('docs/DECISIONS.md').split('\n').filter((l) => l.startsWith('|')).join('\n');
const fmt = (k: string): string => (score[k] ? `**${score[k].passed}/${score[k].total} (${score[k].scorePct} %)**` : 'not run');

let out = read('docs/PRODUCT_DOCUMENT.template.md')
  .replace('{{STACK}}', stack).replace('{{VIEWS}}', views).replace('{{INTENTS}}', intents).replace('{{SYNONYMS}}', synonyms)
  .replace('{{SCHEMA_SQL}}', read('src/core/db/schema.sql').trim()).replace('{{PLAN_PROMPT}}', read('src/core/ai/prompts/plan.md').trim())
  .replace('{{NARRATE_PROMPT}}', NARRATE_SYSTEM.trim()).replace('{{DECISIONS}}', decisions)
  .replaceAll('{{EVAL_LLM}}', fmt('llm')).replaceAll('{{EVAL_PIPELINE}}', fmt('pipeline'));
out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)\{width=(\d+)\}/g, '<img src="$2" alt="$1" width="$3">');
out = out.replace('Sections marked *(generated)*', 'Sections marked *(generated)*').replace(/^/, '<!-- Generated from docs/PRODUCT_DOCUMENT.template.md by scripts/build-docs.ts (npm run docs). Edit the template, not this file. -->\n');
writeFileSync('docs/PRODUCT_DOCUMENT.md', out);
console.log(`PRODUCT_DOCUMENT.md written (${out.length} chars); unfilled placeholders: ${(out.match(/\{\{\w+\}\}/g) ?? []).filter((m) => m !== '{{SCHEMA}}').join(', ') || 'none'}`);
