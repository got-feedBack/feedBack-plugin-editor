/*
 * Structural guard for screen.html — the seam every chrome PR collides on.
 *
 * Motivated by a real merge casualty: the squash-merge resolutions that
 * landed the sweep bar (#201) and the drum-pad strip (#199) each dropped
 * their block's closing </div> at the canvas-wrap overlay anchor, so the
 * main #editor-canvas ended up NESTED INSIDE the hidden drum-pad strip —
 * every band of the timeline (ruler, waveform, notes) rendered into a
 * display:none subtree and the editor looked empty after any load/import,
 * while every JS suite stayed green (none of them parse the markup).
 *
 * Pinned here with a minimal tag-stack walk (no DOM, no dependencies):
 *   1. every <div> in screen.html closes (global balance), and
 *   2. the overlay-riddled #editor-canvas-wrap subtree nests exactly:
 *      #editor-canvas's parent element IS #editor-canvas-wrap.
 *
 * Run: node tests/screen_markup.test.mjs
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, '..', 'screen.html'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, ''); // comments can mention tags freely

// Void elements never take a closing tag; everything else must balance.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img',
    'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

// Walk every tag, maintaining an open-element stack. Records the parent
// of each id at the moment its element opens.
function walk(src) {
    const stack = [];
    const parentOf = {};
    const errors = [];
    const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        const [full, rawName, attrs] = m;
        const name = rawName.toLowerCase();
        if (name === 'script' || name === 'style') continue; // none in this file's flow we nest on
        if (full.startsWith('</')) {
            if (!stack.length) { errors.push(`stray </${name}> at offset ${m.index}`); continue; }
            const top = stack.pop();
            if (top.name !== name) {
                errors.push(`</${name}> at offset ${m.index} closes <${top.name}${top.id ? '#' + top.id : ''}> opened at offset ${top.at}`);
                // Re-sync: unwind to the matching open tag if one exists.
                let i = stack.length - 1;
                while (i >= 0 && stack[i].name !== name) i--;
                if (i >= 0) stack.length = i;
            }
            continue;
        }
        if (VOID.has(name) || /\/\s*$/.test(attrs)) continue;
        const idm = attrs.match(/\bid\s*=\s*"([^"]+)"/);
        const parent = stack.length ? stack[stack.length - 1] : null;
        if (idm) parentOf[idm[1]] = parent ? (parent.id || parent.name) : '(root)';
        stack.push({ name, id: idm ? idm[1] : null, at: m.index });
    }
    for (const left of stack) {
        errors.push(`<${left.name}${left.id ? '#' + left.id : ''}> opened at offset ${left.at} never closes`);
    }
    return { parentOf, errors };
}

const { parentOf, errors } = walk(html);

let pass = 0, fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

t('every element in screen.html closes (no dangling open tags)', () => {
    assert.deepStrictEqual(errors, []);
});

t('#editor-canvas is a DIRECT child of #editor-canvas-wrap — never nested in an overlay', () => {
    assert.strictEqual(parentOf['editor-canvas'], 'editor-canvas-wrap');
});

t('the canvas-wrap overlays are siblings of the canvas, not ancestors', () => {
    for (const id of ['editor-sweep-bar', 'editor-segment-bar', 'editor-lint-pop',
        'editor-drum-pad-strip', 'editor-fretboard-strip', 'editor-roll-lock-pill',
        'editor-shortcut-panel']) {
        assert.strictEqual(parentOf[id], 'editor-canvas-wrap', id);
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
