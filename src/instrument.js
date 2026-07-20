// ════════════════════════════════════════════════════════════════════
// Instrument identity — a track's INSTRUMENT TYPE as first-class DATA.
//
// Historically the editor inferred a part's instrument from its NAME, in a
// dozen places with subtly different rules — the runtime prefix test
// (`/^(keys|piano|…)/`) vs the save-side word-boundary test — the very
// disagreement the rename guard exists to band-aid ("Electric Piano" reads
// runtime-guitar but save-keys). This module is the seam that makes identity
// first-class: when an arrangement carries an authored `type` (the feedpak-spec
// §5.2 manifest facet, which the backend already persists and never clobbers),
// it WINS; name inference stays only as the fallback for untyped/legacy packs.
//
// The format writes "piano" for the keys family and (today) leaves drums/vocals
// as side-files (type ""); this canonicalizes the manifest vocabulary to the
// editor's runtime kinds and accepts the plural set the multitrack work
// (drums-as-arrangements, vocals) grows into. Leaf module (imports nothing from
// src/) so keys.js / lanes.js / arrangement.js consult it without closing a cycle.
//
// Deliberately NOT touched yet: the ~30 other name-inference sites and the
// rename guard still key off the name. Relaxing them is only safe once every
// identity reader consults `type`; this PR converts the load-bearing keys/bass
// DATA + view predicates and leaves the rest to follow behind the same seam.
// ════════════════════════════════════════════════════════════════════

// Manifest `type` value (any case/whitespace) → the editor's runtime instrument
// kind, or null when the type is absent / blank / unrecognized (the caller then
// falls back to its own name inference, so an untyped pack is byte-identical).
// piano/keyboard/synth fold into keys; lead/rhythm are guitar; drum & vocal
// synonyms are accepted ahead of their arrangement-native support landing.
const _TYPE_KIND = {
    keys: 'keys', piano: 'keys', keyboard: 'keys', synth: 'keys',
    bass: 'bass',
    guitar: 'guitar', lead: 'guitar', rhythm: 'guitar',
    drums: 'drums', drum: 'drums',
    vocals: 'vocals', vocal: 'vocals', voice: 'vocals',
};

export function _typeKind(rawType) {
    if (typeof rawType !== 'string') return null;
    const t = rawType.trim().toLowerCase();
    return (t && Object.prototype.hasOwnProperty.call(_TYPE_KIND, t)) ? _TYPE_KIND[t] : null;
}

// The authored instrument kind of an arrangement, or null when it is untyped
// (caller falls back to name inference). The one place a `type` facet is read.
export function _arrTypeKind(arr) {
    return _typeKind(arr && arr.type);
}

// The keys-family name matcher (prefix-anchored): arrangements whose name STARTS
// with keys/piano/keyboard/synth open as piano-roll charts. Its canonical home
// is this leaf so the whole name→kind fallback lives in one place; keys.js
// re-exports it for the many sites that import KEYS_PATTERN from there.
export const KEYS_PATTERN = /^(keys|piano|keyboard|synth)/i;

// The runtime instrument kind inferred from a NAME — the legacy fallback for an
// untyped track. Prefix-anchored keys/drums, then /bass/ anywhere, else guitar;
// keys is tested before bass (so "Synth Bass" reads keys). This is now the ONE
// name-inference implementation — arrangement.js `_arrKindPure` delegates here.
export function _arrKindFromName(name) {
    const n = String(name || '');
    if (KEYS_PATTERN.test(n)) return 'keys';
    if (/^drums/i.test(n)) return 'drums';
    if (/bass/i.test(n)) return 'bass';
    return 'guitar';
}

// The canonical instrument kind of an arrangement: an authored `type` WINS
// (identity is DATA), else name inference. The type-authoritative resolver the
// Tracks-view badge, the remaining view/routing sites, and drums-as-arrangements
// read — so identity is decided in exactly one place.
export function arrKind(arr) {
    return _arrTypeKind(arr) || _arrKindFromName(arr && arr.name);
}

// Bass predicate — type-authoritative, but its NAME fallback stays the INDEPENDENT
// `/bass/` test, NOT `arrKind === 'bass'`. Bass and keys are independent facets in
// the legacy inference ("Synth Bass" is bass for string-count AND keys for the
// view), so the single-kind `arrKind` (keys wins) would wrongly flip a "Synth
// Bass" from a 4-string baseline to 6. Every string-count / open-tuning site that
// used `/bass/i.test(arr.name)` must route through here to stay byte-identical.
export function _isBassArr(arr) {
    const k = _arrTypeKind(arr);
    return k ? k === 'bass' : /bass/i.test((arr && arr.name) || '');
}
