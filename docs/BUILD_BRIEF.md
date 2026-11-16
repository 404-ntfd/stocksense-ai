# StockSense AI — Complete Build Brief for Fable

Nov 17, 2026 · @Joe

## 0. Mission, deliverables and ground rules

Fable, you will build **StockSense AI** (working name, rename if you like): an installable Android app that lets a small business upload its spreadsheets, track inventory, sales, costs and profit, and ask questions by voice or text and get answers, charts and forecasts back. Hard deadline: **12:00 IST on 18 Nov 2026**. Your own hard stop is **11:30 IST**, so Joe has time to test.

This brief already contains the research and the technology decisions. **Do not repeat broad research.** You get a 30-minute budget to check versions and compatibility (Phase 1), then you build.

### The two deliverables (both required)

1. **The product**: a signed Android APK, published as a GitHub Release, that installs and runs on a real phone with every Must feature in section 15 working. You also ship the same code as a web build that runs in Chrome or Edge on Windows. The web build is the fallback, and it is also your test harness.
2. **The product document**: `docs/PRODUCT_DOCUMENT.md` in the repo, covering everything technical and functional. Section 14 gives the required table of contents.

### Ground rules

- **Working beats impressive.** A small feature set that works fully beats a big one that half works. When time runs short, cut using the priority list in section 15. Never ship a broken feature on the main screens. Hide it behind a flag instead.
- **Keep the model off the numeric path.** The LLM may write SQL, pick a tool or phrase a sentence. Every number the user sees must come from SQLite or from deterministic TypeScript code, never from the model's own arithmetic.
- **Read-only AI.** Nothing the model writes may change data. Any write the user asks for by voice ("add 20 units of rice") becomes a structured confirmation card that the user taps to approve. The app then runs its own parameterised insert.
- **Prove the riskiest thing first.** That means building an APK and installing it on a phone. Do it before any features (Gate G1, section 10).
- **Keep main always buildable.** Commit at the end of each phase, tag it (`p2-skeleton`, `p3-data`, …) and let CI build an APK on every push.
- **Work unattended.** Joe may be asleep for part of your run. When a decision is reversible, take the most reasonable option, record it in `docs/DECISIONS.md` (one line each: decision, reason, alternative) and carry on. Stop and wait only for actions that can't be undone or that need Joe's credentials.
- **Spend tokens carefully.** Generate data with scripts, not inside your context window. Don't re-read large files you just wrote. Don't paste huge outputs into the conversation.

## 1. Pre-flight checklist for Joe (about 30 minutes, before you start Fable)

Each item below removes a blocker Fable can't clear by itself. Items 1 to 4 are mandatory.

- [ ] **1. Groq API key.** Sign up at console.groq.com (free, no card) and create a key. In the playground, send one chat message to `openai/gpt-oss-120b` to confirm it works. Fable needs this key for its tests, and you enter it in the app's Settings.
- [ ] **2. GitHub repo.** Create an empty private repo, for example `stocksense-ai`, with Actions enabled. Give Fable push access: attach the repo to the Fable session, or run `gh auth login` on the machine where Fable runs. CI builds the APK, so this is the most important step.
- [ ] **3. Decide where Fable runs.**
  - Cloud session (recommended): no local setup needed, because the APK builds on GitHub Actions.
  - Your Windows laptop: install Node 22 LTS, Git and Chrome or Edge. Android Studio Otter (2025.2.1+) with JDK 21 and SDK 36 is optional, and only needed for local APK builds. Keep the laptop plugged in with sleep turned off.
- [ ] **4. Test phone ready.** Android 8 or later (ideally 10+) with at least 3 GB of RAM. Turn on "Install unknown apps" for Chrome or your Files app. Update the Google app and "Speech Services by Google". Optionally download the English (India) offline speech pack.
- [ ] **5. Real sample files (strongly recommended).** Add 1 to 3 real XLSX or CSV exports from a small business (stock list, sales register, purchase bills), anonymised, to `samples/real/` in the repo. Messy real files are the best import test there is.
- [ ] **6. Optional backup key.** A Google AI Studio (Gemini) key, so the app has a second provider.
- [ ] **7. Two check-ins.** (a) Around T0 + 2h: install the skeleton APK from GitHub Releases on your phone and reply "G1 OK" or describe the error. (b) Around 10:00 IST: run the 15-minute device test script (section 12) and send Fable the results. That leaves Fable 90 minutes to fix device-only bugs.

When you start Fable, attach this brief as `docs/BUILD_BRIEF.md` (export this doc as Markdown) and paste the kickoff prompt from section 16.

## 2. Research findings: how others build this

Production text-to-SQL products ground the model in a well-described schema, retrieve examples, run the query on a real engine and keep the model away from the arithmetic. Indian SMB voice-inventory apps all converge on the same short list of features. The findings below drive every decision in section 3.

### 2.1 Text-to-SQL in production

