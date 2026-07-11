/*
 * Contract tests for the immersive full-bleed opt-in (workspace-shell B1).
 *
 * Three files must agree for full-bleed to work, and nothing runtime ties
 * them together — the host reads `plugin.json`, the shell toggles a class on
 * <html>, and the CSS bridges the two. Each assertion below pins one leg of
 * that contract so a refactor can't silently drop it:
 *
 *   1. `plugin.json` declares `fullscreen: true` as a STRICT boolean — core's
 *      manifest parser deliberately ignores truthy non-booleans ("true"), so a
 *      quoting slip would silently lose immersive mode with no error anywhere.
 *   2. The screen root carries the `.editor-root` hook the CSS targets, and
 *      KEEPS `pt-16` + `h-screen` — the v2/legacy layout (fixed navbar, block
 *      flow) still depends on both.
 *   3. `assets/v3-theme.css` has the `html.fb-immersive`-scoped rule that
 *      zeroes the navbar allowance and sizes the root to the pinned slot.
 *
 * No Playwright here by design: this repo ships with zero node_modules (the
 * desktop bundler would package them). Layout is verified on the testbed.
 *
 * Run: node tests/fullbleed.test.mjs
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('plugin.json opts into fullscreen with a strict boolean', () => {
    const manifest = JSON.parse(read('plugin.json'));
    assert.strictEqual(manifest.fullscreen, true,
        'must be boolean true — core ignores truthy non-booleans like "true"');
});

t('the screen root carries the .editor-root hook', () => {
    const html = read('screen.html');
    const rootTag = html.slice(0, html.indexOf('>') + 1);
    assert.match(rootTag, /class="[^"]*\beditor-root\b/,
        'first tag of screen.html must carry the class the immersive CSS targets');
});

t('the screen root keeps the v2/legacy layout classes', () => {
    const html = read('screen.html');
    const rootTag = html.slice(0, html.indexOf('>') + 1);
    // Under v2 the fixed navbar overlays the top 4rem (pt-16) and the screen
    // is in block flow (h-screen). Immersive zeroes these via CSS — the
    // classes themselves must stay for the legacy layout.
    assert.match(rootTag, /\bpt-16\b/, 'pt-16 must stay for the v2 fixed navbar');
    assert.match(rootTag, /\bh-screen\b/, 'h-screen must stay for v2 block flow');
});

t('v3-theme.css bridges fb-immersive to the editor root', () => {
    const css = read('assets/v3-theme.css');
    const m = css.match(
        /html\.fb-immersive\s+#plugin-editor\s+\.editor-root\s*\{([^}]*)\}/);
    assert.ok(m, 'expected a html.fb-immersive #plugin-editor .editor-root rule');
    assert.match(m[1], /padding-top:\s*0/, 'must zero the navbar allowance');
    assert.match(m[1], /height:\s*100%/, 'must size to the pinned slot, not 100vh');
});

t('the immersive rule is scoped so v2/legacy is untouched', () => {
    const css = read('assets/v3-theme.css');
    // Every mention of .editor-root in this stylesheet must sit inside an
    // html.fb-immersive-scoped selector — an unscoped rule would restyle the
    // v2 layout, which never gets the class on <html>.
    for (const line of css.split('\n')) {
        if (line.includes('.editor-root') && !line.trim().startsWith('*') &&
            !line.trim().startsWith('/*')) {
            assert.match(line, /html\.fb-immersive/,
                `unscoped .editor-root selector: "${line.trim()}"`);
        }
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
