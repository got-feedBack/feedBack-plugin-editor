/* Slopsmith Arrangement Editor — GM guide voices (DAW workspace 1.2/1.5).
 *
 * A pitched alternative to the guide CLAP: during playback the charted notes
 * of the current part can sound as a real General-MIDI instrument (rendered
 * WebAudioFont presets of the MIT-licensed FluidR3_GM soundfont), so a
 * charter hears the pitches they placed, not just their timing. The clap
 * remains the default and the permanent fallback — while a preset is still
 * loading (or can't load at all), the guide claps rather than going silent.
 *
 * Asset sourcing is a CHAIN, not a single origin (all three deliberately):
 *   1. `plugin` — this plugin's own `/api/plugins/editor/wafont/` route,
 *      serving files vendored under `assets/wafonts/` (the Virtuoso idiom:
 *      no runtime CDN dependency once assets are committed; see
 *      assets/wafonts/README.md for the provenance contract — FluidR3 only).
 *   2. `org` — an org-hosted base URL (editor-pref `editorGmVoiceBase`,
 *      e.g. a feedback-soundfonts release/pages URL once it hosts
 *      WebAudioFont-format renders). Skipped while the pref is empty.
 *   3. `cdn` — the upstream WebAudioFont CDN (surikov.github.io), the same
 *      origin core's drum_highway_3d and the piano plugin already lazy-load
 *      from today.
 * The order pref `editorGmVoiceSource` is 'auto' (the chain above) or a
 * single pinned source. Every asset is fetched lazily on first use; nothing
 * loads until the user switches the guide voice to Instrument.
 *
 * Voice choice (1.5) is per part KIND — keys / bass / guitar (drums keep
 * their clap; the drum strip owns drum sounds) — stored as editor prefs
 * (`editorGmVoice:<kind>`), never the pack. Kind inference mirrors the
 * repo rule: KEYS_PATTERN (start-anchored) > /bass/i > guitar.
 *
 * This module is deliberately a leaf over state/keys: the audio scheduler
 * (src/audio.js) passes in the AudioContext and the guide bus, so no
 * audio↔gm-guide import cycle exists, and everything degrades inert under
 * node (that's how the unit tests run).
 */

import { KEYS_PATTERN } from './keys.js';
import { setStatus } from './ui.js';

/* @pure:gm-guide:start */
export const GM_SOUNDFONT = 'FluidR3_GM_sf2_file';
export const GM_CDN_BASE = 'https://surikov.github.io/webaudiofontdata/sound/';
export const GM_CDN_PLAYER = 'https://surikov.github.io/webaudiofont/npm/dist/WebAudioFontPlayer.js';
export const GM_PLUGIN_BASE = '/api/plugins/editor/wafont/';
export const GM_PLAYER_FILE = 'WebAudioFontPlayer.js';

// Per-kind defaults and the curated picker rows (1.5). Labels are generic
// GM program names. Any 0–127 program a pref carries is honored — the
// curated lists are the menu surface, not a validation whitelist.
export const GM_KIND_DEFAULTS = Object.freeze({ guitar: 27, bass: 33, keys: 0 });
export const GM_VOICE_CHOICES = Object.freeze({
    guitar: Object.freeze([
        { gm: 27, label: 'Clean electric' },
        { gm: 26, label: 'Jazz electric' },
        { gm: 25, label: 'Steel acoustic' },
        { gm: 24, label: 'Nylon acoustic' },
        { gm: 28, label: 'Muted electric' },
    ]),
    bass: Object.freeze([
        { gm: 33, label: 'Fingered' },
        { gm: 34, label: 'Picked' },
        { gm: 32, label: 'Acoustic upright' },
        { gm: 38, label: 'Synth' },
    ]),
    keys: Object.freeze([
        { gm: 0, label: 'Grand piano' },
        { gm: 4, label: 'Electric piano' },
        { gm: 19, label: 'Church organ' },
        { gm: 48, label: 'Strings' },
    ]),
});

// Part kind for guide-voice purposes. Mirrors the repo's kind-inference
// rule (keys > drums > bass > guitar) minus drums: the drum grid is a
// separate edit mode (S.drumEditMode) that never reaches this path.
export function _gmKindPure(arrName) {
    const name = typeof arrName === 'string' ? arrName : '';
    if (KEYS_PATTERN.test(name)) return 'keys';
    if (/bass/i.test(name)) return 'bass';
    return 'guitar';
}

// WebAudioFont file/global naming (the piano-plugin grammar): program 27 →
// `0270_FluidR3_GM_sf2_file.js` defining `_tone_0270_FluidR3_GM_sf2_file`.
export function _gmFilePure(gm) {
    // Explicit null/''/boolean guard: Number(null) is 0 and Number(true) is
    // 1 — silent coercions that would name a REAL (wrong) preset file.
    if (gm === null || gm === '' || typeof gm === 'boolean') return null;
    const n = Number(gm);
    if (!Number.isInteger(n) || n < 0 || n > 127) return null;
    return String(n * 10).padStart(4, '0') + '_' + GM_SOUNDFONT + '.js';
}
export function _gmVarPure(gm) {
    const file = _gmFilePure(gm);
    return file ? '_tone_' + file.slice(0, -3) : null;
}