- **Retrieval-grounded prompting is the industry pattern.** Vanna, an open-source text-to-SQL framework, stores DDL, documentation and example question/SQL pairs, and retrieves the relevant ones into each prompt ([Vanna overview](https://genai4a11.github.io/concepts/vanna.html)). Its maintainers say combining schema, documentation and prior queries can raise accuracy from about 3% to about 80% ([Vanna repo index](https://docsearch.algolia.com/mcp/docs/repo/vanna-ai/vanna)).
- **Schema quality matters more than model size.** A clear schema with column descriptions beats a better model on a vague schema ([text-to-data guide](https://genai4a11.github.io/concepts/database-query.html)). **Implication:** the LLM only sees curated SQL views with plain-English column descriptions, never the raw base tables.
- **Keep the model off the numeric path.** Retail Genie, a research system for Indian kirana shops, is built on the rule that language models classify but never compute ([Retail Genie paper](https://www.irejournals.com/formatedpaper/1724169.pdf)). DukaanVoice stores money as integer paise and records stock as auditable movements ([DukaanVoice](https://dev.to/gautammax/dukaanvoice-ai-408h)). We adopt both.

### 2.2 What competing SMB apps offer (the feature bar)

| App or project | What it does | Takeaway for us |
| --- | --- | --- |
| [DukanSaathi](https://www.commudle.com/builds/hackfest-bc02-voice-enabled-inventory-manager-our-solution-title-dukansaathi) | Voice commands such as "Add 20 Parle-G packets" or "Show low stock items", stock-out prediction, voice reports | Low stock, stock-out prediction and voice reports are the minimum users expect |
| [BizBuddy AI](https://venkatacharan22.github.io/bizbuddy-presentation/) | Voice-first PWA with agent tools: get\_low\_stock, get\_sales\_analytics, get\_demand\_forecast | Tool calling plus forecasting tools is a proven pattern; our forecasting is a tool too |
| [Vyapar Saathi](https://devfolio.co/projects/vyapar-saathi-c136) | "Cheeni kitna bacha hai?", days-to-stockout alerts, reorder quantity suggestions | Days of cover and reorder quantity are the most valued insights; Hinglish matters later |
| [Periscope Inventory](https://inventory.periscopechat.com/) | Commercial Indian SMB tool with natural-language and voice queries plus stock alerts | Natural-language querying is already a paid feature in India |
| [Flipkart × Sarvam AI](https://www.mitsloanme.com/?p=9740) | Voice ordering in regional languages for small retailers | Regional-language voice is the v2 differentiator |

### 2.3 Which KPIs small businesses track

Start with inventory turnover, stockout rate and inventory accuracy ([inFlow](https://www.inflowinventory.com/blog/inventory-kpis/)). Days of inventory, sell-through and reorder point (average daily usage × lead time + safety stock) are the standard next layer ([Linnworks](https://www.linnworks.com/blog/inventory-kpi/)). Dead stock means items with no sales over a set lookback window ([Cleverence](https://www.cleverence.com/amp/articles/for-business/metrics-for-inventory-management-4827/)). Section 8 lists every formula we use.

## 3. Technology decisions

The stack is one TypeScript codebase: a React web app, wrapped as an Android APK with Capacitor 8. The database is SQLite running in a Web Worker. Answers come from a cloud LLM with your own key (BYOK), and there is an offline rule-based fallback. Voice uses Android's native speech recogniser. Each choice was made for three reasons: Fable can test it end to end in a headless browser, it runs unchanged on Windows, and it uses almost no CPU when idle.

### 3.1 Decision table

| Layer | Decision (v1) | Why | Rejected alternatives |
| --- | --- | --- | --- |
| App shell | **React 19 + TypeScript + Vite**, wrapped with **Capacitor 8** for Android | One codebase gives the APK, the Windows web app/PWA and a Playwright-testable build. Capacitor 8 needs Node 22+, JDK 21, compile/target SDK 36 and minSdk 24 ([Capgo build guide](https://capgo.app/ko/blog/troubleshooting-capacitor-android-build-errors/)). | Flutter (no headless web testing in Fable's sandbox; Dart plugins for STT and LLM less mature); React Native/Expo (web target weak for SQLite and charts; EAS needs an account) |
| UI | Tailwind CSS + a few hand-written components; lucide-react icons; React Router; Zustand for state | Small bundle, no runtime CSS-in-JS | MUI and Ionic (heavy) |
| Database | **SQLite (sql.js WASM) in a Web Worker**, persisted to IndexedDB, with snapshots to Capacitor Filesystem | The same engine on Android, Windows and in tests; no native plugin risk; the LLM writes SQLite SQL well | @capacitor-community/sqlite: native, but the web side uses jeep-sqlite with manual saveToStore and keeps the whole DB in memory ([Capgo comparison](https://capgo.app/blog/capacitor-community-sqlite-alternative/)), and there are reported wasm setup errors ([Ionic forum](https://forum.ionicframework.com/t/capacitor-community-sqlite-gives-error-wasm-streaming-compile-failed-linkerror-webassembly-instantiate/248571)). DuckDB-WASM is too heavy for phones. |
| LLM | **Cloud, BYOK, provider-agnostic.** Default Groq `openai/gpt-oss-120b` for SQL, `openai/gpt-oss-20b` for short narration; optional Gemini provider | Fast, has a free tier, and Joe already uses Groq | **Do not use `llama-3.3-70b-versatile`.** Groq shut it down on 16 Aug 2026 and recommends `openai/gpt-oss-120b` or `qwen/qwen3.6-27b` ([Groq deprecations](https://console.groq.com/docs/deprecations.md)). On-device LLM: see section 4. |
| Offline AI | Deterministic **intent engine** (regex + synonyms + fuzzy product match) for the top 25 questions | Works with no network or key, and costs nothing in battery | Local LLM (deferred to v2) |
| Speech-to-text | **Native Android SpeechRecognizer** through `@capgo/capacitor-speech-recognition` v8; Web Speech API in Chrome/Edge; optional **Whisper mode** (Groq `whisper-large-v3-turbo`) | Free, low power, live partial results. The Capgo plugin follows Capacitor's major version and merges segmented-results and silence-handling fixes for Android ([plugin README](https://cdn.jsdelivr.net/npm/@capgo/capacitor-speech-recognition@8.1.10/README.md)). | @capacitor-community/speech-recognition (last release 5.1.0, older Capacitor) ([npm](https://www.npmjs.com/package/@capacitor-community/speech-recognition)); on-device whisper.cpp (v2) |
| Charts | **Apache ECharts**, modular imports + CanvasRenderer, animations off or under 300 ms | Covers line, bar, combo/Pareto, donut, heatmap, treemap and forecast bands in one library | Chart.js (needs plugins for heatmap and treemap); D3 (too slow to build with) |
| CSV parsing | **PapaParse** (worker mode, streaming) | Proven, handles delimiters, quotes and encodings | Hand-written parser |
| XLSX parsing | **SheetJS CE 0.20.3** from the official CDN tarball | npm `xlsx` is stuck at 0.18.5 with two high-severity vulnerabilities; the vendor distributes fixed versions only from its CDN ([analysis](https://www.issoh.co.jp/md/tech/19141), [SheetJS issue](https://git.sheetjs.com/sheetjs/sheetjs/issues/2961)) | If cdn.sheetjs.com is blocked from Fable's sandbox: commit the tarball to `vendor/` from any machine that can reach it, or fall back to `exceljs` (xlsx only, no .xls) |
| Forecasting | **TypeScript**: Holt's linear smoothing with a weekly index; Croston/SBA for intermittent demand; moving average for short history | Milliseconds per SKU, no ML runtime, explainable | TensorFlow.js or Prophet (heavy, battery cost) |
| Text-to-speech (Should) | `@capacitor-community/text-to-speech`; Web `speechSynthesis` | Reads short answers aloud | Cloud TTS |
| Secrets | `capacitor-secure-storage-plugin` or `@aparajita/capacitor-secure-storage`, falling back to Preferences | API key stays out of plain localStorage | Hard-coded key (forbidden) |
| Tests | Vitest (unit), Playwright (E2E on the web build), LLM eval script | All run inside Fable's sandbox | Detox and Appium (no device in the sandbox) |
| CI/CD | **GitHub Actions**: Node 22, Temurin JDK 21, Android SDK 36, `assembleRelease` with the keystore from secrets, APK uploaded to a GitHub Release | Works whatever network limits Fable's sandbox has | EAS and Capgo cloud build (extra accounts) |

### 3.2 When Fable may deviate

- **Version drift.** Change versions only when Phase 1 checks show a package's latest major release doesn't support Capacitor 8 or Node 22. Record the change in `docs/DECISIONS.md`.
- **CORS.** In Phase 1, run `fetch` against `https://api.groq.com/openai/v1/models` from the web build. If CORS blocks it, enable `CapacitorHttp` for the Android build (it sends requests through native code, so CORS doesn't apply) and add a 20-line Vite dev proxy for web. CapacitorHttp has no response streaming, so use non-streaming completions.
- **Database.** Swap sql.js for `@capacitor-community/sqlite` or `@capgo/capacitor-fast-sql` only if sql.js fails on the device. Keep the `db` interface (section 5) unchanged, so a swap touches one file.
- **Never deviate** on these: read-only AI, model off the numeric path, BYOK with no hard-coded keys, and a shippable web fallback.

## 4. Feasibility and risk analysis

Verdicts: an Android APK is feasible today, but only if the first APK is proven early. An on-device LLM is technically possible but not accurate or fast enough for v1. v1 is English only, with the language parameter carried through every layer so Hindi can be switched on in v1.1.

### 4.1 Can a small local model run the AI? Possible, but not in v1

- **Accuracy is too low at phone size.** On the Spider benchmark, base Qwen2.5-Coder scores 55.8% at 1.5B, 69.1% at 3B and 79.3% at 7B in execution accuracy ([fine-tune study](https://gh.r-mj.com/Lawson-Darrow/Text-to-SQL-Finetune)). On BIRD, base 1.5B scores 28.6% and 3B scores 37.1% ([SQL-Factory](https://arxiv.org/pdf/2504.14837)). Specialised fine-tunes reach 67% on BIRD at 1.5B, but only with 16-sample generation plus merge revision ([SLM-SQL](https://arxiv.org/pdf/2507.22478)), and that is far too slow and battery-hungry on a phone. Roughly one wrong answer in three about a shop's money is unacceptable.
- **Runtimes exist but are young or device-limited.** Gemma 3 1B is 529 MB and Google recommends at least 4 GB of RAM ([Google AI Edge](https://developers.googleblog.com/es/gemma-3-on-mobile-and-web-with-google-ai-edge)). The MediaPipe LLM Inference API is now maintenance-only, with LiteRT-LM as its successor ([Android guide](https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference/android?hl=id)), and it is tuned for high-end devices such as the Pixel 8 and Galaxy S23 ([guide](https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference/android?authuser=4)). Gemini Nano through ML Kit's Prompt API only runs on supported devices ([ML Kit GenAI](https://developers.google.com/ml-kit/genai)). A llama.cpp Capacitor plugin exists ([llama-cpp-capacitor](https://unpkg.com/llama-cpp-capacitor@0.1.2/README.md)), but it is version 0.1.x and needs an NDK build.
- **v1 decision.** Use a cloud LLM for the open-ended questions. Use the **offline intent engine** for the top 25 questions, and keep every dashboard KPI fully local. A local model would also make the phone hot for each 1 to 3 second answer, while the cloud plus rules approach costs almost no battery.
- **v2 path.** Add `LocalLlmProvider` behind the same `LlmProvider` interface. Prefer Gemini Nano (Prompt API) where the device supports it; otherwise use llama.cpp with Qwen2.5-Coder-3B Q4 plus a fine-tune on our golden question set. Only enable it when it scores at least 90% on our eval.

### 4.2 Languages: English in v1; the pipeline is built for more

- **Speech recognition** handles Indian languages: Android's on-device recogniser accepts `hi-IN` with `EXTRA_PREFER_OFFLINE`, and Android 14 added language switching between listed languages such as `hi-IN` and `en-IN` ([field test](https://hackernoon.com/testing-androids-on-device-speech-recognition-with-hindi-english-code-switching)). Speech is not the bottleneck.
- **The bottleneck is text-to-SQL accuracy in other languages and scripts.** It is untested, and Fable has no time to build a non-English golden set.
- **v1 ships English** (`en-IN` default, `en-US` option). Every layer takes a `lang` parameter, and Settings → Labs has a hidden "Hindi (experimental)" toggle that sends the transcript to the LLM unchanged. v1.1: Hindi and Hinglish, with a Hindi golden set. v1.2: Malayalam and Tamil, adding a translate-to-English step before SQL generation.

### 4.3 Platform risk: Android first, Windows as guaranteed fallback

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Fable's sandbox can't download Gradle or the Android SDK | High | Blocks the APK | Build in GitHub Actions; local builds are optional |
| Signing or install problems on Joe's phone | Medium | Blocks the demo | Gate G1 at T0+2h: Joe installs the skeleton APK. Debug APK as backup. |
| Native speech plugin misbehaves on a particular phone | Medium | Voice degraded | Whisper mode (records in the WebView, uploads to Groq) plus typed input |
| WebView memory with large DBs | Low to medium | Crash on big imports | 50 MB / 300k-row import cap with a warning; parsing in a worker; chunked inserts |
| LLM rate limits (Groq free tier) or outage | Medium | AI answers fail | Retry with backoff, provider switch, offline intent engine, clear error card |
| Can't finish everything by 11:30 | Medium | Partial product | Priority order in section 15, feature freeze at 08:45 IST, web build always shippable |

**Windows path.** `npm run build` produces static files. Run them with `npm run preview` or from GitHub Pages in Chrome or Edge, and use "Install app" to get a desktop PWA. The same PWA installs on Android Chrome, giving a second phone fallback if the APK fails. In browsers, voice uses the Web Speech API (Chrome/Edge, needs network) or Whisper mode.

## 5. System architecture

Three threads keep the UI smooth on cheap phones. The UI thread does rendering only. A DB worker owns SQLite, imports and KPI queries. An analytics worker runs the forecasts. Network calls go out only for speech in Whisper mode and for LLM requests, and each sends the minimum data needed.

&#91;embedded content: runtime architecture · 3 threads, 2 optional cloud services\]

The DB worker is the only component that touches business data. Cloud calls start from the UI thread, and only when the user asks a question the intent engine can't answer.

### 5.1 Module boundaries (interfaces Fable must keep stable)

```ts
// src/core/db/DbClient.ts — the only way UI talks to SQLite (Comlink over a Worker)
interface DbClient {
  exec(sql: string, params?: unknown[]): Promise<void>;          // app-internal writes only
  query<T>(sql: string, params?: unknown[], opts?: {readOnly?: boolean; timeoutMs?: number; maxRows?: number}): Promise<QueryResult<T>>;
  transaction(fn: (tx: Tx) => Promise<void>): Promise<void>;
  importRows(target: ImportTarget, rows: AsyncIterable<Row[]>, mode: 'append'|'upsert'|'replace', batchId: string): Promise<ImportReport>;
  undoImport(batchId: string): Promise<void>;
  schemaForLlm(): Promise<SchemaDoc>;                            // curated views + descriptions only
  snapshot(): Promise<Uint8Array>;  restore(bytes: Uint8Array): Promise<void>;
}
// src/core/ai/LlmProvider.ts
interface LlmProvider { id: 'groq'|'gemini'|'local'; complete(req: LlmRequest): Promise<LlmResponse>; listModels(): Promise<string[]>; }
// src/core/voice/SpeechEngine.ts
interface SpeechEngine { id: 'native'|'webspeech'|'whisper'; available(): Promise<boolean>; start(opts: {lang: string; continuous: boolean}): void; stop(): Promise<string>; on(e: 'partial'|'final'|'error'|'state', cb: Function): Unsubscribe; }
// src/core/ask/AskPipeline.ts
interface AskPipeline { ask(q: {text: string; lang: string; history: Turn[]}): AsyncGenerator<AskEvent>; } // events: stage, sql, rows, chart, answer, error
```

### 5.2 Repository layout

```text
stocksense-ai/
  android/                  # generated by `npx cap add android`, committed
  src/
    app/                    # routes, layout, bottom nav, theme
    features/dashboard/ ask/ inventory/ data/ insights/ settings/ onboarding/
    core/db/                # worker.ts, schema.sql, views.sql, migrations/, DbClient.ts
    core/import/            # csvParser.ts, xlsxParser.ts, headerDetect.ts, mapping.ts, coerce.ts
    core/ai/                # providers/, prompts/, sqlGuard.ts, fewshot.ts, narrate.ts, intents/
    core/voice/             # nativeEngine.ts, webSpeechEngine.ts, whisperEngine.ts, controller.ts
    core/analytics/         # kpis.ts, forecast.ts, abc.ts, chartPicker.ts
    core/util/              # money.ts (paise, ₹ lakh/crore format), dates.ts (IST, FY Apr–Mar), log.ts
  tests/unit/  tests/e2e/  tests/eval/golden.json  tests/fixtures/ (messy CSV/XLSX)
  scripts/generate-demo-data.ts  scripts/run-eval.ts
  docs/BUILD_BRIEF.md  docs/PRODUCT_DOCUMENT.md  docs/DECISIONS.md  docs/TEST_REPORT.md
  .github/workflows/android.yml  .github/workflows/web.yml
```

### 5.3 Battery and CPU rules

- Nothing runs in the background. No polling, timers or wake locks. KPIs are recomputed only after a data change, and the results are cached in the `_kpi_cache` table.
- The microphone runs only while the user can see that it's on. It stops automatically after 60 s of silence in continuous mode, and immediately when the app is paused (Capacitor `App` `pause` event).
- Charts render once and resize on demand. No animation loops; turn off the `dataZoom` animation.
- Heavy work (parsing, imports, forecasting all SKUs) runs in workers in 2,000-row chunks, yielding between chunks.
- Forecasts are cached per SKU and recomputed only when that SKU's sales change, or once a day when the app opens.

## 6. Data model, import and table creation

There are two layers. Strict **base tables** are the single source of truth: money in integer paise, stock as movements. On top sit **LLM-facing views** with friendly names, rupee amounts and descriptions. Uploaded files either map into base tables or become custom `u_` tables that are still queryable.

### 6.1 Base schema (`src/core/db/schema.sql`)

```sql
PRAGMA foreign_keys = ON;
CREATE TABLE products (id INTEGER PRIMARY KEY, sku TEXT UNIQUE NOT NULL, name TEXT NOT NULL, category TEXT DEFAULT 'Uncategorised',
  unit TEXT DEFAULT 'pcs', cost_paise INTEGER DEFAULT 0, price_paise INTEGER DEFAULT 0, reorder_level REAL DEFAULT 0,
  lead_time_days INTEGER DEFAULT 7, supplier_id INTEGER REFERENCES suppliers(id), is_active INTEGER DEFAULT 1,
  import_batch TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT);
CREATE TABLE suppliers (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, phone TEXT, email TEXT, import_batch TEXT);
CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, phone TEXT, import_batch TEXT);
CREATE TABLE sales (id INTEGER PRIMARY KEY, invoice_no TEXT, sale_date TEXT NOT NULL /*YYYY-MM-DD*/, product_id INTEGER NOT NULL REFERENCES products(id),
  customer_id INTEGER REFERENCES customers(id), qty REAL NOT NULL CHECK(qty > 0), unit_price_paise INTEGER NOT NULL,
  discount_paise INTEGER DEFAULT 0, tax_paise INTEGER DEFAULT 0, unit_cost_paise INTEGER /*snapshot at sale*/, import_batch TEXT);
CREATE TABLE purchases (id INTEGER PRIMARY KEY, bill_no TEXT, purchase_date TEXT NOT NULL, product_id INTEGER NOT NULL REFERENCES products(id),
  supplier_id INTEGER REFERENCES suppliers(id), qty REAL NOT NULL CHECK(qty > 0), unit_cost_paise INTEGER NOT NULL, tax_paise INTEGER DEFAULT 0, import_batch TEXT);
CREATE TABLE stock_movements (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), move_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('opening','purchase','sale','return_in','return_out','adjustment','damage','count')),
  qty_delta REAL NOT NULL, ref_table TEXT, ref_id INTEGER, note TEXT, import_batch TEXT);
CREATE TABLE expenses (id INTEGER PRIMARY KEY, expense_date TEXT NOT NULL, category TEXT NOT NULL, amount_paise INTEGER NOT NULL, note TEXT, payment_mode TEXT, import_batch TEXT);
CREATE TABLE _import_batches (id TEXT PRIMARY KEY, file_name TEXT, target TEXT, mode TEXT, rows_ok INTEGER, rows_failed INTEGER, created_at TEXT, undone INTEGER DEFAULT 0);
CREATE TABLE _meta_tables (table_name TEXT PRIMARY KEY, display_name TEXT, description TEXT, is_custom INTEGER);
CREATE TABLE _meta_columns (table_name TEXT, column_name TEXT, display_name TEXT, description TEXT, sem_type TEXT /*date|money|qty|category|id|text|number*/, PRIMARY KEY(table_name, column_name));
CREATE TABLE _qa_log (id INTEGER PRIMARY KEY, asked_at TEXT, question TEXT, sql TEXT, ok INTEGER, ms INTEGER, feedback INTEGER);
CREATE TABLE _settings (key TEXT PRIMARY KEY, value TEXT);  CREATE TABLE _schema_version (v INTEGER);
-- Triggers: AFTER INSERT/DELETE on sales and purchases write or remove the matching stock_movements row.
-- Indexes: sales(sale_date), sales(product_id, sale_date), purchases(product_id, purchase_date), stock_movements(product_id, move_date), expenses(expense_date).
```

### 6.2 LLM-facing views (the semantic layer)

| View | Grain | Key columns (rupees as REAL) |
| --- | --- | --- |
| `v_products` | product | sku, name, category, unit, cost\_price, selling\_price, stock\_on\_hand, stock\_value\_at\_cost, reorder\_level, stock\_status ('out', 'low', 'ok', 'overstock'), last\_sale\_date, days\_since\_last\_sale |
| `v_sales` | sale line | sale\_date, month (YYYY-MM), fy (e.g. 'FY2026-27'), weekday, invoice\_no, sku, product\_name, category, customer\_name, qty, revenue, cogs, gross\_profit |
| `v_purchases` | purchase line | purchase\_date, month, sku, product\_name, supplier\_name, qty, cost\_total |
| `v_expenses` | expense | expense\_date, month, category, amount |
| `v_daily_summary` | day | day, revenue, cogs, gross\_profit, expenses, net\_profit, orders, units |
| `v_product_performance` | product × month | month, sku, product\_name, units, revenue, gross\_profit, margin\_pct |
| `v_forecast` (table written by the analytics worker) | product | sku, avg\_daily\_demand, forecast\_7d, forecast\_30d, days\_of\_cover, predicted\_stockout\_date, suggested\_reorder\_qty, method, confidence |
| `u_*` custom tables | as uploaded | columns as cleaned, described in `_meta_columns` |

Base rules: revenue = qty × unit\_price − discount, excluding tax. COGS = qty × unit\_cost\_at\_sale, falling back to the product's current cost. Display in ₹ with Indian grouping (1,00,000), and use lakh/crore in spoken answers. The financial year runs April to March, and dates are in IST.

### 6.3 Import wizard (CSV, XLSX, XLS)

1. **Pick a file** (Capacitor file picker, or `<input type=file>` on web). Reject anything over 50 MB, and warn above 300k rows.
2. **Parse in a worker.** CSV: PapaParse with an auto-detected delimiter (`,` `;` tab `|`) and encoding (UTF-8, stripping the BOM; retry as windows-1252 if you see the replacement character). XLSX/XLS: SheetJS with `cellDates:true`. Let the user choose a sheet when there are several.
3. **Detect the header row.** Score the first 15 rows by text-cell ratio and uniqueness, and skip title rows such as "ABC Traders – Stock Report". Flatten merged headers by joining with a space. Dedupe header names (`qty`, `qty_2`).
4. **Pick the target.** Products, Sales, Purchases, Expenses, Stock count (sets on-hand quantities via `count` movements), or New custom table. Auto-suggest from the header match score.
5. **Map columns.** Fuzzy-match against a synonym dictionary: name ← item, item name, product, particulars, description; sku ← code, item code, barcode, hsn+name; qty ← quantity, qty, pcs, nos, units; price ← rate, mrp, selling price, sp; cost ← cost, purchase rate, cp; date ← date, bill date, inv date, invoice date. Show a confidence for each mapping. An optional "Ask AI to map" button sends headers plus 3 sample rows. Unmapped columns are kept in a JSON `extra` column.
6. **Validate and coerce** with a preview of 20 rows and a per-row error list. Numbers: strip ₹, Rs, commas, spaces, Indian grouping; `(123)` means −123. Dates: Excel serials, `dd/mm/yyyy` by default (Indian), `yyyy-mm-dd`, `dd-MMM-yy`; ambiguous `03/04/2026` follows the setting "Day first (India)". Text: trim and collapse spaces. SKUs stay text so leading zeros survive. Unknown products in Sales or Purchases are auto-created with a warning count.
7. **Choose the mode:** Append, Upsert by SKU or invoice + line, or Replace table (behind a confirmation dialog).
8. **Import** in one transaction per 2,000-row chunk, with a progress bar and a cancel button. Every row gets `import_batch`. Afterwards show the report: rows ok, failed (downloadable as CSV), created products, plus an **Undo import** button.
9. **Custom tables:** name them `u_<slug>`. Types are inferred per column (INTEGER, REAL, TEXT, DATE), and the LLM writes a one-line description per column into `_meta_columns`, which the user can edit.

The Data screen also has: table browser (paged grid, search, sort), add/edit/delete row forms for base tables, export of any table or query result to CSV/XLSX, a full database backup file (`.stocksense` = SQLite bytes) and restore, and "Load demo data" or "Clear all data".

## 7. AI pipeline: voice to text to SQL to answer

A question goes through seven stages: capture voice, show an editable transcript, try the offline intent engine first, otherwise make one LLM call that returns a JSON plan, guard and run the SQL locally, choose the chart by rules, then narrate using only numbers from the result. The usual cost is one or two LLM calls per question, with 1.5 to 3 s to the answer on Groq.

&#91;embedded content: Ask pipeline · offline branch and repair loop\]

The offline branch skips the model entirely. The cloud branch can retry twice on a SQLite error before showing suggestions.

### 7.1 Voice capture ("infinite" dictation)

- **Modes.** Tap-to-talk is the default: it stops at the end of the utterance and submits automatically after 1.2 s of silence. **Continuous dictation** is a toggle on the mic button: the mic stays on, every final segment is appended to the transcript, and nothing is submitted until the user taps Send.
- **Making it continuous.** Android's recogniser ends each session after silence. The controller listens for `end` or `final` and restarts within 250 ms while continuous mode is on. On Android 13+ (API 33) use the plugin's segmented-session option where it is available. Silence the restart beep with a short volume duck, or accept it and document it. Stop after 60 s with no speech, or 10 minutes in total.
- **Live UI.** Partial results appear greyed out, final text in black. The transcript can always be edited before sending. A waveform or level meter shows the mic is live, a timer runs, and a big Stop button is always visible.
- **Engine selection** (`SpeechEngine`, with automatic fallback): native on Android, Web Speech in Chrome/Edge, Whisper as a manual or automatic fallback. Whisper mode records with `MediaRecorder` (webm/opus or mp4), splits at roughly 1 s of silence using an RMS voice-activity threshold (max 30 s per chunk), posts each chunk to `/audio/transcriptions` with `model=whisper-large-v3-turbo` and `language=en`, and stitches the text together. Groq's free tier allows 20 requests a minute, 2,000 a day, 7,200 audio seconds an hour and 25 MB per upload ([limits](https://spokenly.app/blog/free-speech-to-text-apis)), so throttle to 15 chunks a minute.
- **Normalising transcripts.** Spoken numbers to digits ("two hundred" → 200, "one lakh" → 100000), "rupees" → ₹, units (kgs → kg). Product-name fuzzy matching (Jaro-Winkler against `products.name` and `sku`) corrects misheard names and is shown as "Did you mean *Aashirvaad Atta 5kg*?".
- **Permissions.** Request `RECORD_AUDIO` only when the mic is first used, with a rationale screen. If permission is denied, show typed input plus a button to open settings. In the manifest, add `<queries><intent><action android:name="android.speech.RecognitionService"/></intent></queries>`, because Android 11+ package visibility otherwise hides the recogniser.

### 7.2 Routing

1. **Intent engine (offline, under 50 ms).** It matches the top 25 patterns with slots: `stock of {product}`, `low stock`, `out of stock`, `top {n} products {period}`, `sales {period}`, `profit {period}`, `margin by category`, `dead stock`, `when will {product} run out`, `what should I reorder`, `expenses {period}`, `compare {period} vs {period}`, and so on. Periods: today, yesterday, this/last week, this/last month, this FY, last 30/90 days, a named month. Each pattern maps to parameterised SQL or a tool call written by Fable. If the match confidence is at least 0.85, answer locally.
2. **Otherwise the LLM plan call**, when a key is set and the device is online. With no key or no network, the app suggests the closest supported questions.
3. **Write requests** ("add", "sold", "received", "update price") go to an action parser. The LLM returns `{action, product, qty, price, date}`, the app shows a confirmation card, and only a tap writes the data using app-side parameterised SQL.

### 7.3 The LLM plan call

- **Model:** `openai/gpt-oss-120b`, temperature 0, JSON output (use structured outputs or `response_format` where the provider supports it, and otherwise parse robustly), max 800 output tokens, 20 s timeout.
- **System prompt** (keep it in `src/core/ai/prompts/plan.md` and version it):
  - Role: a SQLite analyst for a small Indian retail business. Answer only from the given views.
  - Context: today's date in IST, FY from April to March, currency ₹, and the business name.
  - Schema: each view with column names, types, descriptions and up to 15 distinct sample values for category-type columns (behind a privacy toggle).
  - Glossary: "stock" means `stock_on_hand`; "profit" means gross profit unless the user says "net"; "this month" means calendar month to date; "best selling" means by revenue unless the user says by units; "slow moving" means 30+ days since last sale; "dead stock" means 90+ days.
  - Rules: SELECT or WITH only, the SQLite dialect (`strftime`, `date('now','localtime')`, no `ILIKE`, use `LIKE` with `COLLATE NOCASE`), always alias columns readably, `LIMIT 200` unless aggregating, never invent columns. If the question is ambiguous, return `intent: clarify` with one short question. If it asks for a forecast, return `intent: tool` with `tool: forecast`.
  - Few-shot: the 6 most similar golden examples, retrieved with BM25 over question text from `tests/eval/golden.json` (no vector DB needed).
  - Conversation: the last 3 turns (question, SQL, result shape), so follow-ups like "and last month?" work.
- **Output schema:**

```json
{"intent":"sql|tool|clarify|unsupported","sql":"SELECT ...","tool":{"name":"forecast|reorder|abc","args":{"sku":"...","horizon_days":30}},
 "chart":{"type":"auto|line|bar|hbar|donut|scatter|table|kpi","x":"col","y":["col"],"series":"col|null"},
 "title":"Top 5 products by revenue, Oct 2026","assumptions":["'last month' = Oct 2026"],"clarify":null}
```

### 7.4 SQL guard (`sqlGuard.ts`; test every rule)

- Remove comments. Allow exactly one statement, which must start with `SELECT` or `WITH`. Reject on the keywords `INSERT UPDATE DELETE DROP ALTER CREATE REPLACE ATTACH DETACH PRAGMA VACUUM REINDEX` and on `load_extension`.
- Every referenced table must be an allowed view or a `u_` table (simple tokenizer check against the allow-list). `_meta*`, `_settings` and `_qa_log` are blocked.
- If the outer query has no `LIMIT`, wrap it as `SELECT * FROM (<sql>) LIMIT 1000`.
- Run inside `SAVEPOINT ask; … ROLLBACK TO ask;` as defence in depth, with a 3 s timeout (the worker interrupts with `sqlite3_interrupt`, or terminates and restarts the worker).
- **Repair loop:** on a SQLite error, send the error message and the SQL back once (max 2 retries). On an empty result, say so plainly and suggest a broader period. Never let the model guess an answer.

### 7.5 Chart picker (deterministic, model hint optional)

- Single row with a single value: KPI card.
- Date or month on x: line, adding a 7-day moving average when there are more than 30 points.
- Category with up to 12 rows: bar, horizontal if labels are longer than 12 characters.
- More than 12 categories: top 10 plus "Others".
- Share of a whole with up to 6 parts: donut.
- Two numeric columns: scatter.
- Anything else: table. Every answer also has a "Table" tab and a "Show SQL" toggle.

### 7.6 Narration (grounded)

- Call `openai/gpt-oss-20b` with the question plus the result as JSON (at most 50 rows and 4 KB, otherwise a summary: row count, sums, top 5). Return 1 to 3 sentences and 2 follow-up suggestions.
- **Number grounding check:** extract every number from the narration. Each must appear in the result, allowing for rounding and ₹ lakh formatting. If any doesn't, discard the narration and use the local template ("Top product is {name} with ₹{revenue}.").
- **Privacy mode** (in Settings) never sends result rows. Narration then always uses local templates.

### 7.7 Errors the user can see

| Situation | What the user sees |
| --- | --- |
| No API key | Offline answers still work; banner: "Add a free Groq key to ask anything", linking to Settings |
| Offline | "You're offline, so I can only answer the common questions" plus suggestion chips |
| 429 or 5xx | Retry with backoff (1 s, 3 s); then "AI is busy, try again"; offer to switch provider |
| Bad SQL after repairs | "I couldn't work that out, try rephrasing", plus 3 suggestions; logged in `_qa_log` |
| Clarify | The question is shown with tappable options |

## 8. Analytics, KPIs, forecasting and visualizations

The dashboard answers the five questions a shop owner asks every morning: how much did I sell, am I making money, what is running out, what is not moving, and what should I order. Every KPI is a SQL view or a pure TypeScript function with a unit test against hand-computed demo values.

### 8.1 KPI catalogue (all computed locally)

| KPI | Formula | Shown on |
| --- | --- | --- |
| Revenue (period) | Σ qty × unit\_price − discount | Dashboard card, trend |
| Gross profit / margin % | Revenue − COGS; GP ÷ revenue × 100 | Dashboard card |
| Net profit | Gross profit − Σ expenses | Dashboard card |
| Orders / avg order value | Distinct invoice\_no (or sale rows when invoice\_no is missing); revenue ÷ orders | Dashboard |
| Inventory value | Σ stock\_on\_hand × cost\_price | Dashboard card |
| Low stock / out of stock count | stock ≤ reorder\_level; stock ≤ 0 | Dashboard card, list |
| Days of cover | stock\_on\_hand ÷ avg daily demand (last 28 days) | Inventory, Insights |
| Inventory turnover | COGS (period) ÷ average inventory at cost | Insights |
| Days of inventory (DIO) | 365 ÷ turnover | Insights |
| Sell-through % | units sold ÷ (opening + units received) × 100 | Insights |
| Dead stock value / % | stock value of SKUs with no sale in 90 days ÷ total stock value | Dashboard card, Insights |
| ABC class | SKUs sorted by revenue (last 90 days); A = top 80% cumulative, B = next 15%, C = rest | Insights Pareto |
| Reorder point | avg daily demand × lead\_time + safety stock | Insights |
| Safety stock | 1.65 × σ(daily demand) × √lead\_time (95% service level) | Insights |
| Suggested order qty | max(0, forecast over lead\_time + 14 days + safety stock − stock\_on\_hand), rounded up to a whole unit | Reorder list |
| Growth | (this period − previous period) ÷ previous period | Card deltas with arrows |

### 8.2 Forecasting (`core/analytics/forecast.ts`)

- **Series:** daily units per SKU, zero-filled from the first sale to today.
- **Method selection per SKU:**
  - At least 56 days of history and under 50% zero days: Holt's linear smoothing on weekly totals, spread across days with a day-of-week index. Fit α and β by grid search on the last 4 weeks.
  - 50% or more zero days: Croston/SBA.
  - Under 28 days: 14-day moving average, marked "low confidence".
  - No sales: no forecast.
- **Backtest:** hold out the last 14 days and compute WAPE. Confidence is high below 25%, medium at 25 to 50% and low above 50%. Show it as a chip.
- **Outputs** (written to the `v_forecast` table): forecast\_7d, forecast\_30d, an 80% band from residual σ, predicted\_stockout\_date, suggested\_reorder\_qty.
- **Performance target:** 500 SKUs × 18 months in under 2 s in the worker on a mid-range phone.
- **Wording:** always call it an "estimate based on your past sales", never a promise.

### 8.3 Visualizations by business need

| Business question | Chart | Screen |
| --- | --- | --- |
| Are sales going up? | Line: daily revenue with 7-day moving average; period switch 7D/30D/90D/FY | Dashboard |
| Am I making money? | Combo: revenue bars + gross-profit line, monthly | Dashboard |
| Where does revenue come from? | Donut (≤ 6 categories) or treemap | Dashboard, Insights |
| What sells best or worst? | Horizontal bar, top/bottom 10, switch revenue/units/profit | Dashboard, Insights |
| Which few items matter most? | Pareto: bars + cumulative % line, A/B/C bands | Insights |
| Is my stock healthy? | Stacked bar per category: out / low / ok / overstock | Inventory |
| What is stuck? | Bar: stock value by age since last sale (0–30, 31–60, 61–90, 90+ days) | Insights |
| Which days are busy? | Heatmap: weekday × week, revenue | Insights |
| Where does money go? | Donut: expenses by category; monthly stacked bars | Insights |
| When will it run out? | Line: history (solid) + forecast (dashed) + 80% band + stock-out marker | Product detail, Ask |

Chart style: one accent colour plus neutrals, ₹ axis labels in Indian grouping (₹1.2L, ₹3.4Cr), and a large touch-friendly tooltip. Every chart has a "View data" table toggle. Dark mode is supported.

## 9. UI/UX: screens and flows

The app has five tabs in a bottom navigation bar, with a large centre mic button. It is designed mobile first at 360 × 640 dp and also works at desktop width. A first-time user should get from opening the app to their first voice answer in under 2 minutes.

| Screen | Contents | Key interactions |
| --- | --- | --- |
| Onboarding (3 steps, skippable) | Business name and type; "Try with demo data", "Import my file" or "Start empty"; optional AI key with a "Get a free key" link and a Test button | Demo data loads in under 3 s; the key test shows a green tick |
| Home (Dashboard) | Period chips (Today, 7D, 30D, This month, FY); 6 KPI cards with change vs the previous period; revenue trend; revenue vs profit; top 5 products; low-stock list (5 items + "See all"); "Ask about this" chips | Pull to refresh; tap a card to drill down; long-press to explain how a KPI is calculated |
| Ask (centre mic) | Chat thread; mic with live transcript; continuous-dictation toggle; text box; suggestion chips; answer cards (headline sentence, KPI or chart, Table tab, Show SQL, assumptions, follow-up chips, thumbs up/down, copy/share as image) | Hold or tap to talk; edit before sending; tap a follow-up; speaker icon reads the answer aloud |
| Inventory | Search plus filters (category, status); product rows with a stock status chip and days of cover; product detail (stock, prices, margin, sales chart with forecast, movement history); add/edit product; stock adjustment (count, damage, return) | Swipe a row for quick adjust; FAB to add a product; barcode scan is v2 |
| Data | Tables list with row counts; Import wizard; table grid; import history with Undo; export; backup/restore | Each import shows a progress bar and a report |
| Insights (inside Home or More) | Reorder suggestions (with share to WhatsApp as text); dead stock; ABC Pareto; heatmap; expenses; forecasts | Tap a reorder item to open the product |
| Settings (More) | AI provider, key, models, privacy mode; voice engine, language, continuous mode, auto-send delay, read answers aloud; business profile, currency, day-first dates, FY start; backup; diagnostics (logs, version, eval score); Labs (Hindi) | Every setting takes effect immediately |

UX rules:

- Every state has a design: empty ("No sales yet, import or add one"), loading (skeletons), error (plain language plus a retry action) and offline.
- Touch targets are at least 48 dp. Body text is at least 16 sp, and KPI numbers 28 sp. The app respects system font scaling and uses WCAG AA contrast.
- The Android back button closes the open sheet or dialog first, then goes back. A double back on Home exits the app.
- The keyboard never covers the input (use `Keyboard` plugin resize mode). Safe areas and edge-to-edge are handled by the Capacitor 8 System Bars API.
- Show numbers as ₹1,23,456 in cards and ₹1.23L in charts. Show dates as 17 Nov 2026.
- Use light haptics on mic start and stop, and a short sound only if the system sound setting is on.

## 10. Time budget and phase plan

The budget is 9 hours, from T0 to the 11:30 IST hard stop (the clock times below assume T0 = 02:30 IST). It splits roughly as: validation 6%, building 64%, testing and fixing 19%, documentation 8%, with the cut list in section 15 as the buffer. If you start later, shrink P3 to P6 and cut from the bottom of the priority list. **Never shrink P2 (the APK pipeline) or P7 (testing).**

| Phase | T0 + | IST | Build | Exit criteria (all must pass) |
| --- | --- | --- | --- | --- |
| P0 Setup | 0:00–0:15 | 02:30–02:45 | Probe environment (node, npm, git, gh, java, network to npm, GitHub, cdn.sheetjs.com, api.groq.com); scaffold repo; write `docs/DECISIONS.md` | Probe results logged |
| P1 Validate | 0:15–0:45 | 02:45–03:15 | Check versions of Capacitor 8, the Capgo speech plugin v8, sql.js, ECharts, SheetJS 0.20.3, PapaParse; check Groq CORS and models list; one live plan call | Versions pinned in `package.json`; CORS decision recorded |
| P2 Skeleton + APK | 0:45–1:45 | 03:15–04:15 | Vite + React + Tailwind shell with 5 tabs; `cap add android`; keystore; both CI workflows; GitHub Release `v0.1.0-skeleton` with the APK | **G1:** CI green, signed APK attached to the release; web build passes the Playwright smoke test |
| P3 Data | 1:45–3:15 | 04:15–05:45 | DB worker, schema, views, triggers, migrations, persistence; demo data generator; import wizard (CSV/XLSX, mapping, coerce, undo); table browser; export; backup | Fixture imports produce expected row counts; demo KPIs match hand-computed values |
| P4 Dashboard + Inventory | 3:15–4:15 | 05:45–06:45 | KPI queries plus cache, 6 cards, 4 charts, period chips; inventory list and detail, product CRUD, stock adjustment | Dashboard renders within 1 s on demo data in an emulated mid-range phone profile |
| P5 Ask + Voice | 4:15–5:45 | 06:45–08:15 | Intent engine (25 patterns); Groq provider; plan prompt plus few-shot; SQL guard; repair loop; chart picker; grounded narration; native, Web Speech and Whisper engines; continuous dictation; action confirmation cards | **G2:** golden eval at least 80% correct results, 100% of guard tests pass, intent engine at least 95% on its 60 test phrases |
| P6 Insights + polish | 5:45–6:30 | 08:15–09:00 | Forecast worker, reorder list, dead stock, ABC, heatmap; onboarding; settings; empty and error states; dark mode | **G3 feature freeze at 09:00:** every Must story passes E2E. No new features after this point. |
| P7 Test + fix | 6:30–7:30 | 09:00–10:00 | Full Playwright run, edge-case fixtures, performance checks, eval rerun; release **v1.0.0-rc1** | Test report drafted; RC1 APK on the release page; message Joe |
| Joe's device test | 7:30–8:00 | 10:00–10:30 | Meanwhile Fable writes `PRODUCT_DOCUMENT.md` | Joe sends back the device test results |
| P8 Device fixes | 8:00–8:45 | 10:30–11:15 | Fix device-only bugs by severity; RC2 | No blocker or critical bugs open |
| P9 Release | 8:45–9:00 | 11:15–11:30 | Tag **v1.0.0**; final APK plus web build; finish the docs; handoff message | Both deliverables linked in the final message |

**Gate rules.**

- **G1 fails** (no CI APK by T0 + 2:30): ship the PWA as the primary build from then on. Spend at most 30 more minutes on Android in total, and only between other phases.
- **G2 fails:** spend at most 30 minutes improving prompts, views and few-shot examples. Then ship with the "Show SQL + thumbs down" feedback loop and record the measured accuracy in the docs.
- **Behind schedule at any gate:** cut Could items, then Should items (section 15). Never cut testing.
- **Status updates:** post a 3-line update to Joe at every gate covering done, next, and risks.

## 11. Master edge-case list

Each item needs a fixture or a test, or a deliberate "won't handle in v1" line in Known Limitations. Fable ticks items off in `docs/TEST_REPORT.md`.

### 11.1 Files and import

- [ ] UTF-8 with BOM; windows-1252 (₹ or é garbled); UTF-16 Excel CSV export
- [ ] Delimiters `;`, tab and `|`; quoted fields containing commas and newlines; trailing empty columns; a ragged row with an extra or missing cell
- [ ] Title rows above the header; two-row merged headers; blank rows in the middle; a totals row at the bottom ("Total", "Grand Total"), which must be detected and skipped
- [ ] Duplicate header names; headers with spaces, dots, Unicode or emoji, which become safe SQL identifiers (snake\_case, `c_` prefix if one starts with a digit, SQLite reserved words quoted)
- [ ] Multiple sheets; hidden sheets; an empty sheet; a password-protected file (clear error); `.xls` (BIFF8); `.xlsm`; a `.numbers` or `.ods` file (unsupported message, or SheetJS reads ODS)
- [ ] Excel date serials, including the 1900 leap-year bug; text dates `17/11/2026`, `17-Nov-26`, `2026-11-17`; ambiguous `03/04/2026`; dates with a time; empty dates (a row error for sales, allowed for products)
- [ ] Numbers as `₹1,23,456.50`, `Rs. 500`, `1.2L`, `(250)`, `-`, `NA`, `—`; percentage strings; scientific notation from Excel for long barcodes, which must become text with a warning
- [ ] SKUs with leading zeros (`00123`) stay text; mixed-type columns; formulas (use cached values); errors such as `#DIV/0!` and `#N/A` become NULL with a warning
- [ ] Duplicate SKUs within a file (keep the last, with a warning); the same file imported twice (upsert prevents doubles, append warns "looks like a duplicate import" via a file hash)
- [ ] Sales referencing unknown products (auto-create plus a count); negative qty in sales (treated as a return, `return_in`); zero price; price below cost (flag)
- [ ] Very large file (50 MB or 300k rows): streamed, chunked, cancellable; memory stays under 300 MB; the app doesn't freeze
- [ ] The app is killed mid-import: the batch is marked incomplete and its rows are rolled back on next launch
- [ ] A cell containing a prompt-injection string ("ignore previous instructions…"): it is treated as data, never goes into the system prompt, and sample values are truncated to 40 characters

### 11.2 Data and business logic

- [ ] Stock goes negative (sold more than recorded): show −5 in red with a "fix stock" action, never crash
- [ ] A product with no cost price: margin shows "–" and is excluded from margin averages, with a note
- [ ] Division by zero in every ratio (margin with zero revenue, turnover with zero inventory) returns NULL, displayed as "–"
- [ ] Periods with no data: an empty chart message, not an axis with nothing on it
- [ ] FY boundaries (31 Mar to 1 Apr); month boundaries in IST, with the device timezone checked; leap day 29 Feb 2028
- [ ] Units: fractional quantities in kg and litres; display rounded to 3 decimals
- [ ] Deleting a product that has sales is blocked; the product is archived instead
- [ ] Undoing an import that later edits depend on: confirm, then cascade to that batch's movements only

### 11.3 Voice

- [ ] Mic permission denied, or "don't ask again": typed input plus a deep link to settings
- [ ] No speech recognition service on the device (some Xiaomi, Huawei or AOSP builds): fall back to Whisper mode
- [ ] Offline with no offline language pack: native fails, so show "Download offline English in Google settings" or use typed input
- [ ] Noisy shop: low-confidence results show alternatives; the user can tap to correct
- [ ] Indian accents and code-mixing ("Parle-G kitna stock hai"): the English model will still transcribe partly; fuzzy product match helps
- [ ] Numbers and units spoken in words; product names that sound like common words ("Tiger" biscuits)
- [ ] Phone call or another app takes the mic; app sent to background mid-dictation; screen off; Bluetooth headset connected or disconnected
- [ ] Continuous mode left on: auto-stop after 60 s of silence or 10 minutes in total; the restart loop must not spin when the recogniser errors repeatedly (back off after 3 errors in 10 s)
- [ ] Very long dictation (over 5 minutes): the transcript buffer handles it, and the request to the LLM is capped at 2,000 characters with a warning

### 11.4 AI and LLM

- [ ] No key, an invalid key (401), quota exceeded (429), timeout, 5xx, provider model retired (404 model not found), which triggers a `listModels()` refresh and a switch to the configured fallback
- [ ] The model returns invalid JSON, JSON in code fences, extra prose, or SQL that uses columns that don't exist (repair loop)
- [ ] The model tries a write, PRAGMA or ATTACH, or several statements (guard blocks it; logged)
- [ ] Very expensive query (a cross join over 300k rows): stopped by the 3 s timeout, with the message "too heavy, try narrowing the period"
- [ ] Ambiguous questions ("how are we doing?"): a clarify chip set, or a default to this month's KPI summary
- [ ] Relative dates ("last Diwali" can't be resolved, so clarify; "last month" in the first days of a month; "this week" starts Monday)
- [ ] Follow-ups ("and for oil?", "show as a chart", "why?"); a question about data that isn't loaded ("supplier ratings") gets "I don't have that data"
- [ ] Questions outside the business domain ("write a poem"): a polite refusal to stay on task
- [ ] Narration numbers that don't match the result: the grounding check falls back to the template
- [ ] A huge result set (10k rows): paged table, narration from the summary only

### 11.5 App, device and platform

- [ ] Android 8 to 15 (minSdk 24 as Capacitor 8 requires); WebView older than Chrome 100 shows an "Update Android System WebView" prompt
- [ ] Low-end device: 2 to 3 GB RAM, 720p, 32-bit ARM
- [ ] Rotation; split screen; system font at 200%; dark mode; RTL not needed in v1
- [ ] App killed by the OS: on restart the DB is intact (persistence flushed on `pause` and after each transaction batch)
- [ ] Storage full while saving the DB: a clear error, with the previous snapshot kept
- [ ] Update over an old version: migrations run in order, with a pre-migration backup
- [ ] Clock or timezone wrong on the device: use the device time but show the as-of date on the dashboard
- [ ] Play Protect warning on install: explain it in the install guide
- [ ] The API key never appears in logs, crash reports, exports or backups

## 12. Testing strategy and acceptance criteria

There are four test layers. Three run automatically in Fable's sandbox and in CI on every push: unit, integration and E2E on the web build. The fourth is the LLM eval, run at G2 and again before RC1. The real-device test is done by Joe with the script in 12.4.

### 12.1 Test layers

| Layer | Tool | What it covers | Target |
| --- | --- | --- | --- |
| Unit | Vitest | Number/date coercion, header detection, mapping, SQL guard (at least 40 attack cases), KPI functions, forecast methods, chart picker, intent parser (60 phrases), number grounding, money formatting | At least 150 tests, all green; at least 80% line coverage of `core/` |
| Integration | Vitest + sql.js in Node | Import every fixture, then check row counts, KPIs and undo; migrations; backup/restore round trip | All fixtures pass |
| E2E | Playwright (Chromium, Pixel 7 viewport, fake mic) | Onboarding to demo data to dashboard; import XLSX; ask by typing; voice via a mocked SpeechEngine; product CRUD; settings; offline mode (network blocked) | 12 Must-story specs green |
| LLM eval | `scripts/run-eval.ts` against real Groq | `tests/eval/golden.json`: **60 questions** with gold SQL. Pass means the result set matches gold (order-insensitive, numeric tolerance 0.5%). | **At least 80%** at G2 and at least 85% at release; 0 unsafe SQL executed |
| Performance | Playwright trace + `performance.now()` logs, CPU throttle ×4 | Cold start, dashboard, query latency, import throughput | Section 12.3 budgets |

### 12.2 Golden set and demo data

- `scripts/generate-demo-data.ts` (seeded, deterministic) builds "Sree Krishna Stores, Thrissur", a general store with 150 products in 12 categories, 25 suppliers and 18 months of daily sales. The data includes a weekly pattern (Sunday peak), Onam and Diwali spikes, 10 dead SKUs, 8 low-stock SKUs, 3 out of stock, plus expenses (rent, salary, electricity, transport).
- Messy fixtures in `tests/fixtures/` cover each item in 11.1. Also commit `samples/demo_sales.xlsx` and `samples/demo_stock.csv` for Joe to try importing.
- Golden questions cover: totals by period (10), top/bottom N (8), category breakdowns (6), stock status (8), profit and margin (8), comparisons and growth (6), forecasts and reorders via tools (6), and follow-ups and ambiguity (8). Write the gold SQL by hand and verify it against the generator's known values.

### 12.3 Acceptance criteria (definition of done for v1.0.0)

- [ ] **AC1.** The APK installs on Android 10+ and opens to onboarding in under 3 s on a mid-range phone.
- [ ] **AC2.** Demo data loads, and the dashboard shows 6 correct KPI cards and 4 charts in under 1 s.
- [ ] **AC3.** A 10k-row XLSX sales file imports in under 15 s, with an accurate report and a working undo.
- [ ] **AC4.** A custom CSV becomes a `u_` table that can be queried by voice.
- [ ] **AC5.** Tap the mic and say "What were my total sales last month?" The correct ₹ figure, a chart and a sentence appear within 5 s on 4G.
- [ ] **AC6.** Continuous dictation captures at least 2 minutes of speech across pauses, with no lost segments, and stops cleanly.
- [ ] **AC7.** In airplane mode, the dashboard, inventory and the top 25 questions all work; open questions show the offline message.
- [ ] **AC8.** No LLM output can modify data (guard tests plus an E2E injection test).
- [ ] **AC9.** Forecasts and reorder suggestions appear for SKUs with at least 28 days of history, with a confidence chip.
- [ ] **AC10.** Data survives force-stop, reboot and app update; backup and restore round-trips.
- [ ] **AC11.** Idle CPU is about 0% and there is no mic use when the app is in the background (check in Android settings: battery usage under 1% for 10 minutes of idle foreground).
- [ ] **AC12.** The web build runs in Edge on Windows, with the same features apart from native voice.
- [ ] **AC13.** The golden eval is at least 85%, and its score is shown in Settings → Diagnostics and in the test report.
- [ ] **AC14.** APK size is under 30 MB; minSdk 24, targetSdk 36; release-signed.

### 12.4 Joe's 15-minute device test script (send the results to Fable)

1. Download the RC APK from GitHub Releases. Install it, accept the Play Protect prompt, and open the app.
2. Onboarding: choose demo data, paste your Groq key, tap Test and confirm the green tick.
3. Home: are the numbers shown? Does each chart scroll and respond to taps? Rotate the phone once.
4. Ask by voice: "total sales this month", "top five products by profit last month", "which items are running low", "when will sugar run out". Note how long each takes and whether it is correct.
5. Turn on continuous mode and speak for 1 minute with pauses, then send.
6. Airplane mode: ask "low stock items", open Inventory, then turn airplane mode off.
7. Data: import `samples/demo_sales.xlsx` from your phone (download it from GitHub first), check the report, then tap Undo.
8. Inventory: add a product, adjust its stock, then search for it.
9. Force-stop the app in Android settings, reopen it, and check your product is still there.
10. Report: phone model and Android version, plus a pass/fail for each step, with screenshots of any failure.

## 13. Build, signing, release and install

GitHub Actions builds a release-signed APK on every push to `main`, and attaches it to a GitHub Release on every `v*` tag. Joe installs it from the Release page on his phone. Local builds are optional.

### 13.1 Android project settings

- `appId` `in.stocksense.app`; `appName` "StockSense AI"; versionCode is the CI run number; versionName comes from the git tag.
- Capacitor 8 defaults: minSdk 24, compile and target SDK 36, AGP 8.13, Gradle 8.14.3, JDK 21 ([Capgo](https://capgo.app/ko/blog/troubleshooting-capacitor-android-build-errors/)).
- Manifest: `INTERNET`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` (for audio ducking, if used), the speech `<queries>` block from 7.1, and `android:allowBackup="true"` with a backup rule excluding the secure-storage key.
- Release builds: R8 is fine for a WebView app. Keep the Capacitor plugin classes (their default proguard rules). Turn on `shrinkResources`.
- Generate the icon and splash with `@capacitor/assets` from a single 1024 px SVG (a simple box-and-waveform mark in the accent colour).

### 13.2 Signing

1. Fable runs `keytool -genkeypair -v -keystore release.jks -alias stocksense -keyalg RSA -keysize 2048 -validity 10000` with a generated strong password.
2. Base64-encode it and store it with `gh secret set` as `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`. **Never commit the keystore.** Add `*.jks` to `.gitignore`.
3. Give Joe the keystore and passwords privately (as a file in the session, not in the repo), and tell him to keep them safe: losing them means future updates can't install over this app.

### 13.3 Workflow `.github/workflows/android.yml` (outline)

```yaml
on: { push: { branches: [main], tags: ['v*'] }, workflow_dispatch: {} }
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: 21 }
      - uses: android-actions/setup-android@v3
      - run: npm ci && npm run test:unit && npm run build && npx cap sync android
      - run: echo "$ANDROID_KEYSTORE_B64" | base64 -d > android/app/release.jks
        env: { ANDROID_KEYSTORE_B64: '${{ secrets.ANDROID_KEYSTORE_B64 }}' }
      - run: cd android && ./gradlew assembleRelease assembleDebug --no-daemon
          -Pandroid.injected.signing.store.file=$PWD/app/release.jks
          -Pandroid.injected.signing.store.password=$KS_PASS -Pandroid.injected.signing.key.alias=$KEY_ALIAS
          -Pandroid.injected.signing.key.password=$KEY_PASS
        env: { KS_PASS: '${{ secrets.ANDROID_KEYSTORE_PASSWORD }}', KEY_ALIAS: '${{ secrets.ANDROID_KEY_ALIAS }}', KEY_PASS: '${{ secrets.ANDROID_KEY_PASSWORD }}' }
      - uses: actions/upload-artifact@v4
        with: { name: apk, path: android/app/build/outputs/apk/**/*.apk }
      - if: startsWith(github.ref, 'refs/tags/v')
        uses: softprops/action-gh-release@v2
        with: { files: 'android/app/build/outputs/apk/release/*.apk' }
```

`web.yml` runs lint, unit and E2E tests, then deploys `dist/` to GitHub Pages as the Windows/PWA fallback. Name the APK file `StockSense-AI-v1.0.0.apk`.

### 13.4 Install guide (also goes into the product document)

- **Android:** open the Release link in Chrome, download the APK and tap it. Allow "Install unknown apps" for Chrome. If Play Protect warns about an unknown developer, tap "More details" then "Install anyway". Uninstall any earlier debug build first, because signatures differ.
- **Windows:** open the GitHub Pages URL in Edge or Chrome and choose "Install app" from the menu. Or clone the repo and run `npm ci && npm run build && npm run preview`, then open `http://localhost:4173`.
- **PWA on Android** (fallback): open the Pages URL in Chrome and choose "Add to Home screen".

## 14. Deliverable 2: the product document

`docs/PRODUCT_DOCUMENT.md` is the single reference for anyone who builds on, sells or supports the product. Write it from the code and the test results as they actually are, not from this brief. Where something differs from the brief, say so. Include Mermaid diagrams, which GitHub renders, and screenshots taken by Playwright at the Pixel 7 viewport (`docs/img/`).

Required table of contents:

1. **Executive summary:** what it is, who it's for, what v1 does, and a release link.
2. **Problem, users and personas:** a kirana owner, a hardware store manager and a small distributor, each with jobs to be done.
3. **Feature list and user stories:** MoSCoW with status (shipped, partial, deferred) and acceptance criteria results.
4. **Functional specification per screen:** purpose, elements, states, interactions and screenshots.
5. **Architecture:** diagram, threads and workers, module interfaces, data flow for Ask.
6. **Tech stack:** exact pinned versions, each with a one-line rationale and the alternative considered.
7. **Data model:** ERD (Mermaid), full DDL, views with column descriptions, triggers, indexes, migrations policy.
8. **AI design:** routing, intent catalogue, the prompts verbatim, output schema, SQL guard rules, repair loop, narration grounding, privacy (exactly what leaves the device), model and provider configuration.
9. **Voice design:** engines, continuous-mode state machine, normalisation, permissions, language roadmap.
10. **Analytics reference:** every KPI formula, forecasting method and backtest, chart catalogue.
11. **Import specification:** formats, header detection, mapping dictionary, coercion rules, error codes, undo.
12. **Security and privacy:** key storage, data at rest, network calls, threat model (prompt injection, SQL injection, data exfiltration), known gaps.
13. **Performance and battery:** measured numbers against the section 12.3 budgets, and the design measures.
14. **Test report summary:** counts, pass rates, coverage, golden eval score with failure analysis, device test results (links to `TEST_REPORT.md`).
15. **Build and release:** local setup (Windows and Linux), CI, signing, versioning, how to cut a release.
16. **Install and user guide:** step by step with screenshots, including sample questions to try.
17. **Configuration and troubleshooting:** settings reference and the 15 most likely errors with fixes.
18. **Known issues and limitations:** honest and specific.
19. **Roadmap:** v1.1, v1.2 and v2 (section 15), with effort estimates.
20. **Decision log:** the contents of `DECISIONS.md` as a table.
21. **Changelog.**

Also deliver: `README.md` (a 1-minute quick start plus links), `docs/TEST_REPORT.md`, and `docs/DECISIONS.md`. Optionally export a PDF of the product document using `md-to-pdf` if it installs quickly.

## 15. Scope priorities, cut list and roadmap

Must items define a shippable v1. When time runs out, cut from the bottom of Could, then from the bottom of Should, and keep every Must. A cut feature is hidden, not half-shown, and listed in Known Issues.

| Priority | Feature | Cut order (1 = cut first) |
| --- | --- | --- |
| Must | Signed APK in GitHub Release plus web/PWA build | never |
| Must | SQLite persistence, schema, views, backup/restore | never |
| Must | Import CSV/XLSX into Products, Sales, Purchases, Expenses and custom tables, with mapping, validation and undo | never |
| Must | Demo data and onboarding | never |
| Must | Dashboard: 6 KPI cards, revenue trend, top products, low stock | never |
| Must | Inventory list, detail, add/edit, stock adjustment | never |
| Must | Ask: typed and voice (tap-to-talk), LLM text-to-SQL with guard, chart picker, grounded answer, Show SQL | never |
| Must | Continuous dictation mode | never |
| Must | Offline intent engine (top 25 questions) | never |
| Must | Settings: key, provider, model, voice, privacy mode | never |
| Should | Forecasts, reorder list, days of cover | 6 |
| Should | Whisper voice mode | 5 |
| Should | Write actions by voice with confirmation cards | 4 |
| Should | Insights: dead stock, ABC Pareto, revenue vs profit | 3 |
| Could | Read answers aloud (TTS) | 2 |
| Could | Heatmap, expenses charts, share answer as image, WhatsApp reorder share | 1 |
| Could | Gemini provider | 1 |

### Roadmap after v1

- **v1.1 (1 to 2 weeks):** Hindi and Hinglish with a Hindi golden set; barcode scanning (ML Kit); GST fields and tax reports; multiple stores; native SQLite plugin for very large datasets; a server proxy for keys (Cloudflare Worker) so users don't need their own.
- **v1.2 (3 to 4 weeks):** Malayalam and Tamil (transcribe, translate to English, generate SQL); scheduled morning summary notifications; supplier purchase orders as PDF; Tally and Vyapar export import presets.
- **v2 (6 to 10 weeks):** on-device LLM (Gemini Nano Prompt API on supported devices, otherwise llama.cpp with a fine-tuned Qwen2.5-Coder-3B) once eval reaches 90% or more; on-device Whisper; cloud sync and multi-user roles; Play Store release.

## 16. Kickoff prompt to paste into Fable

Copy the block below into Fable as the first message, with this brief attached as `docs/BUILD_BRIEF.md`. Replace the bracketed parts first.

```text
You are the sole engineer shipping StockSense AI, a production-ready MVP Android app (plus web/PWA fallback)
for small-business inventory, cost and sales analytics with voice-driven AI questions.

Your full specification is docs/BUILD_BRIEF.md. Read it once, completely, before doing anything. It is the
source of truth: research and technology decisions are already made there. Do not redo broad research.

Hard facts:
- Now: [START TIME] IST. Your hard stop: 11:30 IST today. Joe tests at 10:00 IST.
- Repo: [github.com/<user>/stocksense-ai]  (push access granted; Actions enabled)
- Groq API key for testing: provided as env var GROQ_API_KEY. Never commit it, never log it, never bake it into the build.
- Joe may be asleep until ~09:30. Work unattended: decide reversible things yourself and log them in
  docs/DECISIONS.md; post a 3-line status at each gate (G1, G2, G3, RC1).

Do this, in order:
1. Create a task list from section 10's phases P0-P9 and follow its time boxes and gate rules exactly.
2. P0/P1 (45 min max): probe the environment and validate the versions/CORS items in section 3.2. Pin versions.
3. P2: prove the riskiest thing first - a signed APK built by GitHub Actions and attached to a Release,
   before any feature work. If G1 fails by T0+2:30, switch to PWA-primary per the gate rules.
4. Build P3-P6 against section 15 priorities. Must features only until they all pass, then Should, then Could.
   Feature freeze at 09:00 IST no matter what.
5. Non-negotiables: read-only AI behind the SQL guard; every displayed number comes from SQLite/TS, never from
   the model; offline intent engine works without a key; continuous dictation works; data persists.
6. Test continuously (section 12). Run the golden eval at G2 and before RC1. Tick section 11 edge cases in
   docs/TEST_REPORT.md.
7. Release v1.0.0-rc1 by 10:00 IST and message Joe the link plus the device test script (12.4). Write
   docs/PRODUCT_DOCUMENT.md (section 14) while he tests. Fix his findings by severity, then tag v1.0.0.
8. Final message: links to the v1.0.0 APK, the web/PWA URL, PRODUCT_DOCUMENT.md and TEST_REPORT.md; the
   golden eval score; what was cut and why; known issues; keystore handover instructions.

Be economical: generate data with scripts, keep large outputs out of context, commit and tag at every phase.
```

### 16b. Autonomous-mode addendum (paste as a second message, or right after the kickoff prompt)

This overrides every part of the brief that waits for Joe: the G1 phone install, the 10:00 device test and the "message Joe" steps. Joe will test on Windows first, using the web build.

```text
AUTONOMOUS MODE - this overrides anything in docs/BUILD_BRIEF.md that waits for Joe.

Rules:
1. Never ask Joe a question and never pause for approval or input. Joe is unavailable until you finish. When
   anything is ambiguous, take the most reasonable option, log it as one line in docs/DECISIONS.md
   (decision | reason | alternative) and keep going.
2. Plan, then execute straight through P0-P9 without stopping. Do not wait at gates. Gates are self-checks:
   run the criteria yourself, apply the gate rules from section 10 if a gate fails, and continue.
3. If something is blocked (a network limit, a missing tool, a failing plugin), use the documented fallback,
   log it and move on. Switch to the web/PWA-primary path rather than stopping.
4. Self-test everything. Joe has given you no sample files, so create all of them yourself with scripts: the
   demo data generator, the messy CSV/XLSX fixtures for every item in section 11.1, and the 60-question golden
   set. Do not ask for real files.
5. Windows-first. Joe will first test the WEB build on Windows (Chrome or Edge), not an Android phone. Make this
   path perfect: it needs `npm ci && npm run build && npm run preview`, plus a published GitHub Pages URL, and a
   Windows quick-start in README.md written for someone who has only Node 22 installed. Keep the Android APK
   pipeline too: build and sign it in CI, attach it to the Release, and note in the docs that it is not yet tested
   on a physical phone.
6. Replace any step that needs a human device test with automated checks: Playwright with a Pixel 7 viewport,
   a mocked SpeechEngine plus fake-audio-capture runs, CPU throttle x4, offline-mode runs, and a check that the APK
   exists, is signed (apksigner verify) and has the expected size, minSdk and targetSdk.
7. Do not message or wait for Joe at G1, G2, G3 or RC1. Write one running status file, docs/STATUS.md, with a
   3-line update at each gate, and commit it.
8. Facts: repo is 404-ntfd/stocksense-ai (push access granted, Actions enabled). The Groq key is in the env var
   GROQ_API_KEY: use it for tests and the eval only. Never commit it, never log it, never build it into the app.
   Joe will paste it into the app's Settings himself.
9. Finish by the hard stop. Tag v1.0.0 at or before 11:30 IST even if features were cut. A cut feature is hidden and
   listed under Known Issues, never half-shown.
10. Your single final message must contain: the Release link (APK), the GitHub Pages URL, the exact Windows
   commands to run the web build locally, links to PRODUCT_DOCUMENT.md and TEST_REPORT.md, the golden-eval
   score, what was cut and why, known issues, and how to hand over the signing keystore.

Now plan and execute.
```

## Sources

- [Capgo: Capacitor 8 Android build settings](https://capgo.app/ko/blog/troubleshooting-capacitor-android-build-errors/) · [Capacitor 8 announcement](https://ionic.io/blog/announcing-capacitor-8)
- [@capgo/capacitor-speech-recognition README](https://cdn.jsdelivr.net/npm/@capgo/capacitor-speech-recognition@8.1.10/README.md) · [@capacitor-community/speech-recognition on npm](https://www.npmjs.com/package/@capacitor-community/speech-recognition)
- [Groq deprecations](https://console.groq.com/docs/deprecations.md) · [Groq Whisper free-tier limits](https://spokenly.app/blog/free-speech-to-text-apis)
- [Capgo: SQLite plugin comparison](https://capgo.app/blog/capacitor-community-sqlite-alternative/) · [Ionic forum: jeep-sqlite wasm error](https://forum.ionicframework.com/t/capacitor-community-sqlite-gives-error-wasm-streaming-compile-failed-linkerror-webassembly-instantiate/248571)
- [SheetJS npm vulnerability issue](https://git.sheetjs.com/sheetjs/sheetjs/issues/2961) · [SheetJS 0.20.3 install analysis](https://www.issoh.co.jp/md/tech/19141)
- [Text-to-SQL fine-tune study (Spider, by size)](https://gh.r-mj.com/Lawson-Darrow/Text-to-SQL-Finetune) · [SQL-Factory (BIRD)](https://arxiv.org/pdf/2504.14837) · [SLM-SQL](https://arxiv.org/pdf/2507.22478)
- [Gemma 3 on mobile (Google AI Edge)](https://developers.googleblog.com/es/gemma-3-on-mobile-and-web-with-google-ai-edge) · [MediaPipe LLM Inference, Android](https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference/android?hl=id) · [ML Kit GenAI](https://developers.google.com/ml-kit/genai) · [llama-cpp-capacitor](https://unpkg.com/llama-cpp-capacitor@0.1.2/README.md)
- [Android on-device Hindi/English recognition test](https://hackernoon.com/testing-androids-on-device-speech-recognition-with-hindi-english-code-switching)
- [Vanna overview](https://genai4a11.github.io/concepts/vanna.html) · [Vanna repo index](https://docsearch.algolia.com/mcp/docs/repo/vanna-ai/vanna) · [Text-to-data guide](https://genai4a11.github.io/concepts/database-query.html)
- [Retail Genie paper](https://www.irejournals.com/formatedpaper/1724169.pdf) · [DukaanVoice](https://dev.to/gautammax/dukaanvoice-ai-408h) · [DukanSaathi](https://www.commudle.com/builds/hackfest-bc02-voice-enabled-inventory-manager-our-solution-title-dukansaathi) · [BizBuddy AI](https://venkatacharan22.github.io/bizbuddy-presentation/) · [Vyapar Saathi](https://devfolio.co/projects/vyapar-saathi-c136) · [Periscope Inventory](https://inventory.periscopechat.com/) · [Flipkart × Sarvam AI](https://www.mitsloanme.com/?p=9740)
- [inFlow inventory KPIs](https://www.inflowinventory.com/blog/inventory-kpis/) · [Linnworks KPI formulas](https://www.linnworks.com/blog/inventory-kpi/) · [Cleverence metrics](https://www.cleverence.com/amp/articles/for-business/metrics-for-inventory-management-4827/)
