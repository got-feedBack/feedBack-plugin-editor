/*
 * The EOF reference pin — EOF_hotkeys.txt (the pro-guitar authoring keyset),
 * encoded line by line and asserted against the LIVE EOF resolver.
 *
 * This is the "encode + verify" half of EOF-PROFILE-POLICY.md: every keyboard
 * line of the reference carries a verdict, and the resolver is pinned to it —
 * so a resolver edit that breaks faithfulness (or a new binding that squats a
 * reference key) fails here instead of shipping. Mouse lines land with the
 * EOF mouse grammar (policy PR 2).
 *
 * Verdicts:
 *   match  — EOF's key runs the same concept here; resolver must return cmd.
 *   adapt  — EOF's key runs our closest command; resolver must return cmd,
 *            and the divergence is surfaced via PROFILE_DIVERGENCES.
 *   ours   — a Protected-Core interaction deliberately differs (policy C1-C5);
 *            resolver must return OUR meaning (cmd), never silently nothing.
 *   omit   — EOF feature with no command here (never fabricate); resolver
 *            must return null so the key stays free.
 *   global — handled outside the profile resolvers (input.js cross-profile
 *            layer); documented only, no resolver assertion.
 *
 * Run: node tests/eof_reference.test.mjs
 */
import assert from 'node:assert';
import * as api from '../src/shortcuts.js';

let pass = 0;
let fail = 0;
function t(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('  FAIL ' + name + ': ' + e.message); }
}

const ev = (key, mods = {}) => ({
    key,
    code: mods.code || '',
    ctrlKey: !!mods.ctrl,
    metaKey: !!mods.meta,
    shiftKey: !!mods.shift,
    altKey: !!mods.alt,
});

