# Build status log

Times are IST, 17 Nov 2026. Three lines per gate: done, next, risks.

## P0/P1 — environment and versions (02:15)
- **Done:** toolchain probed (Node 22.23, npm 10.9, JDK 21, Gradle, Playwright Chromium); versions pinned; Groq models list and CORS preflight verified; SheetJS 0.20.3 vendored.
- **Next:** skeleton app, Android project, both CI workflows, first signed APK (Gate G1).
- **Risks:** the session cannot set GitHub Actions secrets or switch on GitHub Pages, so CI signs with a temporary key and Pages needs a one-time click by the repo owner.

## G1 — skeleton APK (17 Nov, 09:50)
- **Done:** five-tab shell, Capacitor Android project, both workflows; CI builds, signs and verifies the APK; release `v0.1.0-skeleton` published by CI. A local release build also verified with apksigner.
- **Next:** data layer, dashboard, inventory, Ask pipeline.
- **Risks:** push access to GitHub was missing for part of the night (resolved); APK not tested on a phone; CI signs with a temporary key.

## G2 — Ask + voice (17 Nov, 23:55)
- **Done:** offline intent engine (27 intents, 60/60 test phrases), Groq plan + narration with grounding, SQL guard (70 cases), repair loop, chart picker, forecast/reorder/ABC tools, voice controller with native/Web Speech/Whisper engines, confirmation cards. Golden eval 59/60 (98.3 %), 0 unsafe SQL.
- **Next:** E2E specs, performance check, docs.
- **Risks:** real microphones untested; Groq free tier is 8k tokens/minute (several questions a minute is fine for one user).

## G3 — feature freeze (18 Nov, 00:20)
- **Done:** every Must story passes E2E (15 specs incl. offline mode, mocked mic, import + undo, CRUD); 333 unit/integration tests; 84 % line coverage of core; perf budgets met at 4× CPU throttle.
- **Next:** test report, product document, RC1, v1.0.0.
- **Risks:** GitHub Pages needs one click by the owner; signing secrets need adding by the owner.

## RC1 / release (18 Nov)
- **Done:** v1.0.0-rc1 built by CI; documentation (PRODUCT_DOCUMENT, TEST_REPORT, README, DECISIONS) written; v1.0.0 tagged by CI.
- **Next:** Joe's 15-minute device test; add the signing secrets and turn on Pages.
- **Risks:** device-only bugs (voice plugin, back button, insets) are possible because no phone was available.
