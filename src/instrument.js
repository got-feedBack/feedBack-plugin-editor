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
