# StockSense AI — Test report

Build: v1.0.0 · date of the runs: 17 Nov 2026 (IST) · all automated layers run in CI on every push (`.github/workflows/web.yml`, `.github/workflows/android.yml`).

## 1. Summary

| Layer | Tool | Result | Target (brief 12.1) |
| --- | --- | --- | --- |
| Unit | Vitest | **282 tests, all pass** (7 files) | ≥ 150, all green |
| Integration | Vitest + sql.js in Node | **51 tests, all pass** (2 files) | all fixtures pass |
| Coverage of `src/core` | `@vitest/coverage-v8` | **84.4 % lines**, 80.1 % statements, 67.7 % branches | ≥ 80 % lines |
| E2E | Playwright, Pixel 7 viewport, Chromium | **15 specs, all pass** (14 functional + 1 performance) | 12 Must-story specs |
| LLM eval (golden set, 60 questions) | `scripts/run-eval.ts`, real Groq `openai/gpt-oss-120b` | see section 3 | ≥ 85 % at release, 0 unsafe SQL |
| Performance | Playwright, CPU throttled ×4 | all budgets met (section 4) | section 12.3 |
| APK checks | CI: `apksigner verify`, `aapt2 dump badging`, size | signature verifies, minSdk 24, targetSdk 36, ~4 MB | signed, < 30 MB |
| Physical phone | — | **not tested** (no device available to the build) | Joe's 15-minute script |

Run them yourself: `npm test`, `npm run test:coverage`, `npm run build && npm run test:e2e`, `GROQ_API_KEY=… npm run eval`.

## 2. What the tests cover

**Unit (282):** SQL guard (70 accept/block cases including comment tricks, quoted identifiers, CTE shadowing, `load_extension`, `pragma_*` functions, schema-qualified names, multi-statement, UNION into internal tables); money and date utilities (Indian grouping, lakh/crore, FY boundary 31 Mar/1 Apr, leap day 2028, week starts Monday); number/date/SKU coercion (53 cases: `₹1,23,456.50`, `Rs. 500`, `1.2L`, `(250)`, `250-`, `NA`, `#DIV/0!`, Excel serials with the 1900 leap-year bug and the 1904 system, `17-Nov-26`, ambiguous `03/04/2026`, scientific-notation barcodes, leading zeros); identifier cleaning (spaces, dots, ₹, %, emoji, digits first, reserved words); offline intent engine (60 phrases, 100 % routed correctly, ≥ 95 % with confidence ≥ 0.85, every generated SQL passes the guard); period parsing (15 phrases + month/year edges); Holt, Croston/SBA, moving average, backtest/WAPE confidence, reorder maths, 500 SKUs × 548 days < 2 s; ABC; chart picker rules; result formatting; eval comparator; number grounding (accepts ₹3.83 lakh for 383449.45, rejects invented numbers and percentages); plan JSON parsing (fences, prose, bare SQL, bad tool names); prompt-injection isolation (data only inside `<data>` tags, never in the system prompt); privacy mode (no values sent); provider retry (429/5xx backoff, retired model → fallback, 401 not retried); transcript normalisation ("two hundred" → 200, "one lakh" → 100000, kgs → kg); write-action parsing (sale, purchase, price, count, damage, expense, ambiguous product, delete refused); follow-up rewriting; voice controller state machine (tap-to-talk auto-send, continuous restarts, 40 segments over 2+ minutes with no loss, 60 s silence stop, 10 min cap, error back-off after 3 errors in 10 s, fatal permission error, pending partial kept on stop).

**Integration (51):** every fixture in `tests/fixtures/` imported through the same API the worker exposes (parse → analyse → preview → run), then row counts, values, warnings and undo checked; 10,000-row XLSX import + undo; cancel mid-import; crash recovery of a half-finished import; upsert de-duplication and duplicate-file warning; undo restoring values changed by an upsert; replace; custom `u_` tables queryable with a reserved-word column; KPIs compared with raw SQL on the base tables; dashboard on demo data in < 1 s; empty-database ratios are NULL not NaN; Ask pipeline with a scripted LLM (write attempt blocked then repaired, two-retry repair loop, invalid JSON, multi-statement/PRAGMA/ATTACH never executed, clarify, unsupported, rate limit falls back to offline, invalid key, ungrounded narration discarded, grounded narration kept, privacy mode sends nothing, forecast tool, write requests produce a card and change nothing, 2,000-character cap); backup round trip; non-backup files rejected; newer-schema database refused; API key never in a backup; archive-instead-of-delete; negative stock.

