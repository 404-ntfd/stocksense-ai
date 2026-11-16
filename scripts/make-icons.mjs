// Renders public/icon.svg to the PNG sizes the PWA manifest and Android launcher need.
// Uses the Playwright Chromium that is already on the build machine (no sharp dependency).
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
const out = (p) => new URL('../' + p, import.meta.url);
const browser = await chromium.launch();
const page = await browser.newPage();
async function render(size, path, { pad = 0, bg = null, round = false } = {}) {
  await page.setViewportSize({ width: size, height: size });
  const inner = size - pad * 2;
  await page.setContent(`<html><body style="margin:0;background:${bg || 'transparent'}"><div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;${round ? 'border-radius:50%;overflow:hidden;' : ''}"><div style="width:${inner}px;height:${inner}px">${svg}</div></div></body></html>`);
  const buf = await page.screenshot({ omitBackground: !bg, clip: { x: 0, y: 0, width: size, height: size } });
  mkdirSync(new URL('.', out(path)), { recursive: true });
  writeFileSync(out(path), buf);
}
await render(192, 'public/icon-192.png');
await render(512, 'public/icon-512.png');
const dens = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [d, s] of Object.entries(dens)) {
  const base = `android/app/src/main/res/mipmap-${d}`;
  await render(s, `${base}/ic_launcher.png`);
  await render(s, `${base}/ic_launcher_round.png`, { round: true });
  // adaptive foreground: 108dp canvas, artwork inside the 66dp safe zone
  const fg = Math.round((s * 108) / 48);
  await render(fg, `${base}/ic_launcher_foreground.png`, { pad: Math.round(fg * 0.22) });
}
await browser.close();
console.log('icons written');