// One entry per keyboard line of EOF_hotkeys.txt. `ev` is the probe keydown;
// `cmd` is what the EOF resolver must return (null for omit). `mode` defaults
// to note mode. Families (digits, numpad) probe a representative member.
const EOF_REFERENCE = [
    // ── plain technique/edit keys ────────────────────────────────────
    { eof: 'F', ref: 'Edit frets/fingering', verdict: 'match', ev: ev('f'), cmd: 'editFret' },
    { eof: 'H', ref: 'Hammer-on', verdict: 'match', ev: ev('h'), cmd: 'toggleHammerOn' },
    { eof: 'N', ref: 'Edit pro guitar note menu', verdict: 'match', ev: ev('n'), cmd: 'noteMenu' },
    { eof: 'P', ref: 'Pull-off', verdict: 'match', ev: ev('p'), cmd: 'togglePullOff' },
    { eof: 'T', ref: 'Crazy status (no such feature here)', verdict: 'omit', ev: ev('t'), cmd: null },
    // ── Ctrl / Shift / Ctrl+Shift letters ────────────────────────────
    { eof: 'Ctrl+A', ref: 'Select all', verdict: 'global', ev: null, cmd: null },
    { eof: 'Ctrl+Shift+A', ref: 'Accent', verdict: 'match', ev: ev('a', { ctrl: true, shift: true }), cmd: 'toggleAccent' },
    { eof: 'Ctrl+B', ref: 'Bend', verdict: 'match', ev: ev('b', { ctrl: true }), cmd: 'bend' },
    { eof: 'Ctrl+C', ref: 'Copy', verdict: 'match', ev: ev('c', { ctrl: true }), cmd: 'copySelection' },
    { eof: 'Ctrl+F', ref: 'Edit fingering', verdict: 'match', ev: ev('f', { ctrl: true }), cmd: 'editFret' },
    { eof: 'Shift+F', ref: 'Set fret hand position at playback bar', verdict: 'match', ev: ev('f', { shift: true }), cmd: 'setAnchor' },
    { eof: 'Shift+G', ref: 'Toggle grid snap display', verdict: 'match', ev: ev('g', { shift: true }), cmd: 'toggleGridDisplay' },
    { eof: 'Ctrl+Shift+G', ref: 'Custom grid snap', verdict: 'match', ev: ev('g', { ctrl: true, shift: true }), cmd: 'customGridSnap' },
    { eof: 'Ctrl+H', ref: 'Natural harmonic', verdict: 'match', ev: ev('h', { ctrl: true }), cmd: 'toggleNaturalHarmonic' },
    { eof: 'Shift+H', ref: 'Pinch harmonic', verdict: 'match', ev: ev('h', { shift: true }), cmd: 'togglePinchHarmonic' },
    { eof: 'Ctrl+Shift+H', ref: 'Add handshape', verdict: 'match', ev: ev('h', { ctrl: true, shift: true }), cmd: 'addHandshape' },
    { eof: 'Shift+I', ref: 'Set time signature', verdict: 'match', ev: ev('i', { shift: true }), cmd: 'setTimeSignature' },
    { eof: 'Ctrl+Shift+I', ref: 'Ignore', verdict: 'match', ev: ev('i', { ctrl: true, shift: true }), cmd: 'toggleIgnore' },
    { eof: 'Ctrl+L', ref: 'Select like (string+fret)', verdict: 'match', ev: ev('l', { ctrl: true }), cmd: 'selectLike' },
    { eof: 'Shift+L', ref: 'Precise select like (incl. statuses)', verdict: 'adapt', ev: ev('l', { shift: true }), cmd: 'selectLike' },
    { eof: 'Ctrl+M', ref: 'Palm mute', verdict: 'match', ev: ev('m', { ctrl: true }), cmd: 'togglePalmMute' },
    { eof: 'Shift+N', ref: 'Link-next', verdict: 'match', ev: ev('n', { shift: true }), cmd: 'toggleLinkNext' },
    { eof: 'Ctrl+Shift+O', ref: 'Tremolo', verdict: 'match', ev: ev('o', { ctrl: true, shift: true }), cmd: 'toggleTremolo' },
    { eof: 'Shift+P', ref: 'Add phrase', verdict: 'match', ev: ev('p', { shift: true }), cmd: 'addPhrase' },
    { eof: 'Ctrl+Shift+P', ref: 'Pop', verdict: 'match', ev: ev('p', { ctrl: true, shift: true }), cmd: 'togglePop' },
    { eof: 'Shift+R', ref: 'Resnap to grid', verdict: 'match', ev: ev('r', { shift: true }), cmd: 'resnapSelection' },
    { eof: 'Ctrl+Shift+R', ref: 'Place mover phrase', verdict: 'match', ev: ev('r', { ctrl: true, shift: true }), cmd: 'placeMoverPhrase' },
    { eof: 'Ctrl+S', ref: 'Save', verdict: 'match', ev: ev('s', { ctrl: true }), cmd: 'save' },
    { eof: 'Shift+S', ref: 'Add section', verdict: 'match', ev: ev('s', { shift: true }), cmd: 'addSection' },
    { eof: 'Ctrl+T', ref: 'Tap', verdict: 'match', ev: ev('t', { ctrl: true }), cmd: 'toggleTap' },
    { eof: 'Shift+T', ref: 'Midi tones', verdict: 'match', ev: ev('t', { shift: true }), cmd: 'midiTones' },
    { eof: 'Ctrl+Shift+T', ref: 'Add tone change at playback bar', verdict: 'match', ev: ev('t', { ctrl: true, shift: true }), cmd: 'addToneChange' },
    { eof: 'Ctrl+U', ref: 'Unpitched slide', verdict: 'match', ev: ev('u', { ctrl: true }), cmd: 'unpitchedSlide' },
    { eof: 'Ctrl+V', ref: 'Paste', verdict: 'match', ev: ev('v', { ctrl: true }), cmd: 'pasteAtPlayhead' },
    { eof: 'Shift+V', ref: 'Vibrato', verdict: 'match', ev: ev('v', { shift: true }), cmd: 'toggleVibrato' },
    { eof: 'Ctrl+X', ref: 'String mute (resets fret to open)', verdict: 'match', ev: ev('x', { ctrl: true }), cmd: 'toggleMuteOpen' },
    { eof: 'Shift+X', ref: 'String mute (retains fret)', verdict: 'match', ev: ev('x', { shift: true }), cmd: 'toggleMuteRetain' },
    { eof: 'Ctrl+Z', ref: 'Undo', verdict: 'global', ev: null, cmd: null },
    // ── arrows ───────────────────────────────────────────────────────
    { eof: 'Ctrl+Up', ref: 'Pitched slide (up)', verdict: 'match', ev: ev('ArrowUp', { ctrl: true }), cmd: 'slideUp' },
    { eof: 'Ctrl+Down', ref: 'Pitched slide (down)', verdict: 'match', ev: ev('ArrowDown', { ctrl: true }), cmd: 'slideDown' },
    { eof: 'Shift+Up', ref: 'Transpose maintaining pitch', verdict: 'match', ev: ev('ArrowUp', { shift: true }), cmd: 'transposeStringUp' },
    { eof: 'Shift+Down', ref: 'Transpose maintaining pitch', verdict: 'match', ev: ev('ArrowDown', { shift: true }), cmd: 'transposeStringDown' },
    // ── piano-roll display / view keys we don't have ─────────────────
    { eof: 'Shift+Enter', ref: 'Display 2nd piano roll', verdict: 'omit', ev: ev('Enter', { shift: true }), cmd: null },
    { eof: 'Ctrl+Enter', ref: 'Quick swap between piano rolls', verdict: 'omit', ev: ev('Enter', { ctrl: true }), cmd: null },
    { eof: 'Shift+F11', ref: 'Toggle 2D pane display', verdict: 'omit', ev: ev('F11', { shift: true }), cmd: null },
    // ── navigation ───────────────────────────────────────────────────
    { eof: 'Page Up', ref: 'Previous beat', verdict: 'match', ev: ev('PageUp'), cmd: 'prevBeat' },
    { eof: 'Page Down', ref: 'Next beat', verdict: 'match', ev: ev('PageDown'), cmd: 'nextBeat' },
    { eof: 'Shift+Page Up', ref: 'Previous note', verdict: 'match', ev: ev('PageUp', { shift: true }), cmd: 'prevNote' },
    { eof: 'Shift+Page Down', ref: 'Next note', verdict: 'match', ev: ev('PageDown', { shift: true }), cmd: 'nextNote' },
    { eof: 'Ctrl+Shift+Page Up', ref: 'Previous grid snap line', verdict: 'match', ev: ev('PageUp', { ctrl: true, shift: true }), cmd: 'prevGrid' },
    { eof: 'Ctrl+Shift+Page Down', ref: 'Next grid snap line', verdict: 'match', ev: ev('PageDown', { ctrl: true, shift: true }), cmd: 'nextGrid' },
    { eof: 'Alt+Page Up', ref: 'Previous anchor', verdict: 'match', ev: ev('PageUp', { alt: true }), cmd: 'prevAnchor' },
    { eof: 'Alt+Page Down', ref: 'Next anchor', verdict: 'match', ev: ev('PageDown', { alt: true }), cmd: 'nextAnchor' },
    { eof: 'Left / Right', ref: 'Seek by grid snap', verdict: 'ours', ev: ev('ArrowLeft'), cmd: 'nudgeTimeLeft' },
    // ── bookmarks + fret values ──────────────────────────────────────
    { eof: 'Numpad 0-9', ref: 'Go to bookmark', verdict: 'match', ev: ev('7', { code: 'Numpad7' }), cmd: 'gotoBookmark:7' },
    { eof: 'Ctrl+Numpad 0-9', ref: 'Set bookmark', verdict: 'match', ev: ev('7', { ctrl: true, code: 'Numpad7' }), cmd: 'setBookmark:7' },
    { eof: 'Ctrl+` through 0', ref: 'Set fret 0-10', verdict: 'adapt', ev: ev('4', { ctrl: true }), cmd: 'setFretDigit:4' },
    { eof: 'Ctrl+`', ref: 'Set fret 0', verdict: 'adapt', ev: ev('`', { ctrl: true }), cmd: 'setFretDigit:0' },
    { eof: 'Ctrl+0', ref: 'Set fret 10', verdict: 'adapt', ev: ev('0', { ctrl: true }), cmd: 'setFretTen' },
    { eof: 'Ctrl+F1 through F12', ref: 'Set fret 11-22', verdict: 'omit', ev: ev('F3', { ctrl: true }), cmd: null },
    { eof: 'Ctrl++ / Ctrl+-', ref: 'Increment/decrement fret', verdict: 'match', ev: ev('+', { ctrl: true }), cmd: 'fretUp' },
    // ── brackets / punctuation ───────────────────────────────────────
    { eof: '[ and ]', ref: 'Adjust sustain by grid snap', verdict: 'match', ev: ev('['), cmd: 'shortenSustain' },
    { eof: ', and .', ref: 'Increase/decrease grid snap', verdict: 'match', ev: ev(','), cmd: 'snapDown' },
    { eof: "; and '", ref: 'Playback speed', verdict: 'omit', ev: ev(';'), cmd: null },
    // ── function keys ────────────────────────────────────────────────
    { eof: 'F1', ref: 'Help', verdict: 'match', ev: ev('F1'), cmd: 'showShortcutHelp' },
    { eof: 'F2', ref: 'Save', verdict: 'match', ev: ev('F2'), cmd: 'save' },
    { eof: 'F3 / Shift+F3', ref: 'Fret catalog seek', verdict: 'omit', ev: ev('F3'), cmd: null },
    { eof: 'F4', ref: 'Tech note view', verdict: 'omit', ev: ev('F4'), cmd: null },
    { eof: 'F5', ref: 'Toggle waveform graph', verdict: 'match', ev: ev('F5'), cmd: 'toggleWaveform' },
    { eof: 'F6', ref: 'Import Midi', verdict: 'match', ev: ev('F6'), cmd: 'importMidi' },
    { eof: 'F7', ref: 'Import arrangement XML', verdict: 'match', ev: ev('F7'), cmd: 'importXml' },
    { eof: 'F8', ref: 'Fingering view', verdict: 'omit', ev: ev('F8'), cmd: null },
    { eof: 'Shift+F8', ref: 'Import lyrics', verdict: 'omit', ev: ev('F8', { shift: true }), cmd: null },
    { eof: 'F9', ref: 'Song properties', verdict: 'omit', ev: ev('F9'), cmd: null },
    { eof: 'F10', ref: 'EOF settings', verdict: 'omit', ev: ev('F10'), cmd: null },
    { eof: 'F11', ref: 'Properties', verdict: 'omit', ev: ev('F11'), cmd: null },
    { eof: 'F12', ref: 'Import GP', verdict: 'match', ev: ev('F12'), cmd: 'importGp' },
];