// Source order: 'auto' walks plugin → org → cdn; a valid pinned source is
// honored alone; garbage degrades to auto (never to silence).
export function _gmSourceOrderPure(sourcePref) {
    if (sourcePref === 'plugin' || sourcePref === 'org' || sourcePref === 'cdn') {
        return [sourcePref];
    }
    return ['plugin', 'org', 'cdn'];
}

// URL for one asset from one source. `null` = this source can't serve it
// (org with no base configured) — the chain moves on. The org base gets a
// single trailing slash so a pasted URL works with or without one.
export function _gmUrlForSourcePure(source, fileName, orgBase) {
    if (typeof fileName !== 'string' || !fileName) return null;
    if (source === 'plugin') return GM_PLUGIN_BASE + fileName;
    if (source === 'cdn') {
        return fileName === GM_PLAYER_FILE ? GM_CDN_PLAYER : GM_CDN_BASE + fileName;
    }
    if (source === 'org') {
        const base = typeof orgBase === 'string' ? orgBase.trim() : '';
        if (!/^https?:\/\//i.test(base)) return null;
        return base.replace(/\/+$/, '') + '/' + fileName;
    }
    return null;
}

// The effective GM program for a kind: an integer 0–127 pref wins, else the
// kind default; an unknown kind is null (→ the guide claps).
export function _gmVoiceForKindPure(rawPref, kind) {
    if (!Object.prototype.hasOwnProperty.call(GM_KIND_DEFAULTS, kind)) return null;
    // Number, not parseInt: parseInt('127.5') silently truncates to a
    // "valid" program. Same null/''/boolean coercion guard as _gmFilePure.
    if (rawPref === null || rawPref === undefined || typeof rawPref === 'boolean') {
        return GM_KIND_DEFAULTS[kind];
    }
    const s = typeof rawPref === 'string' ? rawPref.trim() : rawPref;
    if (s === '') return GM_KIND_DEFAULTS[kind];
    const n = Number(s);
    if (Number.isInteger(n) && n >= 0 && n <= 127) return n;
    return GM_KIND_DEFAULTS[kind];
}

// Guide-voice mode pref: 'clap' (default) or 'gm'; garbage reads as clap.
export function _gmGuideModePure(raw) {
    return raw === 'gm' ? 'gm' : 'clap';
}

// Sanitize raw pitched events before the window query: finite times, MIDI
// clamped-out (not clamped-in — a wrong octave is worse than silence),
// sorted by time. Matches _guideSanitizeTimesPure's contract for the claps.
export function _gmSanitizeEventsPure(events) {
    if (!Array.isArray(events)) return [];
    return events
        .filter(e => e && Number.isFinite(e.t)
            && Number.isInteger(e.midi) && e.midi >= 0 && e.midi <= 127)
        .sort((a, b) => a.t - b.t);
}

// Half-open window query over SORTED pitched events, grouped into 1 ms
// buckets (the clap dedupe resolution): each bucket sounds ONCE with up to
// `cap` DISTINCT pitches (a chord is a chord, not N stacked transients of
// one tick — but also never an unlimited voice fan-out). Extra chord notes
// beyond the cap drop deterministically (input order). Each voice keeps its
// own sustain so a chord of mixed lengths rings honestly.
export function _gmEventsInWindowPure(events, from, to, cap) {
    if (!Array.isArray(events) || !events.length || !(to > from)) return [];
    const lim = Number.isInteger(cap) && cap > 0 ? cap : 4;
    let lo = 0, hi = events.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (events[mid].t < from) lo = mid + 1; else hi = mid;
    }
    const out = [];
    let bucket = null, key = null;
    for (let i = lo; i < events.length && events[i].t < to; i++) {
        const e = events[i];
        const k = Math.round(e.t * 1000);
        if (k !== key) {
            key = k;
            bucket = { t: e.t, key: k, voices: [{ midi: e.midi, sus: e.sus }] };
            out.push(bucket);
        } else if (bucket.voices.length < lim
                && !bucket.voices.some(v => v.midi === e.midi)) {
            bucket.voices.push({ midi: e.midi, sus: e.sus });
        }
    }
    return out;
}

// Voice duration from a note's sustain: audible-but-brief for staccato
// placements, capped so long sustains can't stack dozens of ringing voices
// into the lookahead window.
export function _gmVoiceDurationPure(sustain) {
    const s = Number(sustain);
    if (!Number.isFinite(s) || s <= 0) return 0.35;
    return Math.min(s, 1.6);
}
/* @pure:gm-guide:end */

// ── Prefs (editor-side, never the pack) ───────────────────────────────

