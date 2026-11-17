# StockSense AI — Product document

Version 1.0.0 · 18 Nov 2026 · Repository: <https://github.com/404-ntfd/stocksense-ai>

This document describes the product as built and tested. Where it differs from the build brief (`docs/BUILD_BRIEF.md`), it says so. Sections marked *(generated)* are filled in from the source code by `scripts/build-docs.ts`, so they always match the code.

## Contents

1. [Executive summary](#1-executive-summary)
2. [Problem, users and personas](#2-problem-users-and-personas)
3. [Feature list and user stories](#3-feature-list-and-user-stories)
4. [Functional specification per screen](#4-functional-specification-per-screen)
5. [Architecture](#5-architecture)
6. [Tech stack](#6-tech-stack)
7. [Data model](#7-data-model)
8. [AI design](#8-ai-design)
9. [Voice design](#9-voice-design)
10. [Analytics reference](#10-analytics-reference)
11. [Import specification](#11-import-specification)
12. [Security and privacy](#12-security-and-privacy)
13. [Performance and battery](#13-performance-and-battery)
14. [Test report summary](#14-test-report-summary)
15. [Build and release](#15-build-and-release)
16. [Install and user guide](#16-install-and-user-guide)
17. [Configuration and troubleshooting](#17-configuration-and-troubleshooting)
18. [Known issues and limitations](#18-known-issues-and-limitations)
19. [Roadmap](#19-roadmap)
20. [Decision log](#20-decision-log)
21. [Changelog](#21-changelog)

## 1. Executive summary

**What it is.** StockSense AI is an Android app, with an identical web app for Windows, that turns a small shop's spreadsheets into a live picture of sales, profit and stock, and answers questions about them by voice or text.

**Who it is for.** Owners and managers of small Indian retail and distribution businesses (kirana and general stores, hardware shops, small distributors) who keep their records in Excel, Tally exports or paper, and want answers without learning a reporting tool.

**What v1 does.**

- Imports CSV, XLSX, XLS and ODS files into products, sales, purchases, expenses, stock counts or any custom table, coping with title rows, merged headers, totals rows, Indian number and date formats, and undo.
- Shows a dashboard (revenue, gross and net profit, inventory value, low stock, dead stock, trends, top products, category mix) for today, 7 days, 30 days, this month or the financial year.
- Manages inventory: product list and detail, add/edit/archive, stock counts, damage and returns, with every change kept as an auditable stock movement.
- Answers questions: 25+ common questions instantly and offline; anything else through a cloud model (Groq, bring-your-own free key) that writes one read-only SQL query which the app checks, runs and charts. Numbers always come from the database, never from the model.
- Forecasts demand per product (Holt / Croston-SBA / moving average) and suggests what to reorder, with a confidence level.
- Voice: tap-to-talk or continuous dictation; Android's speech service, the browser's Web Speech API, or Whisper (Groq) as a fallback. Spoken changes ("received 24 Tata Salt") become confirmation cards; nothing is written until the user taps Confirm.

**Release.** v1.0.0: <https://github.com/404-ntfd/stocksense-ai/releases/tag/v1.0.0> (APK + web build). Web app: <https://404-ntfd.github.io/stocksense-ai/> once GitHub Pages is switched on (README, "two one-time settings").

**Quality in numbers.** 333 automated unit and integration tests and 15 end-to-end tests pass in CI; golden text-to-SQL eval {{EVAL_LLM}} with the model alone and {{EVAL_PIPELINE}} as shipped, with 0 unsafe queries executed; dashboard renders in 0.9 s on a 4× slowed CPU. The APK has **not** been tested on a physical phone yet.

![Dashboard](img/02-dashboard.jpg){width=260}

## 2. Problem, users and personas

Small shops already have data — a billing app's export, a stock register in Excel, purchase bills — but no time to analyse it. The questions they ask every morning are always the same: how much did I sell, am I making money, what is running out, what is not moving, and what should I order. Existing tools either need a laptop and training (Tally reports, Excel pivots) or a subscription and data upload to someone else's server.

| Persona | Context | Jobs to be done | What StockSense gives them |
| --- | --- | --- | --- |
| **Lakshmi, kirana owner** (Thrissur, 1 helper, ~150 SKUs, sells 600–1,200 lines a day) | Billing on a cheap Android phone app that exports Excel; Malayalam and English; little time between customers | Know yesterday's sales and profit; never run out of milk, sugar and Parle-G; see which items are dead money | Dashboard with change vs last period; low-stock list; voice questions while serving; reorder list she can send to a distributor on WhatsApp |
| **Ravi, hardware store manager** (500+ SKUs, slow and fast movers, credit customers) | Tally export each week; owner asks for numbers on the phone | Answer the owner's ad-hoc questions ("how much cement did we sell in October?"); find stuck stock; plan purchases before the season | Import of Tally/Excel exports with mapping; natural-language questions; dead-stock and ageing; ABC analysis |
| **Fathima, small distributor** (3 brands, 40 retailer customers, purchases by bill) | Purchase and sales registers in Excel; margin is thin | Track margin by brand/category; spot customers who buy most; see whether purchases match sales | Sales + purchases import, margin by category, top customers, custom tables for price lists, net profit after expenses |

## 3. Feature list and user stories

Status: **Shipped** = built and covered by automated tests; **Partial** = built, some parts not verified (usually needs a physical phone); **Deferred** = not in v1.

| Priority | Feature | User story | Status |
| --- | --- | --- | --- |
| Must | Signed APK in a GitHub Release + web/PWA build | As an owner I can install the app from a link | **Partial** — CI builds, signs and verifies the APK and attaches it to the release; not installed on a phone; signed with a temporary key until the signing secrets are added |
| Must | SQLite persistence, schema, views, backup/restore | My data is kept on my phone and I can back it up | **Shipped** |
| Must | Import CSV/XLSX into products, sales, purchases, expenses, custom tables with mapping, validation and undo | I can bring in my existing files without retyping | **Shipped** |
| Must | Demo data and onboarding | I can try the app before importing anything | **Shipped** (demo loads in 1.4 s at 4× throttle) |
| Must | Dashboard: 6 KPI cards, revenue trend, top products, low stock | I see how the shop is doing at a glance | **Shipped** (+ revenue vs profit and category mix charts) |
| Must | Inventory list, detail, add/edit, stock adjustment | I can keep stock right | **Shipped** |
| Must | Ask: typed and voice (tap-to-talk), text-to-SQL with guard, chart picker, grounded answer, Show SQL | I can ask questions in plain English | **Shipped** (voice: Partial — real microphones not tested; the controller and UI are tested with a mocked engine) |
| Must | Continuous dictation | I can speak a long instruction with pauses | **Partial** — state machine and UI tested (40 segments over 2+ minutes); real recognisers not tested |
| Must | Offline intent engine (top 25 questions) | Common questions work without internet or a key | **Shipped** (27 intents; 60/60 test phrases routed correctly) |
| Must | Settings: key, provider, model, voice, privacy mode | I control which AI is used and what leaves my phone | **Shipped** |
| Should | Forecasts, reorder list, days of cover | I know what to order and when things run out | **Shipped** |
| Should | Whisper voice mode | Voice works on phones without Google's speech service | **Partial** — built, not tested with a real microphone |
| Should | Write actions by voice with confirmation cards | I can record a sale or delivery by speaking | **Shipped** (sale, purchase, price, stock count, damage, expense) |
| Should | Insights: dead stock, ABC Pareto, revenue vs profit | I find stuck money and my key products | **Shipped** |
| Could | Read answers aloud (TTS) | I can listen while working | **Shipped** (speaker button and "read aloud" setting) |
| Could | Heatmap, expense charts, share answer, WhatsApp reorder share | Extra views and sharing | **Shipped** (share as text; "share as image" not built) |
| Could | Gemini provider | A second AI provider | **Partial** — selectable (OpenAI-compatible endpoint); not tested against Gemini (no key) |

Acceptance criteria AC1–AC14 and their results are in [TEST_REPORT.md §5](TEST_REPORT.md#5-acceptance-criteria-brief-123).

## 4. Functional specification per screen

Navigation: five tabs in a bottom bar on phones (Home, Inventory, the centre **Ask/mic** button, Data, More) and a side rail on wide screens. The Android back button closes an open sheet first, then goes back; on Home a second press within 2 s exits. Every screen has loading (skeletons), empty, error (plain language + retry) and offline states. Touch targets are at least 48 px; body text 16 px; KPI numbers 28 px; dark mode follows the system or a setting.

### 4.1 Onboarding (3 steps, skippable)
![Onboarding](img/01-onboarding.jpg){width=220}
- **Purpose:** first answer within 2 minutes.
- **Elements:** business name and type → data choice (*Try with demo data*, *Import my file*, *Start empty*) → optional API key with *Get a free key* link and **Test** (green tick with the number of models, or the provider's error in plain words).
- **States:** demo loading message; key test success/failure. "Later" skips the key; "Skip" on step 1 skips everything.

### 4.2 Home (dashboard)
![Dashboard charts](img/03-dashboard-charts.jpg){width=220}
- **Period chips:** Today, 7D, 30D, This month (month to date vs the same days last month), FY (April to date vs the same span last year). The range and "change is against the previous period" are written under the chips.
- **Six KPI cards:** Revenue (+ orders), Gross profit (+ margin %), Net profit (+ expenses), Inventory value (+ product count), Low stock (+ out-of-stock count), Dead stock value (+ % of inventory). Arrows show change vs the previous period, green when good. Tap a card to drill down (Ask, Inventory filtered to low stock, Insights); long-press or tap ⓘ to see how it is calculated.
- **Charts** (each with *View data*): daily revenue with a 7-day average; revenue bars + gross-profit line by month (one rupee axis); top 5 products (tap a bar to ask about it); category share donut (≤ 6 slices, the rest as Others).
- **Running low:** 5 most urgent products (out of stock first), *See all*. **Ask about this** chips.
- **Empty state:** "No data yet" with *Try with demo data* / *Import my file*.

### 4.3 Ask
![Answer](img/07-ask-answer.jpg){width=220} ![Listening](img/08-voice-listening.jpg){width=220} ![Confirm](img/09-confirm-card.jpg){width=220}
- **Elements:** chat thread; text box (Enter sends); the big centre button is the microphone on this screen (a separate mic button on wide screens); *Continuous dictation* toggle; suggestion chips when empty; banners for "no key" and "offline".
- **Live transcript:** "Listening", timer, level bar, final words in black and words still being recognised in grey; the transcript is editable before sending.
- **Answer card:** title + route badge (Offline / AI / Estimate), the headline sentence, *Did you mean …?* when a product name was fuzzy-matched, KPI tiles or a chart with a Chart/Table switch, assumptions ("No period given, so I used this month"), Show SQL, read aloud, copy, share, 👍/👎 (saved to the Q&A log), time taken, and follow-up chips.
- **Other cards:** clarify (question + tappable options), error (plain message + closest supported questions), confirmation (summary of the change, *Confirm* / *Cancel*, then "✓ Stock added").

### 4.4 Inventory and product detail
![Inventory](img/04-inventory.jpg){width=220} ![Product](img/05-product-detail.jpg){width=220}
- **List:** search (name, SKU, category), status chips (All, Low — includes out, Out, OK, Overstock), category filter, each row with stock, unit, status chip and days of cover, and an **Adjust** button. Floating **+** adds a product.
- **Detail:** stock, days of cover, price/cost/margin, last-90-days revenue, units and profit; negative stock in red with *Fix stock*; chart of the last 60 days of daily sales, the next 30 days' estimate (dashed) with the 80 % range and a red stock-out marker; next 7/30 days, run-out date and suggested order; confidence chip; full movement history; *Adjust stock*, *Ask about it*, edit, *Remove product* (archived if it has history, deleted otherwise, with Undo).
- **Adjust stock:** Count (set to counted quantity), Damage, Return in, Return out; shows the stock after saving.

### 4.5 Data
![Data](img/11-data.jpg){width=220} ![Mapping](img/12-import-mapping.jpg){width=220} ![Report](img/13-import-report.jpg){width=220}
- **Tables:** every base table and custom table with row counts → paged grid with search, sortable columns, CSV/XLSX export, edit/delete rows for sales, purchases and expenses (delete for custom tables).
- **Import wizard:** pick a file → choose a sheet (hidden/empty marked) → choose the target (the best guess is marked *Suggested*), header row, "day first" → match columns (confidence % per field) or pick columns and types for a custom table → check rows (good/problem counts, problems listed, warnings, first 20 rows as they will be saved) → choose Add / Update existing / Replace (Replace asks for confirmation) → progress bar with Cancel → report (imported, skipped, new products, warnings, *Download skipped rows*, *Undo import*, *Ask about this table*).
- **Import history** with Undo; **Add an entry** (sale, purchase or expense with product suggestions); **Backup** (one `.stocksense` file), **Restore** (with confirmation); **Export** of the main views; **Load demo data**, **Clear all data** (type DELETE to confirm).

### 4.6 Insights (from Home or More)
![Insights](img/10-insights.jpg){width=220}
Inventory turnover, days of inventory, sell-through, dead-stock value; **What to reorder** (stock, days of cover, run-out date, order quantity, supplier, confidence; *Share list* sends it as text, e.g. to WhatsApp); ABC Pareto; stock value by time since last sale; weekday × week heatmap; stock status by category; expenses by category and by month; dead-stock list. Tap any product to open it.

### 4.7 More (settings)
![Settings](img/14-settings.jpg){width=220}
AI (provider, key with Test/Remove, models, privacy mode, AI-written answers), Voice (engine, language, continuous dictation, auto-send delay, read aloud), Business (name, type, "day first" dates), Appearance (system/light/dark), Data link, Diagnostics (version, platform, eval score, data counts, recent questions with SQL, route, timing, errors and feedback), Labs (Hindi experimental, show welcome screens again). Every setting applies immediately.

### 4.8 Wide screens (Windows)
![Desktop](img/16-desktop.jpg){width=520}

## 5. Architecture

Three threads keep the UI smooth on cheap phones: the UI thread only renders; a **DB worker** owns SQLite, imports and KPI queries; an **analytics worker** runs forecasts. The only network calls are to the AI provider (questions the offline engine cannot answer, optional narration, Whisper audio).

```mermaid
flowchart LR
  subgraph Phone["Phone / browser (all data stays here)"]
    UI["UI thread<br/>React 19 + ECharts"]
    DBW["DB worker<br/>sql.js SQLite + importer + KPIs"]
    AW["Analytics worker<br/>forecasts"]
    IDB[("IndexedDB<br/>database bytes")]
    FS[("App storage (Android)<br/>second snapshot")]
    UI -- "Comlink RPC" --> DBW
    UI -- "Comlink RPC" --> AW
    DBW -- "save 0.4 s after a change,<br/>on pause" --> IDB
    UI -. "on pause" .-> FS
  end
  UI -- "question + schema + examples<br/>(HTTPS, BYOK)" --> LLM["Groq API<br/>gpt-oss-120b / 20b"]
  UI -. "Whisper mode audio" .-> STT["Groq Whisper"]
  UI -. "Android" .-> SR["Android SpeechRecognizer<br/>(on device or Google)"]
```

### 5.1 Module boundaries

| Module | Path | Interface |
| --- | --- | --- |
| DbClient | `src/core/db/client.ts` | Proxy over the worker exposing everything in `src/core/db/api.ts` (`query(sql, params, {readOnly, timeoutMs, maxRows})`, `exec`, `transaction`, `importRows`, `undoImport`, `schemaForLlm`, `snapshot`, `restore`, plus inventory, analytics, import-wizard and Q&A-log calls). AI-written queries go through `query(..., {readOnly: true})`, which has a 3 s timeout that restarts the worker. |
| DbEngine | `src/core/db/engine.ts` | Synchronous SQLite wrapper used by the worker and by tests/scripts in Node. |
| LlmProvider | `src/core/ai/types.ts`, `providers/openaiCompat.ts` | `complete(req)`, `listModels()`, `transcribe(audio)`; `completeWithRetry` adds backoff and model fallback. |
| SpeechEngine | `src/core/voice/controller.ts` | `available()`, `start({lang, continuous})`, `stop(): Promise<string>`, `on('partial'|'final'|'error'|'state'|'level')`; engines in `nativeEngine.ts`, `webSpeechEngine.ts`, `whisperEngine.ts`; `ScriptedEngine` for tests. |
| VoiceController | `src/core/voice/controller.ts` | Tap-to-talk and continuous state machine over any engine. |
| AskPipeline | `src/core/ask/pipeline.ts` | `ask({text, lang, history})` → async stream of `stage`, `sql`, `rows`, `chart`, `answer`, `action`, `clarify`, `error`. |
| Analytics | `src/core/analytics/` | `kpis.ts` (dashboard, insights, forecast storage), `forecast.ts`, `abc.ts`, `chartPicker.ts`. |
| Import | `src/core/import/` | `csvParser`, `xlsxParser`, `headerDetect`, `mapping`, `coerce`, `pipeline`; writes via `db/importer.ts`. |

### 5.2 Data flow of a question

```mermaid
sequenceDiagram
  participant U as User
  participant A as Ask screen
  participant P as AskPipeline
  participant I as Intent engine
  participant L as LLM (Groq)
  participant G as SQL guard
  participant D as DB worker
  U->>A: speaks / types
  A->>P: ask(text, history)
  P->>P: normalise transcript; write request? → confirmation card (stop)
  P->>I: match (offline, < 1 ms)
  alt confidence ≥ 0.85
    I-->>P: fixed SQL or tool
  else open question and a key is set and online
    P->>L: plan prompt (schema, dates, 6 examples, last 3 turns)
    L-->>P: JSON {intent, sql | tool | clarify}
    P->>G: guard(sql)
    G-->>P: ok / blocked → repair (max 2)
  end
  P->>D: query(sql, readOnly, 3 s)
  D-->>P: rows
  P->>P: chart picker (rules)
  opt AI narration on, privacy off
    P->>L: rows (≤ 50 / 4 KB) → 1–3 sentences
    P->>P: number grounding check, else template
  end
  P-->>A: answer card
```

## 6. Tech stack

{{STACK}}

## 7. Data model

Two layers: strict **base tables** (money in integer paise; stock only ever changes through `stock_movements`) and **AI-facing views** with friendly names and rupee amounts. Uploaded files either map into base tables or become custom `u_` tables.

```mermaid
erDiagram
  suppliers ||--o{ products : "usual supplier"
  suppliers ||--o{ purchases : supplies
  customers ||--o{ sales : buys
  products ||--o{ sales : "sold as"
  products ||--o{ purchases : "bought as"
  products ||--o{ stock_movements : "moves"
  products ||--o| _forecast : "estimated"
  sales ||--|| stock_movements : "trigger writes"
  purchases ||--|| stock_movements : "trigger writes"
  _import_batches ||--o{ sales : "import_batch"
  _import_batches ||--o{ _import_undo : "old values"
```

**Triggers:** inserting, updating or deleting a sale or purchase writes, updates or removes its own stock movement, so stock on hand is always `SUM(qty_delta)`.
**Indexes:** sales by date, by product+date, by invoice and by batch; purchases by product+date and batch; movements by product+date, by reference and by batch; expenses by date.
**Migrations policy:** `_schema_version` holds the version; `schema.sql` is idempotent; later versions append ordered `MIGRATIONS` in `engine.ts`; before migrating, a copy of the old database is kept in IndexedDB (`db-backup-v<N>`); a database from a newer app version is refused with a message. Views are dropped and recreated at every start, so view changes need no migration.

### 7.1 Base schema (`src/core/db/schema.sql`) *(generated)*

```sql
{{SCHEMA_SQL}}
```

### 7.2 AI-facing views *(generated from `src/core/db/semantic.ts`)*

{{VIEWS}}

Rules: revenue = qty × unit price − discount, excluding tax. COGS = qty × unit cost at the time of sale, falling back to the product's current cost. The financial year is April to March. Amounts are shown as ₹1,23,456 in cards and ₹1.2L in charts.

## 8. AI design

### 8.1 Routing

1. **Normalise** the transcript (spoken numbers → digits, "rupees" → ₹, kgs → kg); cap at 2,000 characters.
2. **Write requests** ("sold…", "received…", "set price of…", "spent… on…") never reach SQL. A regex parser (with an LLM field-extractor as fallback) builds a **confirmation card**; on *Confirm* the app runs its own parameterised insert/update.
3. **Offline intent engine** (`src/core/ai/intents/engine.ts`): pattern + slots (period, product, N, metric). If every meaningful word is explained the confidence is 0.93 and the question is answered locally; one unexplained word gives 0.8, more gives 0.6. Threshold 0.85. A follow-up such as "and last month?" is rewritten from the previous question first.
4. **LLM plan call** when a key is set and the device is online. Otherwise the closest offline answer (confidence ≥ 0.6, with a note) or the "add a key / you're offline" message with the closest supported questions.
5. **Tools** (forecast, reorder, ABC) are deterministic TypeScript over SQLite; the model only chooses them.

### 8.2 Offline intent catalogue *(generated)*

{{INTENTS}}

### 8.3 Plan prompt (system) — verbatim, `src/core/ai/prompts/plan.md` *(generated)*

The `{{SCHEMA}}` placeholder is replaced with one line per view and every column with its description (section 7.2).

```text
{{PLAN_PROMPT}}
```

The **user message** carries: the dates line (today, yesterday, this/last week, this/last month, this/last FY, last 7/30/90 days, this/last year — computed in code), a `<data>` block (business name, up to 15 distinct values per category-type column cut to 40 characters, up to 8 product names fuzzy-matched to the question, and custom tables with their columns), six few-shot examples retrieved by BM25 from `tests/eval/golden.json`, the last three turns (question, SQL, result shape) and the question.

**Output schema:** `{"intent":"sql|tool|clarify|unsupported","sql":"…","tool":{"name":"forecast|reorder|abc","args":{…}},"chart":{"type":"auto|line|bar|hbar|donut|scatter|table|kpi","x":"…","y":["…"]},"title":"…","assumptions":["…"],"clarify":null,"options":[]}`. Parsing tolerates code fences, prose around the JSON and bare SQL.

### 8.4 SQL guard (`src/core/ai/sqlGuard.ts`)

A tokenizer that understands strings, quoted identifiers (`"x"`, `` `x` ``, `[x]`) and comments, so keywords hidden in comments or strings are handled correctly. Rules:

- comments removed; exactly one statement (a single trailing `;` allowed); must start with `SELECT` or `WITH`;
- blocked keywords anywhere: INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, REPLACE (the `replace()` function is allowed), ATTACH, DETACH, PRAGMA, VACUUM, REINDEX, ANALYZE, BEGIN, COMMIT, ROLLBACK, SAVEPOINT, RELEASE, TRIGGER, …;
- blocked functions: `load_extension`, `readfile`, `writefile`, `zeroblob`, `randomblob`, `fts3_tokenizer`, `sqlite_*`, `pragma_*`;
- every table after FROM/JOIN/comma must be an allowed view or a registered `u_` table; CTE names may not shadow base or internal tables; schema-qualified names are rejected; only `json_each`, `json_tree`, `generate_series` table functions;
- if the outer query has no LIMIT it is wrapped as `SELECT * FROM (…) LIMIT 1000`.

Defence in depth inside the engine: the query is guarded again, run with `PRAGMA query_only = ON` inside a `SAVEPOINT` that is always rolled back, capped at 1,000 rows, and the client kills and restarts the worker if it runs longer than 3 s ("too heavy, try narrowing the period"). Blocked attempts are logged in `_qa_log`.

**Repair loop:** on a guard block, a SQLite error or unparsable output, the error and the SQL are sent back once more (two retries at most); then "I couldn't work that out" with three suggestions. An empty result says so plainly and suggests a broader period.

### 8.5 Narration and grounding

Model `openai/gpt-oss-20b`, JSON `{answer, followups}`, 1–3 sentences, given the question, the title and the result (≤ 50 rows and 4 KB, otherwise row count, column sums and the first 5 rows). Every number in the answer is extracted (including "₹3.8 lakh", "12k") and must equal a number in the result at the precision written; otherwise the text is discarded and a local template is used. Offline and tool answers always use templates. Prompt verbatim:

```text
{{NARRATE_PROMPT}}
```

### 8.6 What leaves the device

| Situation | Sent to the AI provider | Never sent |
| --- | --- | --- |
| Offline-engine answer, dashboard, inventory, imports | nothing | — |
| AI question (default) | the question, the static view descriptions, up to 15 distinct values of category-type columns, up to 8 product names, custom table/column names and descriptions (+ 5 sample values of category columns), 6 golden examples, the last 3 questions with their SQL and result shape | raw rows (except below), the API key in logs, backups |
| AI narration (on by default) | the result rows (≤ 50 rows / 4 KB) or a summary | other tables |
| **Privacy mode** | the question, view descriptions, custom table/column names and the examples only | any data value, any result row; narration is local |
| Whisper mode | the recorded audio chunks (only while the mic is visibly on) and the business name as a spelling hint | — |
| Native Android speech | handled by the phone's speech service (may use Google's servers unless offline packs are installed) | — |

### 8.7 Model and provider configuration

Defaults: provider Groq (`https://api.groq.com/openai/v1`), plan model `openai/gpt-oss-120b` (temperature 0, JSON mode, `reasoning_effort: low`, 1,200 max tokens, 20 s timeout), narration `openai/gpt-oss-20b`, fallback `qwen/qwen3.8-27b`, Whisper `whisper-large-v3-turbo`. Retries: 429/5xx back off 1 s then 3 s (or `retry-after`); a retired model (404) refreshes the model list and switches to the fallback; 401 is reported at once. Gemini is available through its OpenAI-compatible endpoint (`gemini-flash-latest`) but was not tested. All models can be changed in Settings → AI → Models.

## 9. Voice design

**Engines** (chosen automatically, or fixed in Settings → Voice): Android `SpeechRecognizer` via `@capgo/capacitor-speech-recognition` (partial results, beep muted in continuous mode); the Web Speech API in Chrome/Edge; **Whisper mode** — `MediaRecorder` audio cut at about 1 s of silence by an RMS voice-activity detector (30 s maximum per chunk, chunks with no speech dropped), each chunk sent to `/audio/transcriptions` with `language=en`, throttled to 15 chunks a minute. If the native engine is missing, Whisper is used automatically when a key is set.

**Continuous-mode state machine** (`VoiceController`):

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> listening: tap mic (continuous on)
  listening --> listening: partial / final (text appended)
  listening --> restarting: recogniser ends its session after a pause
  restarting --> listening: restart after 250 ms
  listening --> stopping: tap Stop or Send
  listening --> stopping: 60 s with no speech / 10 min total / 3 errors in 10 s / fatal error (permission)
  restarting --> stopping: same limits
  stopping --> idle: transcript kept, editable
```

Tap-to-talk: the utterance ends, and after the auto-send delay (1.2 s by default) the transcript is sent. The mic stops at once when the app is paused or hidden. Haptic tick on start/stop on Android.

**Normalisation:** "two hundred" → 200, "one lakh fifty thousand" → 150000, "2 lakh rupees" → ₹200000, kgs/kilos → kg, litres → l, "per cent" → %. Product names are fuzzy-matched (Jaro-Winkler + token overlap) and shown as *Did you mean …?*.

**Permissions:** `RECORD_AUDIO` is requested only on the first mic tap; if refused, typed input stays available and the message points to Android Settings → Apps → StockSense AI → Permissions. The manifest declares the `android.speech.RecognitionService` query (Android 11+ package visibility).

**Language roadmap:** v1 English (`en-IN` default, `en-US`); Settings → Labs → *Hindi (experimental)* adds `hi-IN` and sends the transcript to the AI unchanged (accuracy not measured). v1.1 Hindi/Hinglish with a Hindi golden set; v1.2 Malayalam and Tamil via a translate-to-English step.

## 10. Analytics reference

### 10.1 KPIs (all computed on the device)

| KPI | Formula | Where |
| --- | --- | --- |
| Revenue | Σ (qty × unit price − discount), tax excluded | Dashboard |
| Gross profit / margin % | Revenue − COGS; GP ÷ revenue × 100 (– when revenue is 0) | Dashboard |
| Net profit | Gross profit − Σ expenses | Dashboard |
| Orders / average order value | distinct invoice numbers (rows without one count separately); revenue ÷ orders | Dashboard |
| Inventory value | Σ max(stock, 0) × cost price | Dashboard, Inventory |
| Low / out of stock | stock ≤ reorder level; stock ≤ 0 | Dashboard, Inventory |
| Overstock | reorder level > 0 and stock > 5 × reorder level | Inventory |
| Days of cover | stock ÷ average daily units sold over the last 28 days | Inventory, Insights |
| Inventory turnover | COGS over the last 365 days (annualised if less history) ÷ average inventory at cost (start and end of the period) | Insights |
| Days of inventory | 365 ÷ turnover | Insights |
| Sell-through % | units sold in 90 days ÷ (stock 90 days ago + units received since) × 100 | Insights |
| Dead stock value / % | stock value of products in stock with no sale for 90+ days ÷ inventory value | Dashboard, Insights |
| ABC class | products by revenue over 90 days; A = first 80 % of cumulative revenue, B = next 15 %, C = rest | Insights |
| Reorder point | average daily demand × lead time + safety stock | Insights |
| Safety stock | 1.65 × σ(daily demand, last 56 days) × √lead time (95 % service) | Insights |
| Suggested order | max(0, ⌈forecast demand over lead time + 14 days + safety stock − max(stock, 0)⌉) | Reorder list |
| Growth | (this period − previous period) ÷ \|previous period\| | KPI arrows |

### 10.2 Forecasting (`src/core/analytics/forecast.ts`)

Daily units per product, zero-filled from its first sale to today. **Method:** ≥ 56 days and < 50 % zero days → Holt's linear smoothing on weekly totals (α, β grid-searched on the one-step errors of the last 4 weeks; trend capped at 2× the best recent week), spread over days with a day-of-week index from the last 8 weeks; ≥ 50 % zero days → Croston with the Syntetos-Boylan correction; < 28 days or 28–55 dense days → 14-day moving average; no sales in 60 days → zero. **Backtest:** hold out the last 14 days, WAPE on the two weekly totals; confidence high < 25 %, medium 25–50 %, low > 50 % or < 28 days of history. **Outputs** (table `_forecast`, view `v_forecast`): 7- and 30-day demand, 80 % band (± 1.28 σ √30), days of cover, run-out date (within 180 days), reorder point, safety stock, suggested order. Recomputed in the analytics worker only when data changed or the date rolled over. Always worded as "an estimate based on your past sales".

### 10.3 Chart catalogue

| Question | Chart | Where |
| --- | --- | --- |
| Are sales going up? | line, daily revenue + 7-day average | Home |
| Am I making money? | revenue bars + gross-profit line on one rupee axis, by month | Home |
| Where does revenue come from? | donut, ≤ 6 slices | Home |
| What sells best? | horizontal bars, top 5 | Home, Ask |
| Which few items matter most? | Pareto (cumulative %) with A/B/C bands | Insights |
| Is my stock healthy? | stacked bars per category: out/low/ok/overstock | Insights |
| What is stuck? | bars, stock value by days since last sale (0–30, 31–60, 61–90, 90+, never) | Insights |
| Which days are busy? | heatmap weekday × week, 12 weeks | Insights |
| Where does money go? | donut by expense category; stacked bars by month | Insights |
| When will it run out? | history (solid) + estimate (dashed) + 80 % band + run-out marker | Product, Ask |

**Ask chart picker** (deterministic, model hint optional): one row → KPI tiles; date/month column → line (7-day average beyond 30 points); category column → bar, horizontal if labels > 12 characters or > 8 bars; > 12 categories → top 10 + Others; share of a whole with ≤ 6 parts (and a "by/breakdown" question) → donut; two numeric columns → scatter; otherwise table. Every answer has a Table tab and Show SQL. Colours: one teal accent and neutrals; the categorical palette is the validated colour-blind-safe reference palette; status colours are reserved for stock state; no dual axes; animation off.

## 11. Import specification

**Formats:** CSV/TSV/TXT (UTF-8 with or without BOM, UTF-16 LE/BE, windows-1252 fallback when UTF-8 decoding produces replacement characters; delimiter auto-detected among `,` `;` tab `|`), XLSX, XLSM, XLS (BIFF8), ODS. Rejected with a message: files over 50 MB, empty files, PDF/Word/images/ZIP/JSON/Numbers, password-protected workbooks. A warning appears above 300,000 rows.

**Header detection** (`headerDetect.ts`): the first 15 rows are scored by text-cell ratio, uniqueness, width, known header words and whether numbers/dates follow; lone title cells are penalised. A two-row group header ("Stock" over "Qty | Value") is joined ("Stock Qty"). Trailing empty columns are dropped and duplicates renamed (`Qty`, `Qty_2`). The user can pick another header row.

**Skipped rows:** blank rows, totals rows (first non-empty cell starts with Total/Grand Total/Sub Total/Net Total/Page Total) and repeated header rows.

**Target suggestion:** each target's mapping score (required fields count double) minus penalties for missing required fields, plus hints from the headers (invoice/customer → sales, supplier/GRN → purchases, expense/narration → expenses, counted/physical → stock count, no date column → products) and from the file name. Below a threshold the wizard suggests a custom table.

### 11.1 Mapping dictionary *(generated from `src/core/import/mapping.ts`)*

{{SYNONYMS}}

Matching: exact synonym 1.0; same without spaces 0.97; synonym inside a multi-word header 0.70–0.88; all words present 0.84; Jaro-Winkler ≥ 0.93 0.78; assignment is greedy best-first so each column feeds one field. Unmapped columns are kept as JSON in an `extra` column.

### 11.2 Coercion rules (`coerce.ts`)

- **Numbers:** strips ₹ / Rs / INR, commas and spaces (Indian grouping), `/-`; `(123)` and `123-` are negative; `1.2L`, `2 lakh`, `1.5 cr`, `12k`; `12%` → 12 with a warning; `-`, `NA`, `N/A`, `nil`, `—` → empty; Excel errors → empty with a warning.
- **Dates:** Excel serials (with the 1900 phantom 29 Feb and the 1904 system), `dd/mm/yyyy`, `dd-mm-yy`, `yyyy-mm-dd`, `yyyymmdd`, `17-Nov-26`, `17 November 2026`, `Nov 17, 2026`, ordinals, weekday prefixes, a time part. `03/04/2026` follows "day first" (default on) and is counted in an "ambiguous dates" warning; impossible dates (31/02) are row errors.
- **Text:** trimmed, inner spaces (incl. non-breaking) collapsed. **SKUs** stay text (leading zeros kept); scientific-notation barcodes are expanded with a warning. **Units:** kgs → kg, litres → l, nos/pieces → pcs, packets → pkt, …
- **Custom tables:** names `u_<slug>`; column names snake_case ASCII (₹ → rs, % → pct, leading digit → `c_`), quoted everywhere so reserved words work; types inferred per column (DATE if ≥ 90 % parse as dates, INTEGER/REAL if ≥ 95 % numeric unless it looks like an ID, else TEXT); semantic type (money/qty/number/category/id/text/date) and a one-line description stored in `_meta_columns`.

### 11.3 Row error codes

| Code | Meaning |
| --- | --- |
| `BAD_DATE` | a date cell could not be read |
| `BAD_NUMBER` | a number cell could not be read |
| `MISSING_<FIELD>` | a required field is empty (e.g. `MISSING_DATE`, `MISSING_QTY`) |
| `NO_PRODUCT` | a sales/purchase/count row has neither a product name nor a SKU |
| `BAD_QTY` | quantity is zero (sales) or not positive (purchases) |
| `NEGATIVE_PRICE` | a negative price or cost |
| `DUPLICATE_SKU` | append mode and the product already exists (use Update existing) |
| `UNKNOWN_PRODUCT` | stock count for a product that is not in the list |
| `DB_ERROR` | SQLite refused the row (shown with its message) |

### 11.4 Modes, undo and recovery

**Append** adds rows; **Update existing** matches products by SKU (or by name when there is no SKU column) and sales/purchases by invoice/bill number + product, saving the old values; **Replace** empties the target first (products with history are archived, not deleted) after a confirmation. Each 2,000-row chunk is one transaction; the UI yields between chunks and can cancel (everything written so far is removed). Every row carries `import_batch`; **Undo** deletes the batch's rows and the stock movements they caused, restores values an update changed, removes products/customers/suppliers it created unless later data uses them, and drops an empty custom table. An import still marked "running" when the app restarts is rolled back automatically. Sales of unknown products create them (counted in the report); negative quantities are recorded as returns.

## 12. Security and privacy

- **Key storage:** Android — Keystore-backed `@aparajita/capacitor-secure-storage`; web — the browser profile's localStorage (browsers have no keystore). The key is never written to the database, backups, exports, the Q&A log or the console. Android auto-backup excludes shared preferences (`backup_rules.xml`, `data_extraction_rules.xml`). No key is built into the app or the repository.
- **Data at rest:** the SQLite file lives in the app's IndexedDB (and, on Android, a second copy in the app's private storage). It is not encrypted beyond Android's own file-based encryption. Backups are plain SQLite files the user saves where they choose.
- **Network:** only HTTPS to the configured AI provider, and only when a question needs it (section 8.6). No analytics, no tracking, no server of ours. The PWA service worker caches the app's own files.
- **Threat model:**

| Threat | Mitigation |
| --- | --- |
| Model writes or destroys data (SQL injection by the model, or a prompt injection that makes it try) | read-only by construction: guard (single SELECT, allow-listed views), `query_only`, rolled-back savepoint, writes only through app code after a tap |
| Prompt injection hidden in imported data ("ignore previous instructions…") | data values only appear inside `<data>` tags in the user message, are cut to 40 characters, and the system prompt says to treat them as data; even a successful injection can only produce a guarded SELECT; tested in unit, integration and E2E tests |
| Exfiltration through the model (e.g. a query that reads internal tables) | internal tables (`_settings`, `_qa_log`, `_meta_*`, base tables) are not on the allow-list; the key is not in the database |
| Resource exhaustion (cross join over 300k rows) | 1,000-row cap and a 3 s timeout that restarts the worker |
| Malicious spreadsheet | parsed in a worker by SheetJS 0.20.3 (the npm 0.18.5 build with known vulnerabilities is not used); 50 MB limit |
| Lost phone | data is local; Android's lock screen and file encryption protect it; no remote wipe in v1 |

- **Known gaps:** the web build keeps the key in localStorage (any script on the same origin could read it; the app loads no third-party scripts); backups are not encrypted; there is no app lock/PIN.

## 13. Performance and battery

Measured numbers (CPU throttled ×4, production build) are in [TEST_REPORT.md §4](TEST_REPORT.md#4-performance-section-123): cold start 0.76 s, demo load 1.39 s, dashboard 0.90 s, offline answer 0.32 s, AI answers 0.8–1.9 s, 10k-row import 2–3 s.

Design measures: nothing runs in the background (no polling, timers or wake locks); KPIs are cached in `_kpi_cache` and recomputed only after a data change; forecasts run in their own worker and only when the data version or the date changes; the database is saved 0.4 s after a change and on pause, not on a timer; charts render once with animation off and resize on demand; imports run in 2,000-row chunks in the worker, yielding between chunks; the mic is on only while visibly listening and stops on pause/hide, after 60 s of silence or 10 minutes; Whisper uploads only chunks that contain speech. Bundle: one 1.2 MB JS file (385 KB gzipped) + 690 KB SQLite WASM, all local in the APK. APK ≈ 4 MB.

## 14. Test report summary

| Layer | Count | Result |
| --- | --- | --- |
| Unit (Vitest) | 282 | all pass |
| Integration (Vitest + sql.js) | 51 | all pass; every fixture imports as expected |
| Line coverage of `src/core` | — | 84.4 % |
| E2E (Playwright, Pixel 7) | 15 | all pass |
| Golden eval (60 questions, real Groq) | — | {{EVAL_LLM}} LLM-only, {{EVAL_PIPELINE}} as shipped, 0 unsafe SQL executed |
| Physical device test | — | not run |

Failure analysis of the eval, acceptance criteria AC1–AC14 and the section-11 edge-case checklist: [TEST_REPORT.md](TEST_REPORT.md).

## 15. Build and release

**Local setup — Windows:** install Node.js 22 LTS and Git; `git clone https://github.com/404-ntfd/stocksense-ai.git`, `cd stocksense-ai`, `npm ci`, `npm run dev` (or `npm run build` then `npm run preview`). For a local APK: Android Studio (Otter or newer) with JDK 21 and SDK 36, then `npm run android:debug` (or open the `android/` folder in Android Studio).
**Local setup — Linux/macOS:** the same; for APKs set `ANDROID_HOME` to the SDK and run `npm run android:debug`.

**CI** (`.github/workflows/`):
- `web.yml` (every push): `npm ci` → typecheck → unit + integration tests → build → Playwright E2E → publish `dist/` to the `gh-pages` branch.
- `android.yml` (every push, `v*` tags, or manual run with a `release_tag`): tests → web build with the version → `cap sync` → `assembleRelease assembleDebug` → **verify** (`apksigner verify`, minSdk 24, targetSdk 36, size < 30 MB) → upload artifacts → on a tag, create the GitHub Release with `StockSense-AI-vX.Y.Z.apk`, the zipped web build and `apk-verify.txt`.

**Signing:** a 2048-bit RSA keystore (alias `stocksense`, 10,000 days) was generated for this project and handed over privately (never committed; `*.jks` is git-ignored). CI uses it when the four secrets `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` exist; otherwise it signs with a throwaway key generated for that run and says so in the release notes. Keep the keystore safe: without it, future versions cannot be installed over the existing app.

**Versioning:** `versionName` comes from the tag (`v1.0.0` → 1.0.0); `versionCode` is the CI run number, so it always increases.

**Cutting a release:** Actions → *Android APK* → *Run workflow* → branch → `release_tag` = `v1.0.1` (or push a tag `v1.0.1`). Tags with a hyphen (`-rc1`) are marked pre-release.

## 16. Install and user guide

### 16.1 Android
1. On the phone, open <https://github.com/404-ntfd/stocksense-ai/releases/latest> in Chrome and download `StockSense-AI-v1.0.0.apk`.
2. Tap the download. If asked, allow **Install unknown apps** for Chrome.
3. If Play Protect says the developer is unknown: **More details → Install anyway**. (The app is not on the Play Store yet.)
4. Open StockSense AI → **Try with demo data** (or import your file) → optionally paste your Groq key and tap **Test**.
If an earlier StockSense build is installed and the new APK will not install, uninstall the old one first (different signing keys).

### 16.2 Windows
See the README's 1-minute quick start (`npm ci`, `npm run build`, `npm run preview`, open <http://localhost:4173>), or open the GitHub Pages URL in Edge/Chrome and choose **Install app**. Voice uses the browser's speech recognition (needs internet) or Whisper mode.

### 16.3 Getting a free Groq key
Sign in at <https://console.groq.com> → **API Keys** → **Create API key** → copy it → in StockSense: **More → AI → API key → paste → Test**. The key stays on your device.

### 16.4 Questions to try
Offline (no key needed): *Total sales this month* · *What were my total sales last month?* · *Top 5 products last month* · *Top 10 products by units this month* · *Show low stock items* · *Out of stock items* · *What should I reorder?* · *When will Sugar 1kg run out?* · *Stock of Parle-G Biscuit 100g* · *Profit this month* · *Net profit last month* · *Margin by category* · *Sales by category this month* · *Show dead stock* · *Expenses by category* · *Compare this month vs last month* · *Which day is busiest?* · *Inventory value* · *ABC analysis* · *How are we doing?*
With a key: *Which supplier did we spend the most with in October?* · *What share of revenue came from walk-in customers this month?* · *Which category grew the most last month compared to the month before?* · follow-ups like *and the month before?*
Changes (you will be asked to confirm): *Sold 2 Sugar 1kg at 46* · *Received 24 Tata Salt 1kg at 21 from Guruvayur Sugar Depot* · *Set price of Maggi Noodles 70g to 15* · *Set stock of Sugar 5kg to 12* · *Damaged 2 Eggs (tray of 30)* · *Spent 500 on transport*.

### 16.5 Importing your own files
**Data → Import a file** → pick the file → check the suggested type (Products, Sales, Purchases, Expenses, Stock count, or New custom table) → check each column match → **Check rows** → read the problems list → choose how to add rows → **Import**. If something looks wrong, tap **Undo import**. Try `samples/demo_sales.xlsx` and `samples/demo_stock.csv` from the repository.

### 16.6 Device test script (15 minutes)
1. Install the release APK, accept the Play Protect prompt, open the app (note how long it takes).
2. Onboarding: demo data; paste the Groq key; Test shows a green tick.
3. Home: numbers shown? Charts respond to taps? Rotate once.
4. Ask by voice: "total sales this month", "top five products by profit last month", "which items are running low", "when will sugar run out" — time and correctness of each.
5. Continuous mode on: speak for a minute with pauses, then Send.
6. Airplane mode: ask "low stock items", open Inventory; airplane mode off.
7. Data: import `samples/demo_sales.xlsx` (download it from GitHub first), check the report, Undo.
8. Inventory: add a product, adjust its stock, search for it.
9. Force-stop the app in Android settings, reopen, check the product is still there.
10. Note the phone model and Android version, pass/fail per step, screenshots of failures.

## 17. Configuration and troubleshooting

### 17.1 Settings reference

| Setting | Default | Effect |
| --- | --- | --- |
| Provider | Groq | OpenAI-compatible endpoint used for questions and Whisper |
| API key | none | stored on the device; Test lists the provider's models |
| Question → SQL model | `openai/gpt-oss-120b` | plan call |
| Answer-writing model | `openai/gpt-oss-20b` | narration |
| Fallback model | `qwen/qwen3.8-27b` | used when the main model is retired |
| Whisper model | `whisper-large-v3-turbo` | Whisper voice mode |
| Privacy mode | off | never send data values or results |
| AI-written answers | on | narration by the model (grounded) instead of templates |
| Speech engine | Auto | native (Android) / browser / Whisper |
| Language | English (India) | recogniser language; Hindi under Labs |
| Continuous dictation | off | mic stays on across pauses until Send |
| Auto-send after a pause | 1.2 s | tap-to-talk only |
| Read answers aloud | off | text-to-speech after each answer |
| Business name / type | — | dashboard title, prompt context |
| Dates are day first | on | how ambiguous import dates are read |
| Theme | System | light / dark |

### 17.2 The 15 most likely problems

| # | Problem | Fix |
| --- | --- | --- |
| 1 | "App not installed" on Android | Uninstall the older StockSense build (different signing key), then install again; make sure there is free space |
| 2 | Play Protect blocks the install | More details → Install anyway (the app is not on the Play Store yet) |
| 3 | "Add a free Groq key…" on every open question | More → AI → paste the key → Test; the green tick confirms it |
| 4 | "The API key was rejected" | Copy the key again from console.groq.com (no spaces); create a new one if it was deleted |
| 5 | "The AI is busy" | Free-tier rate limit; wait a minute, or switch provider in Settings; common questions still work offline |
| 6 | "You're offline" | Check the connection; dashboard, inventory and common questions keep working |
| 7 | Microphone does nothing on Android | Allow the microphone (Android Settings → Apps → StockSense AI → Permissions); update the Google app and "Speech Services by Google"; or choose Whisper mode |
| 8 | Voice fails without internet | Download offline English in Google settings (Voice → Offline speech recognition), or type |
| 9 | Voice does not work on Windows | Use Chrome or Edge and allow the microphone for the site; Firefox has no speech recognition — use Whisper mode |
| 10 | Import picked the wrong type or columns | Choose the type yourself and change the column matches; pick another header row if the names look wrong |
| 11 | Dates imported wrongly (month and day swapped) | Undo the import, switch "Dates are day first" in the wizard, import again |
| 12 | "This file is password-protected" | Remove the password in Excel (File → Info → Protect Workbook) or save a copy as .csv |
| 13 | Numbers look doubled after importing the same file twice | Undo the second import in Data → Import history; use "Update existing" for re-imports |
| 14 | "That question is too heavy" | Ask for a shorter period or fewer products |
| 15 | Web app shows an old version | Close all its tabs and open it again (the service worker updates in the background), or clear site data |

## 18. Known issues and limitations

1. **Not tested on a physical Android phone.** The APK is built, signed and verified by CI and the same web code passes all tests in Chromium, but native voice, the Android back button, secure storage, file sharing, edge-to-edge insets and real-device performance and battery have not been exercised.
2. **APK signing:** v1.0.0 is signed with a temporary CI key because the build session could not write GitHub Actions secrets. After adding the four signing secrets, cut a new version; it will not install over v1.0.0 without uninstalling first (data can be carried over with Data → Save backup / Restore).
3. **GitHub Pages** must be switched on once in the repository settings before the web URL works.
4. Gemini provider is selectable but untested.
5. Low-confidence speech alternatives are not shown; the user edits the transcript instead.
6. "Ask AI to map" columns and LLM-written custom-column descriptions were not built (local inference is used).
7. Share answer as image was not built (share as text works).
8. `.numbers` files are not supported.
9. Web builds keep the API key in the browser's localStorage; backups are not encrypted; there is no app PIN.
10. The 3 s query timeout restarts the database worker; this path is not covered by an automated test.
11. Replace-mode imports delete rows that Undo cannot restore (the confirmation says so).
12. Hindi is experimental and unmeasured.
13. Eval question p06 shows the model can read "last 6 months" as including the current partial month.
14. Stock values use today's cost price for past dates (turnover and ageing); there is no FIFO costing.
15. Taxes are stored but there are no GST reports.

## 19. Roadmap

| Version | Scope | Effort |
| --- | --- | --- |
| **v1.0.x** (days) | Device test fixes; permanent signing key; Pages on; Gemini tested | 1–3 days |
| **v1.1** (1–2 weeks) | Hindi and Hinglish with a Hindi golden set; barcode scanning (ML Kit); GST fields and tax reports; multiple stores; native SQLite plugin for very large datasets; optional key proxy (Cloudflare Worker) so users need no key; share as image; app PIN | 1–2 weeks |
| **v1.2** (3–4 weeks) | Malayalam and Tamil (transcribe → translate → SQL); morning summary notification; supplier purchase orders as PDF; Tally and Vyapar import presets; LLM-assisted column mapping | 3–4 weeks |
| **v2** (6–10 weeks) | On-device model (Gemini Nano where available, otherwise llama.cpp with a fine-tuned Qwen2.5-Coder-3B) once it scores ≥ 90 % on the golden set; on-device Whisper; cloud sync and multi-user roles; Play Store release | 6–10 weeks |

## 20. Decision log *(generated from `docs/DECISIONS.md`)*

{{DECISIONS}}

## 21. Changelog

- **v1.0.0** (18 Nov 2026) — first release: everything in section 3 marked Shipped or Partial; docs, test report and screenshots.
- **v1.0.0-rc1** (18 Nov 2026) — release candidate built by CI for device testing.
- **v0.1.0-skeleton** (17 Nov 2026) — five-tab shell; proved the CI build, signing, verification and release path (Gate G1).