t('every reference line resolves to its pinned verdict', () => {
    const failures = [];
    for (const row of EOF_REFERENCE) {
        if (!row.ev) continue;                      // global: outside the resolvers
        const got = api._editorEofCommandForKeyPure(row.ev, 'note');
        if (got !== row.cmd) failures.push(`${row.eof} (${row.verdict}): expected ${row.cmd}, got ${got}`);
    }
    assert.deepStrictEqual(failures, [], failures.join('; '));
});

t('every adapt verdict is surfaced in PROFILE_DIVERGENCES', () => {
    // An adaptation that isn't in the divergence map renders as a silent match
    // in the shortcut panel — the exact "quiet surprise" the policy forbids.
    const surfaced = new Set(Object.keys(api.PROFILE_DIVERGENCES.eof));
    const missing = EOF_REFERENCE
        .filter(r => r.verdict === 'adapt' && r.cmd)
        .map(r => r.cmd.split(':')[0])
        .filter(id => !surfaced.has(id));
    assert.deepStrictEqual([...new Set(missing)], []);
});

t('every divergence entry points at a real registry command', () => {
    for (const [profile, entries] of Object.entries(api.PROFILE_DIVERGENCES)) {
        for (const id of Object.keys(entries)) {
            assert.ok(api._editorCommandById(id), `${profile} divergence names unknown command ${id}`);
        }
    }
});

t('omitted reference keys stay free (no silent squatting)', () => {
    for (const row of EOF_REFERENCE) {
        if (row.verdict !== 'omit' || !row.ev) continue;
        assert.strictEqual(api._editorEofCommandForKeyPure(row.ev, 'note'), null,
            `${row.eof} should stay free (EOF: ${row.ref})`);
    }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
