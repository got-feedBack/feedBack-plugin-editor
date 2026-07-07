// Single-session capture around a real GP8 import (Satriani "Motorcycle Driver"
// with embedded audio): dense chart + real waveform, inspector on a real note,
// tempo map, the real DRUM-EDIT grid, dialogs, and the Loop-in-3D region.
// Writes stills with the SAME filenames captions.json/make_assets.py expect.
import { createRequire } from 'module';
import { promises as fs } from 'fs';
const require = createRequire('/home/byron/Repositories/feedback/');
const { chromium } = require('playwright');

const EXE = '/home/byron/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const GP = '/home/byron/Downloads/Joe Satriani-Motorcycle Driver-05-30-2026.gp';
const OUT = '/tmp/claude-1000/-home-byron--claude/e75ebae7-38f8-4bfa-a3ab-3e91923c0a80/scratchpad/teaser/captures';
const VW = 1920, VH = 1080;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const CLEAN = `#plugin-tuner,.tuner-fab,[data-plugin-fab],#tuner-fab{display:none!important}`;

const beatBarY = VH - 92;
const clickBtn = (p, id) => p.locator('#' + id).dispatchEvent('click');
const snap = (p, name) => p.screenshot({ path: `${OUT}/${name}.png` });

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: EXE,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--force-color-profile=srgb', '--hide-scrollbars'] });
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1,
    recordVideo: { dir: `${OUT}/_session`, size: { width: VW, height: VH } } });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') log('PERR', m.text().slice(0, 90)); });

  await p.goto('http://127.0.0.1:8000/v2', { waitUntil: 'load', timeout: 25000 });
  await p.addStyleTag({ content: CLEAN }).catch(() => {});
  await p.waitForTimeout(500);
  await p.evaluate(() => window.editSong('neon-ascent.sloppak'));
  await p.waitForTimeout(2200);

  // ── Import beat: open New, load GP, name it, show GP8 embedded-audio banner.
  log('New dialog + GP');
  await clickBtn(p, 'editor-create-btn'); await p.waitForTimeout(400);
  await p.setInputFiles('#editor-create-gp', GP);
  await p.waitForSelector('#editor-gp8-audio-banner:not(.hidden)', { timeout: 60000 }).catch(() => {});
  await p.fill('#editor-create-title', 'Motorcycle Driver').catch(() => {});
  await p.fill('#editor-create-artist', 'Joe Satriani').catch(() => {});
  await p.waitForTimeout(300);
  await p.addStyleTag({ content: CLEAN }).catch(() => {});
  await snap(p, '08_new_dialog');                      // import beat
  await clickBtn(p, 'editor-gp8-btn-embedded').catch(() => {});
  await p.waitForTimeout(300);
  log('Import & Open');
  await clickBtn(p, 'editor-create-go').catch(() => {});
  // wait for the real song to load
  for (let i = 0; i < 50; i++) {
    await p.waitForTimeout(1500);
    const st = await p.evaluate(() => ({
      open: !document.getElementById('editor-create-modal')?.classList.contains('hidden'),
      n: document.getElementById('editor-note-count')?.textContent || '',
    }));
    if (!st.open && /notes/.test(st.n) && !/^0 notes/.test(st.n)) { log('loaded', st.n); break; }
  }
  await p.waitForTimeout(1500);
  await p.addStyleTag({ content: CLEAN }).catch(() => {});

  // ── Establishing: dense chart + real waveform.
  await snap(p, '01_establish');
  log('establish ✓');

  // ── Inspector: select a real note → full right-hand panel.
  for (const [x, y] of [[200, 550], [157, 680], [300, 550], [100, 938]]) {
    await p.mouse.click(x, y); await p.waitForTimeout(400);
    const sel = await p.evaluate(() => /selected/.test(document.getElementById('editor-status')?.textContent || ''));
    if (sel) break;
  }
  await p.waitForTimeout(400); await snap(p, '06_inspector'); log('inspector ✓');
  await p.mouse.click(960, 300); // deselect (empty area)
  await p.waitForTimeout(300);

  // ── Zoom: scroll in on the dense notes + waveform detail.
  await p.mouse.move(500, 600);
  for (let i = 0; i < 7; i++) { await p.mouse.wheel(0, -240); await p.waitForTimeout(140); }
  await p.waitForTimeout(400); await snap(p, '03_zoom'); log('zoom ✓');
  for (let i = 0; i < 7; i++) { await p.mouse.wheel(0, 240); await p.waitForTimeout(80); } // restore

  // ── Tempo map.
  await clickBtn(p, 'editor-tempo-map-btn').catch(() => {});
  await p.waitForTimeout(900);
  await p.mouse.move(690, beatBarY); await p.mouse.down(); await p.mouse.move(770, beatBarY); await p.mouse.up();
  await p.waitForTimeout(500); await snap(p, '04_tempomap'); log('tempomap ✓');
  await clickBtn(p, 'editor-tempo-map-btn').catch(() => {}); // back to notes
  await p.waitForTimeout(700);

  // ── DRUM EDIT grid (the real ask): enter, capture the 18-piece grid, exit.
  await clickBtn(p, 'editor-drum-edit-btn').catch(() => {});
  await p.waitForTimeout(1000);
  await p.addStyleTag({ content: CLEAN }).catch(() => {});
  await snap(p, '09_drums_dialog'); log('drum-edit ✓');
  await clickBtn(p, 'editor-drum-edit-btn').catch(() => {}); // back
  await p.waitForTimeout(800);

  // ── Record MIDI dialog.
  await clickBtn(p, 'editor-record-midi-btn').catch(() => {});
  await p.waitForTimeout(600); await snap(p, '10_record_dialog'); log('record ✓');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);

  // ── Tones dialog.
  await clickBtn(p, 'editor-tones-btn').catch(() => {});
  await p.waitForTimeout(600); await snap(p, '11_tones_dialog'); log('tones ✓');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);

  // ── Build to enable Loop-in-3D (+ persist to library), then the region shot.
  log('Build Song');
  await clickBtn(p, 'editor-build-btn').catch(() => {});
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(1500);
    const done = await p.evaluate(() => {
      const s = document.getElementById('editor-status')?.textContent || '';
      const b = document.getElementById('editor-loop3d-btn');
      return /built|saved|done/i.test(s) || (b && !b.disabled);
    });
    if (done) { log('build done @', (i + 1) * 1.5 + 's'); break; }
  }
  await p.waitForTimeout(800);
  await p.addStyleTag({ content: CLEAN }).catch(() => {});
  // drag the ⇆ bars strip → blue region; button lights
  await p.mouse.move(520, beatBarY); await p.mouse.down();
  for (let x = 520; x <= 1160; x += 40) { await p.mouse.move(x, beatBarY); await p.waitForTimeout(45); }
  await p.mouse.up(); await p.waitForTimeout(900);
  await snap(p, '05_loop3d_region'); log('loop3d ✓');

  await ctx.close(); await browser.close();
  log('done');
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
