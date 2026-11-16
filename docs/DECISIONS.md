# Decision log

One line per decision: **decision | reason | alternative considered**. Newest at the bottom.

| # | Decision | Reason | Alternative |
|---|----------|--------|-------------|
| 1 | Work on branch `claude/practical-clarke-2n0r3m`; CI triggers on `main`, `claude/**` and `v*` tags | The build session may only push to this branch; workflows already listen on `main`, so renaming or merging later needs no CI change | Push straight to `main` (not permitted from the session) |
| 2 | Package versions pinned to the latest stable on 17 Nov 2026: React 19.3.1, Vite 8.3.8, TypeScript 7.0.2, Tailwind 4.3.5, Capacitor 8.6.2, sql.js 1.16.0, ECharts 6.1.0, Vitest 5.1.0 | Phase 1 check: every plugin's peer range accepts Capacitor 8 and Node 22; nothing needed a downgrade | Older majors named in the brief |
| 3 | `@playwright/test` pinned to 1.63.0 (not 1.65.1) | Matches the Chromium already installed in the build sandbox; CI installs the matching browser itself | Latest Playwright plus a second browser download |
| 4 | SheetJS 0.20.3 is vendored as `vendor/xlsx-0.20.3.tgz` (sha256 `8dc73fc3…99fe8`) and installed with `file:` | `npm ci` then works with no access to cdn.sheetjs.com (corporate proxies, the build sandbox); npm's `xlsx` 0.18.5 has known vulnerabilities | Depend on the CDN URL directly; `exceljs` |
| 5 | Groq is called directly from the browser/WebView with `fetch`; no CapacitorHttp, no dev proxy | Phase 1 preflight to `api.groq.com/openai/v1/chat/completions` returned `access-control-allow-origin: *` | CapacitorHttp + Vite proxy (only needed if CORS blocked) |
| 6 | Models: `openai/gpt-oss-120b` (plan/SQL), `openai/gpt-oss-20b` (narration), `whisper-large-v3-turbo` (Whisper mode); fallback `qwen/qwen3.8-27b` | All four are in Groq's live `/models` list on 17 Nov 2026 (`qwen3.6-27b` from the brief is no longer listed) | `llama-3.3-70b-versatile` (retired) |
| 7 | "Lint" in CI is `tsc --noEmit` (strict) | ESLint 10 + typescript-eslint on TypeScript 7 is an unproven combination; a strict typecheck catches the bugs that matter in one night | Full ESLint setup |
| 8 | Release builds keep R8/minify **off** | The app is a WebView shell (R8 would save well under 1 MB) and R8 can break plugin reflection in ways that only show on a physical phone, which this build cannot test | `minifyEnabled true` + `shrinkResources true` as the brief suggests |
| 9 | CI signs with the `ANDROID_KEYSTORE_*` secrets when they exist, otherwise with a throwaway key generated for that run (release notes say which) | The build session cannot write GitHub Actions secrets (the API path is blocked), and the keystore must never be committed to this public repo | Commit the keystore (forbidden); ship unsigned |
| 10 | Releases are created by the workflow itself (`workflow_dispatch` with a `release_tag` input, or a pushed `v*` tag) | The session has no release-creation API; `softprops/action-gh-release` creates the tag and release from CI | `gh release create` from the session (not available) |
| 11 | GitHub Pages is published from the `gh-pages` branch by `web.yml` (peaceiris/actions-gh-pages) | Works with the default `GITHUB_TOKEN`; the official Pages actions cannot enable Pages on a repo by themselves | `actions/deploy-pages` (needs Pages switched to "GitHub Actions" first) |
| 12 | Splash screen is theme-only (brand colour + launcher mark); the stock Capacitor splash PNGs were deleted | No splash plugin needed, smaller APK, no Capacitor logo flash | `@capacitor/splash-screen` |