**E2E (15, `tests/e2e/`):** onboarding → demo data → dashboard with 6 KPI cards and 4 charts and a "View data" table; all tabs + persistence across reload; typed questions with KPI, chart, table tab and Show SQL; forecast question; no-key message; offline mode (network blocked) with dashboard, inventory and offline answers; voice tap-to-talk through a mocked SpeechEngine; continuous dictation across three segments, nothing sent until Send; voice write → confirmation card, stock unchanged until Confirm; XLSX import of `samples/demo_sales.xlsx` (title row + totals row) → report (1,500 rows) → undo; custom CSV → `u_` table listed; product add → damage adjustment → search → reload; settings (privacy toggle, dark theme, key test validation, eval score shown); insights (reorder list, 10 dead-stock items); prompt-injection text in an imported cell has no effect.

## 3. Golden eval

60 hand-written questions with gold SQL in `tests/eval/golden.json` (totals 10, top/bottom N 8, categories 6, stock 8, profit/margin 8, comparisons 6, forecast/reorder/ABC tools 6, follow-ups and ambiguity 8). Pass = the result set matches the gold result (order-insensitive, 0.5 % numeric tolerance); tool questions must pick the right tool and product; ambiguity questions must clarify or refuse as listed. Few-shot examples are retrieved leave-one-out, so the model never sees the question being scored.

| Mode | Score | Unsafe SQL executed | Notes |
| --- | --- | --- | --- |
| LLM only (every question to `openai/gpt-oss-120b`) | **59 / 60 = 98.3 %** | 0 | measures text-to-SQL quality |
| As shipped (offline intent engine first, AI for the rest) | **59 / 60 = 98.3 %** | 0 | 27 answered offline in ~25 ms, 24 by the AI, 6 by tools, 3 clarify/refuse |

Failure analysis: **p06** "Gross profit by month for the last 6 months" — the model included the current partial month and six months before it (May–Nov), the gold uses the six calendar months ending this month (Jun–Nov). Both readings are defensible; the answer card shows the month list and the SQL, so the user can see which was used.

Latency (real Groq, demo data, 17 Nov 2026): AI answers including the narration call took **0.8–1.9 s** end to end; offline answers 20–50 ms. The eval's own average (9.9 s) includes deliberate pauses to stay under the free tier's 8,000 tokens/minute.

The score is shown in the app under **More → Diagnostics** (read from `src/core/ai/evalScore.json`, written by the eval script).

## 4. Performance (section 12.3)

Measured by `tests/e2e/perf.spec.ts` on the production build, Chromium with the CPU slowed down 4× (a mid-range phone), Pixel 7 viewport:

| Measure | Result | Budget |
| --- | --- | --- |
| Cold start to onboarding | 0.76 s | < 3 s (AC1) |
| Demo data load (150 products, ~39,000 sale lines, 18 months) | 1.39 s | < 3 s |
| Dashboard: 6 KPI cards + 4 charts | 0.90 s | < 1 s (AC2) |
| Offline answer ("top 5 products last month") | 0.32 s | — |
| Inventory list | 0.23 s | — |
| 10,000-row XLSX sales import (Node, no throttle) | ~2–3 s | < 15 s (AC3) |
| Forecast of all 150 SKUs × 548 days | ~30 ms (Node) | 500 SKUs < 2 s |

Idle CPU: nothing runs on a timer while the app is open and idle (no polling; the only timers are the 0.4 s save debounce after a change and the 1.5 s deferred forecast check at start-up). Battery use on a real phone was not measured (AC11 needs a device).

