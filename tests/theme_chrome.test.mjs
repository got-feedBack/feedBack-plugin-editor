/*
 * Theme chrome regression tests.
 *
 * These parse the shipped CSS directly so the contract stays cheap to check:
 * Dark preserves legacy menu/transport values, Medium/Light keep readable ink,
 * active states use a theme-aware on-accent token, and guide prose is tokenized.
 *
 * Run: node tests/theme_chrome.test.mjs
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, '..', 'assets', 'v3-theme.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector) {
    const i = css.indexOf(selector);
    assert.ok(i >= 0, `missing selector: ${selector}`);
    const open = css.indexOf('{', i);
    assert.ok(open >= 0, `missing block open: ${selector}`);
    let depth = 0;
    for (let j = open; j < css.length; j++) {
        if (css[j] === '{') depth++;
        if (css[j] === '}') {
            depth--;
            if (depth === 0) return css.slice(open + 1, j);
        }
    }
    throw new Error(`missing block close: ${selector}`);
}

function vars(selector) {
    const out = {};
    const body = block(selector);
    for (const m of body.matchAll(/(--ed-[\w-]+)\s*:\s*([^;]+);/g)) {
        out[m[1]] = m[2].trim();
    }
    return out;
}

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const baseSel = '#plugin-editor[data-v3-layout="1"]';
const mediumSel = '#plugin-editor[data-v3-layout="1"][data-editor-theme="medium"]';
const lightSel = '#plugin-editor[data-v3-layout="1"][data-editor-theme="light"]';

t('theme blocks expose the required token set', () => {
    const required = [
        '--ed-app', '--ed-panel', '--ed-field', '--ed-btn', '--ed-btn-hover',
        '--ed-border', '--ed-text-strong', '--ed-text-2', '--ed-text',
        '--ed-text-dim', '--ed-text-faint', '--ed-accent',
        '--ed-accent-hover', '--ed-on-accent', '--ed-menu-field',
        '--ed-menu-border', '--ed-transport-panel', '--ed-transport-btn',
        '--ed-transport-btn-hover',
    ].sort();
    for (const selector of [baseSel, mediumSel, lightSel]) {
        assert.deepStrictEqual(Object.keys(vars(selector)).sort(), required, selector);
    }
});

t('dark theme preserves legacy menu and transport chrome defaults', () => {
    const v = vars(baseSel);
    assert.strictEqual(v['--ed-menu-border'], '#263349');
    assert.strictEqual(v['--ed-transport-panel'], '#131c2e');
    assert.strictEqual(v['--ed-transport-btn'], '#24324a');
    assert.strictEqual(v['--ed-transport-btn-hover'], '#334a6b');
    assert.strictEqual(v['--ed-text-faint'], '#64748b');
});

t('medium and light faint text and accent foregrounds are pinned to readable values', () => {
    const medium = vars(mediumSel);
    const light = vars(lightSel);
    assert.strictEqual(medium['--ed-text-faint'], '#c7cfdb');
    assert.strictEqual(light['--ed-text-faint'], '#5f6b7a');
    assert.strictEqual(medium['--ed-on-accent'], '#0f172a');
    assert.strictEqual(light['--ed-accent'], '#0369a1');
    assert.strictEqual(light['--ed-on-accent'], '#ffffff');
});

t('active states use the on-accent token instead of hardcoded near-white text', () => {
    for (const selector of [
        '#plugin-editor .editor-menu-title.is-open',
        '#plugin-editor .editor-menu-item:hover:not([aria-disabled]),',
        '#plugin-editor .editor-menu-item:hover:not([aria-disabled]) .editor-menu-key,',
        '#plugin-editor .editor-lint-row:hover',
        '#plugin-editor .editor-transport-btn[aria-pressed="true"]',
    ]) {
        assert.match(block(selector), /color:\s*var\(--ed-on-accent,/);
    }
});

t('guide prose colors are theme tokens, not dark-only hardcoded inks', () => {
    assert.match(block('#plugin-editor .editor-guide-body h3'), /color:\s*var\(--ed-text-strong,/);
    assert.match(block('#plugin-editor .editor-guide-body strong'), /color:\s*var\(--ed-text-2,/);
    const code = block('#plugin-editor .editor-guide-body code');
    assert.match(code, /background:\s*var\(--ed-field,/);
    assert.match(code, /border:\s*1px solid var\(--ed-border,/);
    assert.match(code, /color:\s*var\(--ed-text,/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