export function editorGmSource() {
    let raw = null;
    try { raw = localStorage.getItem('editorGmVoiceSource'); } catch (_) {}
    return _gmSourceOrderPure(raw).length === 1 ? raw : 'auto';
}
export function editorGmOrgBase() {
    try { return localStorage.getItem('editorGmVoiceBase') || ''; } catch (_) { return ''; }
}
export function editorGmVoiceFor(kind) {
    let raw = null;
    try { raw = localStorage.getItem('editorGmVoice:' + kind); } catch (_) {}
    return _gmVoiceForKindPure(raw, kind);
}
export function editorSetGmVoice(kind, gm) {
    const program = _gmVoiceForKindPure(gm, kind);
    if (program === null) return;
    try { localStorage.setItem('editorGmVoice:' + kind, String(program)); } catch (_) {}
    _presetError = '';   // a new choice deserves a fresh load attempt
    const row = (GM_VOICE_CHOICES[kind] || []).find(c => c.gm === program);
    setStatus(`Guide instrument (${kind}): ${row ? row.label : 'GM ' + program}`);
}

// ── Loader (lazy; script-tag, module-level caches survive re-injection) ──

let _player = null;              // WebAudioFontPlayer instance
let _playerLoading = null;       // in-flight player promise
const _presets = new Map();      // gm program -> adjusted preset
const _presetLoading = new Map();// gm program -> in-flight promise
let _presetError = '';           // last failure, surfaced once in the status

function _loadScript(url) {
    return new Promise((resolve, reject) => {
        if (typeof document === 'undefined') { reject(new Error('no DOM')); return; }
        const existing = document.querySelector(`script[data-gm-src="${url}"]`);
        if (existing) {
            if (existing.dataset.gmDone === '1') { resolve(); return; }
            existing.addEventListener('load', () => resolve());
            existing.addEventListener('error', () => reject(new Error('load failed ' + url)));
            return;
        }
        const s = document.createElement('script');
        s.src = url;
        s.dataset.gmSrc = url;
        s.onload = () => { s.dataset.gmDone = '1'; resolve(); };
        s.onerror = () => { s.remove(); reject(new Error('load failed ' + url)); };
        document.head.appendChild(s);
    });
}

// Walk the source chain until one origin serves the file AND the expected
// global appears. `varName` null = the player script (global class check).
async function _loadFromChain(fileName, varName) {
    const orgBase = editorGmOrgBase();
    for (const source of _gmSourceOrderPure(editorGmSource())) {
        const url = _gmUrlForSourcePure(source, fileName, orgBase);
        if (!url) continue;
        try {
            await _loadScript(url);
            const got = varName ? window[varName] : window.WebAudioFontPlayer;
            if (got) return got;
        } catch (_) { /* next source */ }
    }
    return null;
}

async function _ensurePlayer() {
    if (_player) return _player;
    if (!_playerLoading) {
        _playerLoading = _loadFromChain(GM_PLAYER_FILE, null).then((Cls) => {
            _playerLoading = null;
            if (Cls) _player = new Cls();
            return _player;
        });
    }
    return _playerLoading;
}

export function gmPresetReady(gm) { return _presets.has(gm); }

// Kick (or await) the load of one GM program. Fire-and-forget from the
// scheduler tick — the tick claps until gmPresetReady flips, so a slow or
// failed load is audible as claps, never as silence.
export function ensureGmPreset(gm, ctx) {
    if (_presets.has(gm) || _presetLoading.has(gm)) return _presetLoading.get(gm) || Promise.resolve();
    const file = _gmFilePure(gm), varName = _gmVarPure(gm);
    if (!file || !ctx) return Promise.resolve();
    const p = (async () => {
        try {
            const player = await _ensurePlayer();
            if (!player) throw new Error('WebAudioFontPlayer unavailable');
            const preset = await _loadFromChain(file, varName);
            if (!preset) throw new Error('no source served ' + file);
            player.adjustPreset(ctx, preset);
            _presets.set(gm, preset);
            setStatus('Guide instrument ready');
        } catch (e) {
            if (!_presetError) {
                _presetError = String(e && e.message || e);
                setStatus('Guide instrument unavailable (still clapping) — ' + _presetError);
            }
        } finally {
            _presetLoading.delete(gm);
        }
    })();
    _presetLoading.set(gm, p);
    return p;
}

// Schedule one pitched voice through the caller's bus (audio.js passes the
// guide gain, so the mixer fader + limiter apply). Returns a cancel adapter
// shaped like the clap bookkeeping ({osc.stop, gain.disconnect}) or null
// when not ready — the caller claps instead.
export function gmVoiceAt(ctx, target, gm, when, midi, durSec) {
    const preset = _presets.get(gm);
    if (!preset || !_player || !ctx || !target) return null;
    let env = null;
    try {
        env = _player.queueWaveTable(ctx, target, preset, when, midi, durSec, 0.5);
    } catch (_) { return null; }
    return {
        osc: { stop() { try { env.cancel(); } catch (_) {} } },
        gain: { disconnect() {} },
        until: when + durSec,
    };
}

// Test seam: drop the module caches so suites can exercise cold paths.
export function _resetGmGuideForTest() {
    _player = null; _playerLoading = null;
    _presets.clear(); _presetLoading.clear();
    _presetError = '';
}