## 5. Acceptance criteria (brief 12.3)

| AC | Result | Evidence |
| --- | --- | --- |
| AC1 APK installs on Android 10+ and opens in < 3 s | **Partly verified**: APK builds, signature verifies, minSdk 24/targetSdk 36; web cold start 0.76 s at 4× throttle. Not installed on a phone. | CI `apk-verify.txt`, perf spec |
| AC2 demo data, 6 correct KPI cards and 4 charts in < 1 s | **Pass** | perf spec 0.90 s; KPI integration test vs raw SQL |
| AC3 10k-row XLSX in < 15 s with report and undo | **Pass** | integration "performance (AC3)" |
| AC4 custom CSV becomes a `u_` table that can be queried | **Pass** (queried through the guarded path; by voice needs a key) | integration + E2E |
| AC5 voice "total sales last month" → ₹ figure, chart, sentence in < 5 s | **Pass on the web with a mocked mic**; offline answer 0.3 s, AI answers 0.8–1.9 s. Real microphone not tested. | E2E voice spec |
| AC6 continuous dictation ≥ 2 min across pauses, no lost segments | **Pass in the state machine** (40 segments over 2+ min) and E2E with the mock; real recogniser not tested | voice unit tests |
| AC7 airplane mode: dashboard, inventory, top questions work | **Pass** (network blocked in Playwright) | E2E offline spec |
| AC8 no LLM output can modify data | **Pass** | 70 guard cases, engine query_only + savepoint test, pipeline tests, E2E injection |
| AC9 forecasts and reorder suggestions with a confidence chip | **Pass** | insights E2E, forecast tests |
| AC10 data survives restart; backup/restore round-trips | **Pass on the web** (reload E2E, backup round trip). Force-stop/reboot/app update on Android not tested. | E2E + integration |
| AC11 idle CPU ≈ 0 %, no background mic | **By design**; mic stops on `pause`/hidden; not measured on a phone | code review |
| AC12 web build runs in Edge on Windows | **Pass in Chromium** (Edge uses the same engine); Windows itself not tested | E2E |
| AC13 golden eval ≥ 85 %, shown in Settings | **Pass: 98.3 %** | section 3, settings E2E |
| AC14 APK < 30 MB, minSdk 24, targetSdk 36, release-signed | **Pass**, but signed with a temporary CI key until the signing secrets are added | CI verify step |

## 6. Edge cases (brief section 11)

✔ = covered by a test · ◐ = handled in code, not covered by an automated test · ✘ = not handled in v1 (listed in Known issues)

### 11.1 Files and import
- ✔ UTF-8 with BOM; windows-1252 (é survives); UTF-16 Excel export
- ✔ `;` tab and `|` delimiters; quoted commas and newlines; trailing empty columns; ragged rows
- ✔ title rows above the header; two-row merged headers; blank rows; "Grand Total"/"Total" rows skipped
- ✔ duplicate header names; spaces, dots, ₹, %, emoji, leading digits, reserved word `select` → safe identifiers
- ✔ multiple sheets (picker), hidden sheet flagged, empty sheet; ✔ password-protected → clear message; ✔ `.xls` BIFF8; ◐ `.xlsm` (same reader as .xlsx); ✔ `.ods`; ✘ `.numbers` (message asks for .xlsx/.csv)
- ✔ Excel serials incl. the 1900 bug; `17/11/2026`, `17-Nov-26`, `2026-11-17`; ambiguous `03/04/2026` follows "day first" with a warning; dates with a time; empty dates are row errors for sales
- ✔ `₹1,23,456.50`, `Rs. 500`, `1.2L`, `(250)`, `-`, `NA`, `—`; percentages; scientific-notation barcodes kept as text with a warning
- ✔ leading-zero SKUs stay text; ✔ Excel errors `#DIV/0!` `#N/A` → empty with a warning; ◐ formulas use cached values (SheetJS default)
- ✔ duplicate SKUs in a file (last wins + warning); ✔ same file twice (hash warning; upsert prevents doubles)
- ✔ unknown products auto-created and counted; ✔ negative qty → `return_in`; ✔ zero price flagged; ✔ price below cost flagged
- ◐ 50 MB / 300k rows: 50 MB hard limit tested, 300k warning shown, chunked 2,000-row transactions with progress and cancel; memory on a phone not measured
- ✔ app killed mid-import → batch rolled back on next start
- ✔ prompt-injection text in a cell stays data (only inside `<data>` tags, values cut to 40 characters)

