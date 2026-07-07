// Teaser auto-capture: drives the feedBack Song Editor headlessly and records
// one webm clip + a hero still per shot. Reliable, scriptable states only;
// draggy/rich shots (handshape paint, note drag, highway round-trip, real
// stems/drums) are recorded live by Byron per SHOTLIST.md.
//
// Run from the core repo (has node_modules/playwright):
//   node /…/scratchpad/teaser/capture.mjs
import { createRequire } from 'module';
import { promises as fs } from 'fs';
import path from 'path';
const require = createRequire('/home/byron/Repositories/feedback/');
const { chromium } = require('playwright');

const EXE = '/home/byron/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const BASE = 'http://127.0.0.1:8000/v2';
const SONG = 'neon-ascent.sloppak';
const OUT = '/tmp/claude-1000/-home-byron--claude/e75ebae7-38f8-4bfa-a3ab-3e91923c0a80/scratchpad/teaser/captures';
const VW = 1920, VH = 1080;

// Hide non-editor plugin overlays (floating Tuner widget) for clean frames.
const CLEAN_CSS = `
  #plugin-tuner, .tuner-fab, [data-plugin-fab], #tuner-fab { display:none !important; }
`;

const launchArgs = [
  '--no-sandbox',
  '--autoplay-policy=no-user-gesture-required',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--force-color-profile=srgb',
  '--hide-scrollbars',
];

async function openEditor(page) {
  await page.goto(BASE, { waitUntil: 'load', timeout: 25000 });
  await page.addStyleTag({ content: CLEAN_CSS }).catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate((s) => window.editSong(s), SONG);
  // Wait until notes are loaded (status reflects the song).
  await page.waitForFunction(
    () => /Loaded:/.test(document.getElementById('editor-status')?.textContent || ''),
    { timeout: 15000 },
  ).catch(() => {});
  await page.waitForTimeout(2200); // let the 60fps canvas settle + draw waveform
  await page.addStyleTag({ content: CLEAN_CSS }).catch(() => {});
}

async function shot(browser, name, durationMs, fn) {
  const dir = path.join(OUT, name);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: 1,
    recordVideo: { dir, size: { width: VW, height: VH } },
  });
  const page = await ctx.newPage();
  let ok = true;
  try {
    await openEditor(page);
    await fn(page);
    await page.waitForTimeout(durationMs);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  } catch (e) {
    ok = false;
    console.log(`  ! ${name}: ${e.message.split('\n')[0]}`);
  }
  const vpath = await page.video()?.path();
  await ctx.close();
  if (vpath) {
    await fs.rename(vpath, path.join(OUT, `${name}.webm`)).catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
  console.log(`  ${ok ? '✓' : '×'} ${name}`);
}

// canvas geometry helpers (canvas fills width; beat-bar strip ~22px above status bar)
const beatBarY = VH - 92;           // the "⇆ bars" gutter
const canvasMidY = 540;

// Toolbar buttons sit UNDER the fixed app navbar in /v2, so coordinate clicks
// are intercepted. dispatchEvent('click') delivers straight to the element.
const clickBtn = (p, id) => p.locator('#' + id).dispatchEvent('click');

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: EXE, args: launchArgs });
  console.log('capturing shots →', OUT);

  // 1. Establishing beauty — loaded editor, real waveform, notes, sections.
  await shot(browser, '01_establish', 4000, async (p) => {
    await p.mouse.move(960, canvasMidY);
  });

  // 2. Playback — cursor sweeps across the chart + waveform.
  await shot(browser, '02_playback', 6500, async (p) => {
    await clickBtn(p, 'editor-play-btn').catch(() => {});
  });

  // 3. Zoom in — detail + sharpened min/max waveform (#33).
  await shot(browser, '03_zoom', 4500, async (p) => {
    await p.mouse.move(760, 900);
    for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, -240); await p.waitForTimeout(180); }
  });

  // 4. Tempo Map mode — EOF-style sync overlay.
  await shot(browser, '04_tempomap', 5000, async (p) => {
    await clickBtn(p, 'editor-tempo-map-btn').catch(() => {});
    await p.waitForTimeout(800);
    // nudge a sync point so the BPM-recalc reads as "live"
    await p.mouse.move(690, beatBarY); await p.mouse.down();
    await p.mouse.move(760, beatBarY); await p.mouse.up();
  });

  // 5. HERO (editor side) — drag the ⇆ bars strip → blue region → Loop in 3D enables.
  await shot(browser, '05_loop3d_region', 5200, async (p) => {
    await p.mouse.move(560, beatBarY);
    await p.mouse.down();
    for (let x = 560; x <= 1180; x += 40) { await p.mouse.move(x, beatBarY); await p.waitForTimeout(45); }
    await p.mouse.up();
    await p.waitForTimeout(900);
    // pulse the now-enabled button into frame
    await p.hover('#editor-loop3d-btn').catch(() => {});
  });

  // 5b. HERO attempt — actually fire Loop in 3D (needs core #575 + WebGL; best-effort).
  await shot(browser, '05b_loop3d_highway', 7000, async (p) => {
    await p.mouse.move(560, beatBarY);
    await p.mouse.down();
    for (let x = 560; x <= 1180; x += 40) { await p.mouse.move(x, beatBarY); await p.waitForTimeout(40); }
    await p.mouse.up();
    await p.waitForTimeout(700);
    await clickBtn(p, 'editor-loop3d-btn').catch(() => {});
    await p.waitForTimeout(4500); // let highway mount + loop
  });

  // 6. Inspector — select a note, technique fields appear.
  await shot(browser, '06_inspector', 4500, async (p) => {
    await p.mouse.click(700, 900); // the red E-string note block
    await p.waitForTimeout(600);
  });

  // (Stem mixer shot dropped: #editor-stems-mixer-btn is hidden on this single-stem
  //  demo song. Captured live by Byron on a separated-stem song — see SHOTLIST.md.)

  // 8. New… import dialog — format picker + GP import surface.
  await shot(browser, '08_new_dialog', 4500, async (p) => {
    await clickBtn(p, 'editor-create-btn').catch(() => {});
  });

  // 9. Add Drums dialog — drum import surface (18-piece).
  await shot(browser, '09_drums_dialog', 4000, async (p) => {
    await clickBtn(p, 'editor-add-drums-btn').catch(() => {});
  });

  // 10. Record MIDI dialog — live MIDI capture surface.
  await shot(browser, '10_record_dialog', 4000, async (p) => {
    await clickBtn(p, 'editor-record-midi-btn').catch(() => {});
  });

  // 11. Tones dialog — tone slots authoring.
  await shot(browser, '11_tones_dialog', 4000, async (p) => {
    await clickBtn(p, 'editor-tones-btn').catch(() => {});
  });

  // 12. Strings dialog — extended-range tuning authoring.
  await shot(browser, '12_strings_dialog', 4000, async (p) => {
    await clickBtn(p, 'editor-strings-btn').catch(() => {});
  });

  await browser.close();
  console.log('done.');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
