# StockSense AI

Ask your shop anything. StockSense AI is an Android app (and a web app for Windows) for small businesses: import your Excel or CSV stock list and sales register, see sales, profit and stock at a glance, and ask questions by voice or text ("what were my total sales last month?", "when will sugar run out?", "what should I reorder?").

- **Every number comes from your own data on your device.** The AI only writes a read-only query or picks a tool; it never does the arithmetic and can never change your data.
- **Works offline** for the dashboard, inventory and the 25 most common questions. Any other question needs a free Groq API key.
- **English (India)** voice, tap-to-talk or continuous dictation.

Full documentation: [docs/PRODUCT_DOCUMENT.md](docs/PRODUCT_DOCUMENT.md) · Test results: [docs/TEST_REPORT.md](docs/TEST_REPORT.md) · Decisions: [docs/DECISIONS.md](docs/DECISIONS.md)

## 1-minute quick start on Windows

You only need **Node.js 22** (from <https://nodejs.org>, "LTS", default options) and **Chrome or Edge**.

1. Download the code: on the GitHub page click **Code → Download ZIP**, and unzip it (for example to `C:\stocksense-ai`). Or, if you have Git: `git clone https://github.com/404-ntfd/stocksense-ai.git`.
2. Open **Command Prompt** or **PowerShell** in that folder (in File Explorer, click the address bar, type `cmd`, press Enter).
3. Run these three commands, one at a time:

```bash
npm ci
```

```bash
npm run build
```

```bash
npm run preview
```

4. Open <http://localhost:4173> in Chrome or Edge. Choose **Try with demo data**.
5. Optional: in Edge or Chrome, use the menu → **Apps → Install StockSense AI** to get a desktop app window.

To ask any question (not just the common ones), get a free key at <https://console.groq.com/keys> and paste it in **More → AI → API key → Test**.

Voice works in Chrome and Edge (it needs an internet connection there). If the microphone does not work, choose **More → Voice → Speech engine → Whisper** (needs the Groq key).

## Install on Android

1. Open the latest release: <https://github.com/404-ntfd/stocksense-ai/releases> and download `StockSense-AI-v….apk` on the phone.
2. Tap the file. Allow **Install unknown apps** for Chrome or Files when asked.
3. If Play Protect warns about an unknown developer, tap **More details → Install anyway**.
4. If an older StockSense build is installed and the new one will not install, uninstall the old one first (builds signed with different keys cannot update each other).

The APK is built, signed and checked by GitHub Actions (signature, minSdk 24, targetSdk 36, size). It has **not yet been tested on a physical phone**; see the product document, Known issues.

## Web app (PWA)

The same build is published to GitHub Pages: <https://404-ntfd.github.io/stocksense-ai/> (once Pages is switched on, see below). On an Android phone, open it in Chrome and choose **Add to Home screen**.

## For the repository owner: two one-time settings

1. **GitHub Pages:** Settings → Pages → Build and deployment → *Deploy from a branch* → branch `gh-pages`, folder `/ (root)` → Save. The web workflow already publishes every build to that branch.
2. **Permanent signing key:** Settings → Secrets and variables → Actions → New repository secret, add the four secrets from the keystore hand-over (`ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`). Then Actions → *Android APK* → Run workflow with a new tag (for example `v1.0.1`). Until then each CI build is signed with a temporary key.

## Developer commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server at http://localhost:5173 |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run test:coverage` | Same, with coverage of `src/core` |
| `npm run build && npm run test:e2e` | Playwright end-to-end tests on the production build (Pixel 7 viewport) |
| `npm run eval` | Golden-set eval against Groq (needs `GROQ_API_KEY`); `-- --mode pipeline` for the as-shipped score |
| `npm run fixtures` | Regenerates the messy import fixtures and `samples/` |
| `npm run screenshots` | Regenerates `docs/img/` |
| `npm run android:debug` | Local debug APK (needs JDK 21 and the Android SDK 36) |

Try importing `samples/demo_sales.xlsx` (a sales register with a title row and a totals row) or `samples/demo_stock.csv`.