### 11.2 Data and business logic
- ✔ negative stock shown in red with "Fix stock"; ✔ product without cost: margin "–" (◐ excluded from margin averages via NULLIF only when revenue is 0)
- ✔ division by zero returns NULL/"–" everywhere (empty-database test)
- ✔ periods with no data show an empty-state message, not empty axes
- ✔ FY boundary, month boundaries, leap day 2028 (date tests); ◐ device timezone: the app uses the device date and shows "As of" on the dashboard
- ✔ fractional quantities (kg) displayed to 3 decimals
- ✔ deleting a product with sales archives it instead
- ✔ undo of an import: rows, its stock movements and the products it created (kept when later data uses them)

### 11.3 Voice
- ◐ permission denied → message with the Android settings path; typed input stays available
- ◐ no recognition service → Whisper mode automatically if a key is set, otherwise a message
- ◐ offline with no language pack → native error mapped to "Download offline English…"
- ✘ low-confidence alternatives are not shown (the recogniser's best match is used; the transcript is editable)
- ◐ code-mixed speech: fuzzy product matching ("Did you mean …") helps; not measured
- ✔ spoken numbers and units normalised
- ◐ another app takes the mic / app backgrounded / screen off: the mic is stopped on `pause` and when the page is hidden
- ✔ continuous mode: 60 s silence and 10 min caps; back-off after 3 errors in 10 s
- ✔ very long dictation: buffer is a string; the request to the AI is capped at 2,000 characters with a notice

### 11.4 AI and LLM
- ✔ no key, invalid key (401), quota (429), timeout, 5xx, retired model (404 → model list refresh + fallback)
- ✔ invalid JSON, JSON in code fences, prose around JSON, unknown columns (repair loop)
- ✔ writes, PRAGMA, ATTACH, multiple statements blocked and logged
- ◐ very expensive query: the client terminates and restarts the DB worker after 3 s ("too heavy, narrow the period"); not covered by an automated test
- ✔ ambiguous questions ("how are we doing?") answered with this month's summary; "last Diwali" → clarify
- ✔ relative dates computed in code ("last month" early in a month; weeks start Monday)
- ✔ follow-ups ("and the month before?", "show the same by units", "and for Tata Salt 1kg?"); ✔ data not loaded ("supplier ratings") → "I don't have that data"
- ✔ off-topic ("write a poem") politely refused
- ✔ narration with numbers not in the result → template
- ◐ huge result: capped at 1,000 rows, table pages 10 at a time, narration from a summary (row count, column sums, top 5)

### 11.5 App, device and platform
- ◐ Android 8–15 (minSdk 24); WebView older than Chrome 100 shows an update prompt — not run on old devices
- ✘ low-end device (2–3 GB RAM, 32-bit ARM) not tested
- ◐ rotation, split screen, 200 % font: layout is responsive and uses rem units; not tested on a device
- ✔ dark mode (E2E)
- ◐ app killed by the OS: saves 0.4 s after each change, on `pause` and on hidden; a second snapshot is written to app storage on Android
- ◐ storage full: IndexedDB keeps the previous snapshot; a clear message is shown
- ✔ newer database refused; migrations run in order with a pre-migration copy (only schema v1 exists so far)
- ◐ wrong clock: device date is used and shown as "As of"
- ◐ Play Protect warning explained in the install guide
- ✔ API key never in backups (test); never logged (no logging of keys in code); not in exports (exports read tables only)

## 7. Device test (Joe's 15-minute script, brief 12.4)

Not run: the build ran unattended with no phone. The script is in `docs/PRODUCT_DOCUMENT.md` section 16 and should be the first thing done with the v1.0.0 APK.
