/* Slopsmith Arrangement Editor — keyboard shortcuts & pointer behaviour.
 *
 * The four shortcut profiles (FeedBack native / Logical / Cableton / EOF
 * legacy), the key→command mapping for each, the two pointer behaviours that
 * ride on the profile (right-click = context-menu vs EOF add/remove; chord
 * click = select the single note vs the whole strum), their localStorage
 * persistence, and the shortcut-panel renderer.
 *
 * `editorShortcutProfile`, `editorRightClickBehavior`, and
 * `editorChordSelectBehavior` are `export let`: they are reassigned, but every
 * writer lives here (the `editorSet*` setters and the loader), so importers
 * read them as live, read-only bindings — no container, and main.js's read
 * sites are untouched.
 */

import { setStatus } from './ui.js';

const EDITOR_SHORTCUT_PROFILE_KEY = 'editor.shortcutProfile';
const EDITOR_RIGHT_CLICK_BEHAVIOR_KEY = 'editor.rightClickBehavior';
const EDITOR_CHORD_SELECT_KEY = 'editor.chordSelect';
// Four profiles. 'feedback' and 'eof' keep their battle-tested hand resolvers;
// 'logical' (Logic-style) and 'cableton' (Ableton-style) are DELTAS over the
// FeedBack resolver (EDITOR_PROFILE_OVERRIDES below): an override wins, and a
// key it doesn't claim falls back to its FeedBack meaning — so the DAW
// muscle-memory keys land where a Logic / Live user expects while every
// editor-specific command keeps working. 'eof' keeps its internal id for
// localStorage compat; the UI shows it as "Legacy (EOF)".
const EDITOR_SHORTCUT_PROFILES = new Set(['feedback', 'logical', 'cableton', 'eof']);
export const EDITOR_PROFILE_NAMES = Object.freeze({
    feedback: 'FeedBack',
    logical: 'Logical (Logic-style)',
    cableton: 'Cableton (Ableton-style)',
    eof: 'Legacy (EOF)',
});
// Extended by the click-tools system (CLICK-TOOLS-DESIGN.md): the right
// button can also run any non-pointer tool's click action, giving left and
// right click feature parity. tools.js owns the 'tool:<id>' validation; this
// set gates what the panel <select> may persist.
const EDITOR_RIGHT_CLICK_BEHAVIORS = new Set([
    'context', 'eofEdit',
    'tool:pencil', 'tool:eraser', 'tool:marquee', 'tool:mute', 'tool:scissors',
]);
// Chord-click selection: does clicking one note of a same-time chord select
// just that note ('single', DAW-style) or the whole strum ('chord', EOF-style)?
// Like the right-click behaviour it defaults from the profile and can be pinned.
const EDITOR_CHORD_SELECT_BEHAVIORS = new Set(['single', 'chord']);
export let editorShortcutProfile = 'feedback';
export let editorRightClickBehavior = null;
export let editorChordSelectBehavior = null;

export function _editorKeySigPure(e) {
    const mods = [];
    if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
    if (e.shiftKey) mods.push('Shift');
    if (e.altKey) mods.push('Alt');
    let key = e.key || '';
    if (key.length === 1) key = key.toUpperCase();
    return mods.concat(key).join('+');
}

const EDITOR_SHORTCUT_COMMANDS = Object.freeze([
    { id: 'save', label: 'Save project', group: 'File', status: 'ready', keys: { feedback: 'Ctrl+S', eof: 'F2 / Ctrl+S' } },
    { id: 'toggleWaveform', label: 'Show/hide waveform', group: 'View', status: 'ready', keys: { feedback: 'W', eof: 'F5' } },
    { id: 'toggleGuideClap', label: 'Toggle guide voices', group: 'Preview', status: 'ready', keys: { feedback: 'C', logical: 'Ctrl+Shift+C', eof: 'C' } },
    { id: 'toggleMetronome', label: 'Toggle metronome click', group: 'Preview', status: 'ready', keys: { feedback: '', logical: 'K', cableton: 'O', eof: '' } },
    { id: 'toggleMixer', label: 'Toggle Mixer panel', group: 'Preview', status: 'ready', keys: { feedback: 'Shift+C', eof: 'Shift+C' } },
    { id: 'togglePlayAllTracks', label: 'Play all tracks (band mode)', group: 'Preview', status: 'ready', keys: { feedback: '', eof: '' } },
    { id: 'manageStemTracks', label: 'Audio tracks (import / pair stems)', group: 'Preview', status: 'ready', keys: { feedback: '', eof: '' } },
    { id: 'soloMyStem', label: 'Solo my source track (paired stem)', group: 'Preview', status: 'ready', keys: { feedback: '', eof: '' } },
    { id: 'toggleLoopAB', label: 'Toggle loop A/B compare (recording ↔ guide)', group: 'Preview', status: 'ready', keys: { feedback: 'Alt+B', eof: 'Alt+B' } },
    { id: 'toggleLoopRegion', label: 'Toggle loop playback for the selected region', group: 'Preview', status: 'ready', keys: { feedback: '', logical: 'C', cableton: 'Ctrl+L', eof: '' } },
    { id: 'songFit', label: 'Song Fit — line the chart up with the recording', group: 'Tempo map', status: 'ready', keys: { feedback: '', eof: '' } },
    { id: 'toggleOnsetStrip', label: 'Toggle onset detection strip', group: 'View', status: 'ready', keys: { feedback: 'Shift+W', eof: 'Shift+W' } },
    { id: 'togglePartsView', label: 'Toggle Tracks overview', group: 'View', status: 'ready', keys: { feedback: 'Shift+A', eof: 'Shift+A' } },
    { id: 'toggleKeyHighlight', label: 'Toggle in-key highlight', group: 'View', status: 'ready', keys: { feedback: '', eof: '' } },
    { id: 'cycleViewMode', label: 'Cycle track view (String / Piano roll)', group: 'View', status: 'ready', keys: { feedback: '', eof: '' } },
    { id: 'showTabPreview', label: 'Preview track as tab (read-only, saved pack)', group: 'View', status: 'ready', keys: { feedback: '', eof: '' } },
    { id: 'toggleTabView', label: 'Tab view (live engraving of the current track)', group: 'View', status: 'ready', keys: { feedback: '', eof: '' } },
    { id: 'toggleDrumDensity', label: 'Cycle drum row density (Full / Compact / GM roll)', group: 'View', status: 'ready', keys: { feedback: '', eof: '' } },
    { id: 'toggleFollow', label: 'Toggle follow playhead', group: 'View', status: 'ready', keys: { feedback: 'Shift+L', cableton: 'Ctrl+Shift+F', eof: '' } },
    { id: 'toggleScrollInPlay', label: 'Toggle scroll in play (continuous follow)', group: 'View', status: 'ready', keys: { feedback: '', eof: '' } },
    { id: 'renamePart', label: 'Rename current track', group: 'Structure', status: 'ready', keys: { feedback: '', eof: '' } },
    { id: 'movePartEarlier', label: 'Move current track earlier', group: 'Structure', status: 'ready', keys: { feedback: '', eof: '' } },
    { id: 'movePartLater', label: 'Move current track later', group: 'Structure', status: 'ready', keys: { feedback: '', eof: '' } },
    { id: 'showShortcutHelp', label: 'Show shortcut help', group: 'View', status: 'ready', keys: { feedback: '?', eof: 'F1 / ?' } },
    { id: 'openCommandPalette', label: 'Open command palette', group: 'View', status: 'ready', keys: { feedback: 'Ctrl+K', eof: 'Ctrl+K' } },
    { id: 'importMidi', label: 'Import MIDI / keys', group: 'File', status: 'ready', keys: { feedback: '', eof: 'F6' } },
    { id: 'importXml', label: 'Import XML source', group: 'File', status: 'ready', keys: { feedback: '', eof: 'F7' } },
    { id: 'importGp', label: 'Import Guitar Pro source', group: 'File', status: 'ready', keys: { feedback: '', eof: 'F12' } },
    { id: 'exportGp5', label: 'Export track as Guitar Pro (.gp5)', group: 'File', status: 'ready', keys: { feedback: '', eof: '' } },
    { id: 'prevBeat', label: 'Jump to previous beat', group: 'Timeline', status: 'ready', keys: { feedback: 'Page Up', logical: ',', eof: 'Page Up' } },
    { id: 'nextBeat', label: 'Jump to next beat', group: 'Timeline', status: 'ready', keys: { feedback: 'Page Down', logical: '.', eof: 'Page Down' } },
    { id: 'prevNote', label: 'Jump to previous note', group: 'Timeline', status: 'ready', keys: { feedback: 'Alt+Left', eof: 'Shift+Page Up' } },
    { id: 'nextNote', label: 'Jump to next note', group: 'Timeline', status: 'ready', keys: { feedback: 'Alt+Right', eof: 'Shift+Page Down' } },
    { id: 'nudgeTimeLeft', label: 'Nudge selection earlier one step (playhead when nothing selected)', group: 'Timeline', status: 'ready', keys: { feedback: 'Left', eof: 'Left' } },
    { id: 'nudgeTimeRight', label: 'Nudge selection later one step (playhead when nothing selected)', group: 'Timeline', status: 'ready', keys: { feedback: 'Right', eof: 'Right' } },
    { id: 'prevGrid', label: 'Jump to previous grid line', group: 'Timeline', status: 'ready', keys: { feedback: 'Ctrl+Page Up', eof: 'Ctrl+Shift+Page Up' } },
    { id: 'nextGrid', label: 'Jump to next grid line', group: 'Timeline', status: 'ready', keys: { feedback: 'Ctrl+Page Down', eof: 'Ctrl+Shift+Page Down' } },
    { id: 'prevAnchor', label: 'Jump to previous anchor', group: 'Timeline', status: 'ready', keys: { feedback: 'Ctrl+Alt+Left', eof: 'Alt+Page Up' } },
    { id: 'nextAnchor', label: 'Jump to next anchor', group: 'Timeline', status: 'ready', keys: { feedback: 'Ctrl+Alt+Right', eof: 'Alt+Page Down' } },
    { id: 'gotoBookmarkDigit', label: 'Jump to bookmark 1-9', group: 'Timeline', status: 'ready', keys: { feedback: 'Alt+1-9', eof: 'Numpad 1-9 / Alt+1-9' } },
    { id: 'setBookmarkDigit', label: 'Set / clear bookmark 1-9 at cursor', group: 'Timeline', status: 'ready', keys: { feedback: 'Shift+Alt+1-9', eof: 'Ctrl+Numpad 1-9 / Shift+Alt+1-9' } },
    { id: 'shortenSustain', label: 'Shorten selected sustain', group: 'Grid and sustain', status: 'ready', keys: { feedback: '[', eof: '[' } },
    { id: 'lengthenSustain', label: 'Lengthen selected sustain', group: 'Grid and sustain', status: 'ready', keys: { feedback: ']', eof: ']' } },
    { id: 'toggleSnap', label: 'Toggle snap on/off', group: 'Grid and sustain', status: 'ready', keys: { feedback: 'G', logical: 'Shift+G', cableton: 'Ctrl+4', eof: '' } },
    { id: 'snapDown', label: 'Decrease snap resolution', group: 'Grid and sustain', status: 'ready', keys: { feedback: ',', logical: 'Ctrl+,', cableton: 'Ctrl+2', eof: ',' } },
    { id: 'snapUp', label: 'Increase snap resolution', group: 'Grid and sustain', status: 'ready', keys: { feedback: '.', logical: 'Ctrl+.', cableton: 'Ctrl+1', eof: '.' } },
    { id: 'toggleSnapMode', label: 'Toggle snap target (grid / audio onset)', group: 'Grid and sustain', status: 'ready', keys: { feedback: '', eof: '' } },
    { id: 'editFret', label: 'Edit fret / fingering', group: 'Notes', status: 'ready', keys: { feedback: 'F', eof: 'F / Ctrl+F' } },
    { id: 'suggestFingers', label: 'Suggest fret-hand fingers', group: 'Notes', status: 'ready', keys: { feedback: '', eof: '' } },
    { id: 'setFretDigit', label: 'Set selected fret 0-9', group: 'Notes', status: 'ready', keys: { feedback: '0-9', eof: '0-9 / Ctrl+1-9' } },
    { id: 'setFretTen', label: 'Set selected fret 10', group: 'Notes', status: 'ready', keys: { feedback: 'Shift+0', eof: 'Shift+0 / Ctrl+0' } },
    { id: 'noteMenu', label: 'Open note edit menu', group: 'Notes', status: 'ready', keys: { feedback: '', eof: 'N' } },
    { id: 'bend', label: 'Edit bend', group: 'Notes', status: 'ready', keys: { feedback: 'B', cableton: 'Ctrl+B', eof: 'Ctrl+B' } },
    { id: 'slideEditor', label: 'Edit pitched slide', group: 'Notes', status: 'ready', keys: { feedback: 'S', eof: 'S' } },
    { id: 'unpitchedSlide', label: 'Edit unpitched slide', group: 'Notes', status: 'ready', keys: { feedback: 'U', eof: 'Ctrl+U' } },
    { id: 'moveStringUp', label: 'Move selection up one string', group: 'Notes', status: 'ready', keys: { feedback: 'Up', eof: 'Up' } },
    { id: 'moveStringDown', label: 'Move selection down one string', group: 'Notes', status: 'ready', keys: { feedback: 'Down', eof: 'Down' } },
    { id: 'transposeStringUp', label: 'Move selection up preserving pitch (cycles positions in the roll)', group: 'Notes', status: 'ready', keys: { feedback: 'Shift+Up', eof: 'Shift+Up' } },
    { id: 'transposeStringDown', label: 'Move selection down preserving pitch (cycles positions in the roll)', group: 'Notes', status: 'ready', keys: { feedback: 'Shift+Down', eof: 'Shift+Down' } },
    { id: 'slideUp', label: 'Pitched slide up', group: 'Notes', status: 'ready', keys: { feedback: 'Ctrl+Up', eof: 'Ctrl+Up' } },
    { id: 'slideDown', label: 'Pitched slide down', group: 'Notes', status: 'ready', keys: { feedback: 'Ctrl+Down', eof: 'Ctrl+Down' } },
    { id: 'toggleHammerOn', label: 'Toggle hammer-on', group: 'Techniques', status: 'ready', keys: { feedback: 'H', eof: 'H' } },
    { id: 'togglePullOff', label: 'Toggle pull-off', group: 'Techniques', status: 'ready', keys: { feedback: 'P', eof: 'P' } },
    { id: 'toggleTap', label: 'Toggle tap', group: 'Techniques', status: 'ready', keys: { feedback: 'Y', eof: 'Ctrl+T' } },
    { id: 'togglePinchHarmonic', label: 'Toggle pinch harmonic', group: 'Techniques', status: 'ready', keys: { feedback: 'Shift+N', eof: 'Shift+H' } },
    { id: 'toggleNaturalHarmonic', label: 'Toggle natural harmonic', group: 'Techniques', status: 'ready', keys: { feedback: 'N', eof: 'Ctrl+H' } },
    { id: 'togglePalmMute', label: 'Toggle palm mute', group: 'Techniques', status: 'ready', keys: { feedback: 'M', eof: 'Ctrl+M' } },
    { id: 'toggleMuteOpen', label: 'Mute and set fret open', group: 'Techniques', status: 'ready', keys: { feedback: 'X', eof: 'Ctrl+X' } },
    { id: 'toggleMuteRetain', label: 'Mute and retain fret', group: 'Techniques', status: 'ready', keys: { feedback: 'Shift+X', eof: 'Shift+X' } },
    { id: 'toggleVibrato', label: 'Toggle vibrato', group: 'Techniques', status: 'ready', keys: { feedback: 'V', eof: 'Shift+V' } },
    { id: 'toggleLinkNext', label: 'Toggle link-next', group: 'Techniques', status: 'ready', keys: { feedback: '', eof: 'Shift+N' } },
    { id: 'toggleAccent', label: 'Toggle accent', group: 'Techniques', status: 'ready', keys: { feedback: 'A', eof: 'Ctrl+Shift+A' } },
    { id: 'toggleIgnore', label: 'Toggle ignore', group: 'Techniques', status: 'ready', keys: { feedback: 'Ctrl+Shift+I', eof: 'Ctrl+Shift+I' } },
    { id: 'toggleTremolo', label: 'Toggle tremolo', group: 'Techniques', status: 'ready', keys: { feedback: 'Ctrl+Shift+O', eof: 'Ctrl+Shift+O' } },
    { id: 'togglePop', label: 'Toggle pop / pluck', group: 'Techniques', status: 'ready', keys: { feedback: 'O', cableton: 'Ctrl+Shift+P', eof: 'Ctrl+Shift+P' } },
    { id: 'toggleSlap', label: 'Toggle slap', group: 'Techniques', status: 'ready', keys: { feedback: 'Shift+O', eof: 'Shift+O' } },
    { id: 'cyclePickDirection', label: 'Cycle pick direction', group: 'Techniques', status: 'ready', keys: { feedback: 'K', logical: 'Shift+K', eof: 'K' } },
    { id: 'fretUp', label: 'Increase selected fret', group: 'Notes', status: 'ready', keys: { feedback: 'Ctrl++', eof: 'Ctrl++' } },
    { id: 'fretDown', label: 'Decrease selected fret', group: 'Notes', status: 'ready', keys: { feedback: 'Ctrl+-', eof: 'Ctrl+-' } },
    { id: 'setAnchor', label: 'Set anchor at cursor', group: 'Structure', status: 'ready', keys: { feedback: 'Shift+F', eof: 'Shift+F' } },
    { id: 'selectLike', label: 'Select matching string/fret', group: 'Selection', status: 'ready', keys: { feedback: 'Ctrl+L', cableton: 'Ctrl+Shift+L', eof: 'Ctrl+L / Shift+L' } },
    { id: 'duplicateSelection', label: 'Duplicate selection to next position', group: 'Selection', status: 'ready', keys: { feedback: 'Ctrl+D', eof: 'Ctrl+D' } },
    { id: 'copySelection', label: 'Copy selection', group: 'Selection', status: 'ready', keys: { feedback: 'Ctrl+C', eof: 'Ctrl+C' } },
    { id: 'cutSelection', label: 'Cut selection', group: 'Selection', status: 'ready', keys: { feedback: 'Ctrl+X', eof: 'Shift+Del' } },
    { id: 'pasteAtPlayhead', label: 'Paste at playhead', group: 'Selection', status: 'ready', keys: { feedback: 'Ctrl+V', eof: 'Ctrl+V' } },
    { id: 'splitAtPlayhead', label: 'Split notes at playhead', group: 'Selection', status: 'ready', keys: { feedback: '', cableton: 'Ctrl+E', eof: '' } },
    // The Logic-style left-click tool palette (CLICK-TOOLS-DESIGN.md). Plain T
    // opens it in every profile except Legacy (EOF), whose key map stays 1:1
    // EOF — there it lives in the View menu / this command palette.
    { id: 'toolPalette', label: 'Tool palette (left-click tool)', group: 'View', status: 'ready', keys: { feedback: 'T', logical: 'T', cableton: 'T', eof: '' } },
    { id: 'resnapSelection', label: 'Resnap selection to grid', group: 'Grid and sustain', status: 'ready', keys: { feedback: 'Shift+R', logical: 'Q', cableton: 'Ctrl+U', eof: 'Shift+R' } },
    { id: 'addSection', label: 'Add section at cursor', group: 'Structure', status: 'ready', keys: { feedback: 'Shift+M', logical: "Alt+'", eof: 'Shift+S' } },
    { id: 'addPhrase', label: 'Add phrase at cursor', group: 'Structure', status: 'ready', keys: { feedback: 'Shift+P', eof: 'Shift+P' } },
    { id: 'addToneChange', label: 'Add tone change at cursor', group: 'Structure', status: 'ready', keys: { feedback: 'Ctrl+Shift+T', eof: 'Ctrl+Shift+T' } },
    { id: 'addHandshape', label: 'Add handshape from selection', group: 'Structure', status: 'ready', keys: { feedback: 'Ctrl+H', eof: 'Ctrl+Shift+H' } },
    { id: 'toggleTempoMap', label: 'Enter/exit Tempo Map', group: 'Tempo map', status: 'ready', keys: { feedback: 'T,T', logical: 'G', eof: 'T (Tempo Map)' } },
    { id: 'setTimeSignature', label: 'Set time signature', group: 'Tempo map', status: 'ready', keys: { feedback: 'Shift+T', eof: 'Shift+T / Shift+I' } },
    { id: 'tempoBeatCount', label: 'Set selected measure beat count', group: 'Tempo map', status: 'ready', keys: { feedback: 'N (Tempo Map)', eof: 'N (Tempo Map)' } },
    { id: 'tempoBeatMinus', label: 'Remove a beat from selected measure', group: 'Tempo map', status: 'ready', keys: { feedback: '[ (Tempo Map)', eof: '[ (Tempo Map)' } },
    { id: 'tempoBeatPlus', label: 'Add a beat to selected measure', group: 'Tempo map', status: 'ready', keys: { feedback: '] (Tempo Map)', eof: '] (Tempo Map)' } },
    { id: 'tempoBeatUnit', label: 'Set selected measure beat unit', group: 'Tempo map', status: 'ready', keys: { feedback: 'D (Tempo Map)', eof: 'D (Tempo Map)' } },
    { id: 'tempoSetBpm', label: 'Set selected barline BPM', group: 'Tempo map', status: 'ready', keys: { feedback: 'B (Tempo Map)', eof: 'B (Tempo Map)' } },
    { id: 'tempoModulate', label: 'Metric modulation at selected barline', group: 'Tempo map', status: 'ready', keys: { feedback: 'M (Tempo Map)', eof: 'M (Tempo Map)' } },
    { id: 'tempoTapBpm', label: 'Tap tempo for selected barline', group: 'Tempo map', status: 'ready', keys: { feedback: 'Shift+B (Tempo Map)', eof: 'Shift+B (Tempo Map)' } },
    { id: 'tempoSuggestFit', label: 'Suggest barline fit from anchor (onsets)', group: 'Tempo map', status: 'ready', keys: { feedback: 'G (Tempo Map)', eof: 'G (Tempo Map)' } },
    { id: 'mapHealthNextProblem', label: 'Jump to next drifting bar (grid health)', group: 'Tempo map', status: 'ready', keys: { feedback: 'H (Tempo Map)', eof: 'H (Tempo Map)' } },
    { id: 'mapHealthPrevProblem', label: 'Jump to previous drifting bar (grid health)', group: 'Tempo map', status: 'ready', keys: { feedback: 'Shift+H (Tempo Map)', eof: 'Shift+H (Tempo Map)' } },
    { id: 'tempoAcceptWholeFit', label: 'Accept whole tempo fit (all suggestions)', group: 'Tempo map', status: 'ready', keys: { feedback: '', eof: '' } },
    { id: 'tempoInsertSync', label: 'Mark barline at cursor', group: 'Tempo map', status: 'ready', keys: { feedback: 'I (Tempo Map)', eof: 'I / Insert (Tempo Map)' } },
    { id: 'tempoDeleteSync', label: 'Delete selected barline', group: 'Tempo map', status: 'ready', keys: { feedback: 'Del (Tempo Map)', eof: 'Del (Tempo Map)' } },
    { id: 'tempoToggleSyncLock', label: 'Lock/unlock selected barlines', group: 'Tempo map', status: 'ready', keys: { feedback: 'S (Tempo Map)', eof: 'S (Tempo Map)' } },
    { id: 'tempoSetPickup', label: 'Set pickup (partial first bar)', group: 'Tempo map', status: 'ready', keys: { feedback: '', eof: '' } },
    { id: 'tempoFullDialog', label: 'Open full tempo dialog', group: 'Tempo map', status: 'planned', keys: { feedback: 'Alt+T (Tempo Map)', eof: 'Alt+T (Tempo Map)' } },
    { id: 'tempoRebuildGrid', label: 'Rebuild visible beat grid', group: 'Tempo map', status: 'planned', keys: { feedback: 'Ctrl+Shift+T (Tempo Map)', eof: 'Ctrl+Shift+T (Tempo Map)' } },
    { id: 'toggleGridDisplay', label: 'Toggle grid display density', group: 'Grid and sustain', status: 'planned', keys: { feedback: 'Shift+G', eof: 'Shift+G' } },
    { id: 'customGridSnap', label: 'Open custom snap settings', group: 'Grid and sustain', status: 'planned', keys: { feedback: 'Alt+G', eof: 'Ctrl+Shift+G' } },
    { id: 'midiTones', label: 'MIDI tone spot-check', group: 'Preview', status: 'planned', keys: { feedback: '', eof: 'Shift+T' } },
    { id: 'placeMoverPhrase', label: 'Place mover phrase', group: 'Structure', status: 'planned', keys: { feedback: 'Ctrl+Shift+R', eof: 'Ctrl+Shift+R' } },
]);

// Where a compat profile deliberately diverges from its reference app. This is
// the ONLY curated fidelity data — everything else derives: a row absent from
// this map displays silently as a match (or, when keyless, as editor-only).
// `of` names the reference app's own key/meaning; `why` is the one-line reason
// shown in the tooltip. Sourced from EOF_hotkeys.txt (pro-guitar set) and the
// manual-verified Logic/Live audits — a factual claim about the reference app,
// not UI copy; keep entries in sync with EOF-PROFILE-POLICY.md.
export const PROFILE_DIVERGENCES = Object.freeze({
    eof: Object.freeze({
        setFretDigit: { kind: 'adapted', of: 'Ctrl+`-9', why: 'Plain digits type the fret here; EOF’s Ctrl+digit works too.' },
        setFretTen: { kind: 'adapted', of: 'Ctrl+0', why: 'Shift+0 types fret 10 here; EOF’s Ctrl+0 works too.' },
        nudgeTimeLeft: { kind: 'adapted', of: 'Left = seek', why: 'Arrows nudge the selection here (seek when nothing is selected); the Page keys seek.' },
        nudgeTimeRight: { kind: 'adapted', of: 'Right = seek', why: 'Arrows nudge the selection here (seek when nothing is selected); the Page keys seek.' },
        selectLike: { kind: 'adapted', of: 'Shift+L = precise select-like', why: 'Both EOF select-like keys run the one select-matching command here.' },
        setTimeSignature: { kind: 'adapted', of: 'Shift+I', why: 'Shift+I matches EOF; Tempo Map also keeps Shift+T as a contextual alias.' },
        toggleGuideClap: { kind: 'editorOnly', why: 'No EOF pro-guitar equivalent — guide claps ride this editor’s MIDI preview.' },
    }),
    logical: Object.freeze({
        toggleSnap: { kind: 'adapted', of: '(no Logic key)', why: 'Plain G is Tempo Map here (Logic’s G opens the global tracks); Shift+G toggles snap.' },
        snapDown: { kind: 'adapted', of: 'Logic: Rewind by Transient', why: 'Ctrl+, steps snap finer here; , rewinds as in Logic.' },
        snapUp: { kind: 'adapted', of: 'Logic: Forward by Transient', why: 'Ctrl+. steps snap coarser here; . forwards as in Logic.' },
        cyclePickDirection: { kind: 'adapted', of: 'Logic: Toggle Count-in', why: 'Relocated off K (Logic’s Click); no Logic analogue for pick direction.' },
        toggleGuideClap: { kind: 'adapted', of: '(no Logic key)', why: 'Relocated off C (Logic’s Cycle Mode).' },
    }),
    cableton: Object.freeze({
        bend: { kind: 'adapted', of: 'Live: B = Draw Mode', why: 'Plain B toggles the Pencil here, as in Live; bend moved to Ctrl+B.' },
        selectLike: { kind: 'adapted', of: 'Live: Select Loop Contents', why: 'Relocated off Ctrl+L (Live’s Loop Brace toggle).' },
        togglePop: { kind: 'adapted', of: '(no Live key)', why: 'Relocated off O (Live’s Metronome).' },
    }),
});

export function _editorShortcutRowsPure(profile) {
    const p = EDITOR_SHORTCUT_PROFILES.has(profile) ? profile : 'feedback';
    return EDITOR_SHORTCUT_COMMANDS.map(cmd => {
        // A profile entry that is ABSENT inherits the FeedBack key (the delta
        // model: unoverridden keys keep their FeedBack meaning). An entry that
        // is EXPLICITLY '' means the profile reassigned that key away and the
        // command is keyless there — the two must not collapse, or a shadowed
        // command would display a key that no longer runs it.
        const key = (cmd.keys && (cmd.keys[p] ?? cmd.keys.feedback)) || '';
        // Fidelity vs the profile's reference app is DERIVED, never hand-tagged
        // per command: divergence-map hit → its kind; keyless → editor-only;
        // otherwise a silent match. The native profile has no reference.
        const div = p === 'feedback' ? null : (PROFILE_DIVERGENCES[p] || {})[cmd.id] || null;
        const row = {
            id: cmd.id,
            label: cmd.label,
            group: cmd.group,
            status: cmd.status,
            key,
            fidelity: p === 'feedback' ? 'native' : (div ? div.kind : (key === '' ? 'editorOnly' : 'match')),
        };
        if (div && div.of) row.fidelityOf = div.of;
        if (div && div.why) row.fidelityWhy = div.why;
        return row;
    });
}
export function _editorEofCommandForKeyPure(e, mode) {
    const sig = _editorKeySigPure(e);
    const key = (e.key || '').toLowerCase();
    const plain = !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
    const ctrl = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;
    const shift = e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
    const ctrlShift = (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey;
    const alt = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    if (mode === 'tempoMap') {
        if (plain && key === 't') return 'toggleTempoMap';
        if (plain && key === 'b') return 'tempoSetBpm';
        if (plain && key === 'm') return 'tempoModulate';
        if (shift && key === 'b') return 'tempoTapBpm';
        if (plain && key === 'n') return 'tempoBeatCount';
        if (plain && key === '[') return 'tempoBeatMinus';
        if (plain && key === ']') return 'tempoBeatPlus';
        if (plain && key === 'd') return 'tempoBeatUnit';
        if (plain && key === 's') return 'tempoToggleSyncLock';
        if (plain && key === 'g') return 'tempoSuggestFit';
        if (plain && key === 'h') return 'mapHealthNextProblem';
        if (shift && key === 'h') return 'mapHealthPrevProblem';
        if (shift && key === 't') return 'setTimeSignature';
        if (alt && key === 't') return 'tempoFullDialog';
        if (ctrlShift && key === 't') return 'tempoRebuildGrid';
        if (plain && (key === 'i' || e.key === 'Insert')) return 'tempoInsertSync';
        if (plain && (e.key === 'Delete' || e.key === 'Backspace')) return 'tempoDeleteSync';
    }

    if (sig === 'F1') return 'showShortcutHelp';                 // EOF: F1 = Help
    if (sig === 'F2') return 'save';
    if (sig === 'F5') return 'toggleWaveform';
    if (plain && key === 'c') return 'toggleGuideClap';
    if (shift && key === 'c') return 'toggleMixer';
    if (alt && key === 'b') return 'toggleLoopAB';
    if (shift && key === 'w') return 'toggleOnsetStrip';
    if (shift && key === 'a') return 'togglePartsView';
    // EOF: Shift+L = precise select-like; both select-like keys run our one
    // select-matching command. Follow-playhead has no EOF key (EOF just
    // auto-scrolls) — it stays on the transport-bar button / View menu here.
    if (shift && key === 'l') return 'selectLike';
    if (shift && key === '?') return 'showShortcutHelp';
    if (ctrl && key === 'k') return 'openCommandPalette';
    if (sig === 'F6') return 'importMidi';
    if (sig === 'F7') return 'importXml';
    if (sig === 'F12') return 'importGp';
    if (sig === 'PageUp') return 'prevBeat';
    if (sig === 'PageDown') return 'nextBeat';
    if (sig === 'Shift+PageUp') return 'prevNote';
    if (sig === 'Shift+PageDown') return 'nextNote';
    if (sig === 'Ctrl+Shift+PageUp') return 'prevGrid';
    if (sig === 'Ctrl+Shift+PageDown') return 'nextGrid';
    if (sig === 'Alt+PageUp') return 'prevAnchor';
    if (sig === 'Alt+PageDown') return 'nextAnchor';
    if (plain && key === '[') return 'shortenSustain';
    if (plain && key === ']') return 'lengthenSustain';
    if (plain && key === ',') return 'snapDown';
    if (plain && key === '.') return 'snapUp';
    if (plain && key === 'f') return 'editFret';
    // Numpad bookmarks (EOF: Numpad = go to, Ctrl+Numpad = set) must be
    // checked BEFORE the plain-digit fret entry — with NumLock on a numpad
    // digit arrives as e.key '1'-'9' and would read as a fret otherwise.
    {
        const np = /^Numpad([1-9])$/.exec(e.code || '');
        if (np && plain) return 'gotoBookmark:' + np[1];
        if (np && ctrl) return 'setBookmark:' + np[1];
    }
    if (plain && /^[0-9]$/.test(key)) return 'setFretDigit:' + key;
    if (shift && key === ')') return 'setFretTen';
    // EOF's own fret entry (Ctrl+1-9 = fret 1-9, Ctrl+0 = 10, Ctrl+` = 0)
    // kept as a faithful alias beside our plain-digit entry.
    if (ctrl && /^[1-9]$/.test(key)) return 'setFretDigit:' + key;
    if (ctrl && key === '0') return 'setFretTen';
    if (ctrl && key === '`') return 'setFretDigit:0';
    if (plain && key === 'h') return 'toggleHammerOn';
    if (plain && key === 'k') return 'cyclePickDirection';
    if (plain && key === 'p') return 'togglePullOff';
    if (plain && key === 's') return 'slideEditor';
    if (plain && key === 'n') return 'noteMenu';
    // No plain-T binding: EOF's T is "Crazy status", which this editor does
    // not have — the key stays free rather than squatting Tap (Ctrl+T below).
    if (shift && key === 'f') return 'setAnchor';
    if (shift && key === 'g') return 'toggleGridDisplay';
    if (shift && key === 'h') return 'togglePinchHarmonic';
    if (shift && key === 'i') return 'setTimeSignature';
    if (shift && key === 'n') return 'toggleLinkNext';
    if (shift && key === 'p') return 'addPhrase';
    if (shift && key === 'r') return 'resnapSelection';
    if (shift && key === 's') return 'addSection';
    if (shift && key === 't') return 'midiTones';
    if (shift && key === 'v') return 'toggleVibrato';
    if (shift && key === 'x') return 'toggleMuteRetain';
    if (ctrl && key === 'b') return 'bend';
    if (ctrl && key === 'f') return 'editFret';
    if (ctrl && key === 'h') return 'toggleNaturalHarmonic';
    if (ctrl && key === 'c') return 'copySelection';
    if (ctrl && key === 'v') return 'pasteAtPlayhead';
    if (shift && e.key === 'Delete') return 'cutSelection';
    if (ctrl && key === 'l') return 'selectLike';
    if (ctrl && key === 'm') return 'togglePalmMute';
    if (ctrl && key === 's') return 'save';
    if (ctrl && key === 't') return 'toggleTap';
    if (ctrl && key === 'u') return 'unpitchedSlide';
    if (ctrl && key === 'x') return 'toggleMuteOpen';
    if (ctrl && (key === '+' || key === '=')) return 'fretUp';
    if (ctrl && key === '-') return 'fretDown';
    if (ctrlShift && key === 'a') return 'toggleAccent';
    if (ctrlShift && key === 'g') return 'customGridSnap';
    if (ctrlShift && key === 'h') return 'addHandshape';
    if (ctrlShift && key === 'i') return 'toggleIgnore';
    if (shift && key === 'o') return 'toggleSlap';
    if (ctrlShift && key === 'o') return 'toggleTremolo';
    if (ctrlShift && key === 'p') return 'togglePop';
    if (ctrlShift && key === 'r') return 'placeMoverPhrase';
    if (ctrlShift && key === 't') return 'addToneChange';
    if (ctrlShift && e.key === 'ArrowUp') return 'slideUp';
    if (ctrlShift && e.key === 'ArrowDown') return 'slideDown';
    if (plain && e.key === 'ArrowUp') return 'moveStringUp';
    if (plain && e.key === 'ArrowDown') return 'moveStringDown';
    if (plain && e.key === 'ArrowLeft') return 'nudgeTimeLeft';
    if (plain && e.key === 'ArrowRight') return 'nudgeTimeRight';
    if (shift && e.key === 'ArrowUp') return 'transposeStringUp';
    if (shift && e.key === 'ArrowDown') return 'transposeStringDown';
    if (ctrl && e.key === 'ArrowUp') return 'slideUp';
    if (ctrl && e.key === 'ArrowDown') return 'slideDown';
    if (alt && (e.key === 'PageUp' || e.key === 'PageDown')) return e.key === 'PageUp' ? 'prevAnchor' : 'nextAnchor';
    // Bookmarks match on e.code — with Shift held, e.key for the digit row
    // is '!','@',… on most layouts, so the physical key is the stable signal.
    {
        const digit = /^Digit([1-9])$/.exec(e.code || '');
        const shiftAlt = e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey;
        if (digit && alt) return 'gotoBookmark:' + digit[1];
        if (digit && shiftAlt) return 'setBookmark:' + digit[1];
    }
    return null;
}


// ── Logical / Cableton — delta tables over the FeedBack resolver ─────────────
// Sig (from _editorKeySigPure) → command id. A sig in the table WINS (which is
// also how a FeedBack meaning gets shadowed: 'K' in Logical is the metronome,
// so pick-direction cycling is keyless there — its registry entry says so);
// any sig absent from the table falls through to the FeedBack resolver, so
// every editor-specific command keeps working under DAW muscle memory.
// Bindings marked "authentic" are the DAW's own defaults (Logic Pro user
// guide key-command appendix; Live 12 manual keyboard-shortcut chapter,
// Windows column) — the rest are derived relocations for shadowed commands.
export const EDITOR_PROFILE_OVERRIDES = Object.freeze({
    logical: Object.freeze({
        'K': 'toggleMetronome',          // authentic: Click
        'Q': 'resnapSelection',          // authentic: Quantize Selected Events
        ',': 'prevBeat',                 // authentic: Rewind
        '.': 'nextBeat',                 // authentic: Forward
        'C': 'toggleLoopRegion',         // authentic: Cycle Mode
        "Alt+'": 'addSection',           // authentic: Create Marker (Option-Apostrophe)
        'Ctrl+,': 'snapDown',            // relocated (',' now rewinds)
        'Ctrl+.': 'snapUp',              // relocated ('.' now forwards)
        'Shift+K': 'cyclePickDirection', // relocated ('K' now clicks)
        'Ctrl+Shift+C': 'toggleGuideClap', // relocated ('C' now cycles)
        'Shift+G': 'toggleSnap',         // relocated (plain G is Tempo Map here — input.js)
        // NOT BOUND: Logic's Repeat is Cmd-R, but the Electron host registers a
        // {role:'reload'} menu item, whose CmdOrCtrl+R accelerator fires in the
        // main process BEFORE the renderer keydown — preventDefault() cannot
        // stop it, so binding it here would reload the editor and drop unsaved
        // edits. duplicateSelection already answers Ctrl+D in every profile
        // (input.js, outside the resolvers), so it stays reachable.
    }),
    cableton: Object.freeze({
        'Ctrl+U': 'resnapSelection',     // authentic: Quantize
        'Ctrl+1': 'snapUp',              // authentic: Narrow Grid (finer)
        'Ctrl+2': 'snapDown',            // authentic: Widen Grid (coarser)
        'Ctrl+4': 'toggleSnap',          // authentic: Snap to Grid
        'O': 'toggleMetronome',          // authentic: Metronome (Live 12)
        'Ctrl+Shift+F': 'toggleFollow',  // authentic: Follow Playback
        'Ctrl+L': 'toggleLoopRegion',    // authentic: Toggle Loop Brace
        'Ctrl+E': 'splitAtPlayhead',     // authentic: Split Clip at Selection
        'Ctrl+Shift+P': 'togglePop',     // relocated ('O' now clicks)
        'Ctrl+Shift+L': 'selectLike',    // relocated ('Ctrl+L' now loops)
        // Relocated (plain B is Draw Mode here — input.js). Ctrl+B, not
        // Shift+B: the override sigs must stay disjoint from the tempo-map
        // overlay, where Shift+B is tap tempo — and Ctrl+B is also the EOF
        // profile's bend chord, so the relocation matches muscle memory.
        'Ctrl+B': 'bend',
    }),
});

// Generic table resolution for the delta profiles: the override wins, then
// the FeedBack resolver (which owns the tempo-map overlay, the digit/bookmark
// families, and everything unoverridden). The override sigs are disjoint from
// the FeedBack tempo-map overlay by construction — pinned by test.
export function _editorTableCommandForKeyPure(e, mode, overrides) {
    const hit = overrides ? overrides[_editorKeySigPure(e)] : undefined;
    if (hit) return hit;
    return _editorFeedbackCommandForKeyPure(e, mode);
}

// Validator (test-facing): the effective binding surface of a delta profile —
// override sigs must be unique (frozen-object keys already are) and must not
// collide with the FeedBack TEMPO-MAP overlay, whose keys resolve first in
// spirit (they share the fall-through). Returns colliding sigs; empty = sound.
export function _editorProfileCollisionsPure(overrides, tempoMapSigs) {
    const out = [];
    for (const sig of Object.keys(overrides || {})) {
        if ((tempoMapSigs || []).includes(sig)) out.push(sig);
    }
    return out;
}

export function _editorDefaultRightClickBehaviorPure(profile) {
    return profile === 'eof' ? 'eofEdit' : 'context';
}

export function _editorEffectiveRightClickBehaviorPure(profile, savedBehavior) {
    return (savedBehavior === 'context' || savedBehavior === 'eofEdit')
        ? savedBehavior
        : _editorDefaultRightClickBehaviorPure(profile);
}

// Legacy (EOF) treats the whole strum as the atomic unit — clicking a gem
// grabs the position; the DAW-flavoured profiles (FeedBack / Logical /
// Cableton) select the single note under the cursor like any piano roll.
export function _editorDefaultChordSelectBehaviorPure(profile) {
    return profile === 'eof' ? 'chord' : 'single';
}

export function _editorEffectiveChordSelectBehaviorPure(profile, savedBehavior) {
    return (savedBehavior === 'single' || savedBehavior === 'chord')
        ? savedBehavior
        : _editorDefaultChordSelectBehaviorPure(profile);
}

// The one grouping decision, shared by the sustain-resize grab and the
// select/move grab in mouse.js so the two can never diverge: given the
// EFFECTIVE chord-select behaviour, whether Alt is held, and whether this is
// keys DATA, does grabbing one note act on the whole strum? Keys data never
// groups (same-time notes are independent voices); Alt inverts the behaviour's
// default in either direction.
export function _editorChordGrabsStrumPure(effectiveBehavior, altKey, isKeysData) {
    if (isKeysData) return false;
    return (effectiveBehavior === 'chord') !== !!altKey;
}

// The value the settings <select> / hint / status must DISPLAY. Unlike
// _editorEffectiveRightClickBehaviorPure (the binary add/remove-vs-context
// decision, which deliberately collapses a `tool:` assignment to the profile
// default), this keeps a saved `tool:<id>` intact so the panel reflects the
// right-click-parity choice that's actually in effect. Any recognized
// persistable value (context / eofEdit / tool:<id>) shows verbatim; anything
// else falls back to the profile default.
export function _editorRightClickControlValuePure(profile, savedBehavior) {
    return EDITOR_RIGHT_CLICK_BEHAVIORS.has(savedBehavior)
        ? savedBehavior
        : _editorDefaultRightClickBehaviorPure(profile);
}

export function _editorFeedbackCommandForKeyPure(e, mode) {
    const sig = _editorKeySigPure(e);
    const key = (e.key || '').toLowerCase();
    const plain = !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
    const ctrl = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;
    const shift = e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
    const alt = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    const ctrlAlt = (e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey;
    const ctrlShift = (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey;
    if (mode === 'tempoMap') {
        if (plain && key === 't') return 'toggleTempoMap';
        if (plain && key === 'b') return 'tempoSetBpm';
        if (plain && key === 'm') return 'tempoModulate';
        if (shift && key === 'b') return 'tempoTapBpm';
        if (plain && key === 'n') return 'tempoBeatCount';
        if (plain && key === '[') return 'tempoBeatMinus';
        if (plain && key === ']') return 'tempoBeatPlus';
        if (plain && key === 'd') return 'tempoBeatUnit';
        if (plain && key === 's') return 'tempoToggleSyncLock';
        if (plain && key === 'g') return 'tempoSuggestFit';
        if (plain && key === 'h') return 'mapHealthNextProblem';
        if (shift && key === 'h') return 'mapHealthPrevProblem';
        if (shift && key === 't') return 'setTimeSignature';
        if (alt && key === 't') return 'tempoFullDialog';
        if (ctrlShift && key === 't') return 'tempoRebuildGrid';
        if (plain && (key === 'i' || e.key === 'Insert')) return 'tempoInsertSync';
        if (plain && (e.key === 'Delete' || e.key === 'Backspace')) return 'tempoDeleteSync';
    }

    if (plain && key === 't') return 'toggleTempoMap';
    if (ctrl && key === 's') return 'save';
    if (plain && key === 'w') return 'toggleWaveform';
    if (plain && key === 'c') return 'toggleGuideClap';
    if (shift && key === 'c') return 'toggleMixer';
    if (alt && key === 'b') return 'toggleLoopAB';
    if (shift && key === 'w') return 'toggleOnsetStrip';
    if (shift && key === 'a') return 'togglePartsView';
    if (shift && key === 'l') return 'toggleFollow';
    if (shift && key === '?') return 'showShortcutHelp';
    if (ctrl && key === 'k') return 'openCommandPalette';
    if (sig === 'PageUp') return 'prevBeat';
    if (sig === 'PageDown') return 'nextBeat';
    if (alt && e.key === 'ArrowLeft') return 'prevNote';
    if (alt && e.key === 'ArrowRight') return 'nextNote';
    if (sig === 'Ctrl+PageUp') return 'prevGrid';
    if (sig === 'Ctrl+PageDown') return 'nextGrid';
    if (ctrlAlt && e.key === 'ArrowLeft') return 'prevAnchor';
    if (ctrlAlt && e.key === 'ArrowRight') return 'nextAnchor';
    if (plain && e.key === 'ArrowLeft') return 'nudgeTimeLeft';
    if (plain && e.key === 'ArrowRight') return 'nudgeTimeRight';
    if (plain && key === 'g') return 'toggleSnap';
    if (plain && key === ',') return 'snapDown';
    if (plain && key === '.') return 'snapUp';
    // Sustain shorten/lengthen — the bracket keys, matching the EOF profile
    // and the Logic/EOF convention. Free in FeedBack note mode ([ / ] are only
    // claimed inside the tempoMap block above, which returns first).
    if (plain && key === '[') return 'shortenSustain';
    if (plain && key === ']') return 'lengthenSustain';
    if (plain && key === 'f') return 'editFret';
    if (plain && /^[0-9]$/.test(key)) return 'setFretDigit:' + key;
    if (shift && key === ')') return 'setFretTen';
    if (plain && key === 'b') return 'bend';
    if (plain && key === 's') return 'slideEditor';
    if (plain && key === 'u') return 'unpitchedSlide';
    if (plain && e.key === 'ArrowUp') return 'moveStringUp';
    if (plain && e.key === 'ArrowDown') return 'moveStringDown';
    if (shift && e.key === 'ArrowUp') return 'transposeStringUp';
    if (shift && e.key === 'ArrowDown') return 'transposeStringDown';
    if (plain && key === 'h') return 'toggleHammerOn';
    if (plain && key === 'k') return 'cyclePickDirection';
    if (plain && key === 'p') return 'togglePullOff';
    if (plain && key === 'y') return 'toggleTap';
    if (plain && key === 'v') return 'toggleVibrato';
    if (plain && key === 'm') return 'togglePalmMute';
    if (plain && key === 'x') return 'toggleMuteOpen';
    if (shift && key === 'x') return 'toggleMuteRetain';
    if (plain && key === 'n') return 'toggleNaturalHarmonic';
    if (shift && key === 'n') return 'togglePinchHarmonic';
    if (plain && key === 'o') return 'togglePop';
    if (shift && key === 'o') return 'toggleSlap';
    if (plain && key === 'a') return 'toggleAccent';
    if (shift && key === 't') return 'setTimeSignature';
    if (ctrl && key === 'h') return 'addHandshape';
    if (ctrlShift && key === 'i') return 'toggleIgnore';
    if (ctrlShift && key === 'o') return 'toggleTremolo';
    if (ctrlShift && key === 't') return 'addToneChange';
    if (ctrl && (key === '+' || key === '=')) return 'fretUp';
    if (ctrl && key === '-') return 'fretDown';
    if (shift && key === 'f') return 'setAnchor';
    if (ctrl && key === 'c') return 'copySelection';
    if (ctrl && key === 'x') return 'cutSelection';
    if (ctrl && key === 'v') return 'pasteAtPlayhead';
    if (ctrl && key === 'l') return 'selectLike';
    if (shift && key === 'r') return 'resnapSelection';
    if (shift && key === 'm') return 'addSection';
    if (shift && key === 'p') return 'addPhrase';
    if (ctrl && e.key === 'ArrowUp') return 'slideUp';
    if (ctrl && e.key === 'ArrowDown') return 'slideDown';
    // Bookmarks match on e.code — with Shift held, e.key for the digit row
    // is '!','@',… on most layouts, so the physical key is the stable signal.
    {
        const digit = /^Digit([1-9])$/.exec(e.code || '');
        const shiftAlt = e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey;
        if (digit && alt) return 'gotoBookmark:' + digit[1];
        if (digit && shiftAlt) return 'setBookmark:' + digit[1];
    }
    return null;
}

export function _editorIsTypingTarget(e) {
    return !!(e && e.target && e.target.matches && e.target.matches('input, select, textarea'));
}

function _editorSyncRightClickBehaviorControls() {
    const val = _editorRightClickControlValuePure(editorShortcutProfile, editorRightClickBehavior);
    const el = document.getElementById('editor-right-click-behavior');
    if (el) el.value = val;
    const hint = document.getElementById('editor-right-click-hint');
    if (hint) {
        hint.textContent = val === 'eofEdit'
            ? 'Right-click note lanes add/remove notes; lanes and markers keep context menus.'
            : val.startsWith('tool:')
                ? `Right-click runs the ${val.slice(5)} tool on note lanes; lanes and markers keep context menus.`
                : 'Right-click opens context menus.';
    }
}

function _editorSyncChordSelectControls() {
    const val = _editorEffectiveChordSelectBehaviorPure(editorShortcutProfile, editorChordSelectBehavior);
    const el = document.getElementById('editor-chord-select-behavior');
    if (el) el.value = val;
    const hint = document.getElementById('editor-chord-select-hint');
    if (hint) {
        hint.textContent = val === 'chord'
            ? 'Clicking a chord note selects the whole strum; Alt-click isolates one note.'
            : 'Clicking a chord note selects that note; Alt-click grabs the whole strum.';
    }
}

export function _editorLoadShortcutProfile() {
    try {
        const saved = localStorage.getItem(EDITOR_SHORTCUT_PROFILE_KEY);
        if (EDITOR_SHORTCUT_PROFILES.has(saved)) editorShortcutProfile = saved;
        const savedRightClick = localStorage.getItem(EDITOR_RIGHT_CLICK_BEHAVIOR_KEY);
        if (EDITOR_RIGHT_CLICK_BEHAVIORS.has(savedRightClick)) editorRightClickBehavior = savedRightClick;
        const savedChordSelect = localStorage.getItem(EDITOR_CHORD_SELECT_KEY);
        if (EDITOR_CHORD_SELECT_BEHAVIORS.has(savedChordSelect)) editorChordSelectBehavior = savedChordSelect;
    } catch (_) {}
    const el = document.getElementById('editor-shortcut-profile');
    if (el) el.value = editorShortcutProfile;
    _editorSyncRightClickBehaviorControls();
    _editorSyncChordSelectControls();
}

// Exported as plain functions; main.js owns the `window.editorSet*` surface
// (constitution §V), which also keeps this module importable under node.
export function editorSetRightClickBehavior(behavior) {
    editorRightClickBehavior = EDITOR_RIGHT_CLICK_BEHAVIORS.has(behavior) ? behavior : null;
    try {
        if (editorRightClickBehavior) localStorage.setItem(EDITOR_RIGHT_CLICK_BEHAVIOR_KEY, editorRightClickBehavior);
        else localStorage.removeItem(EDITOR_RIGHT_CLICK_BEHAVIOR_KEY);
    } catch (_) {}
    _editorSyncRightClickBehaviorControls();
    const _eff = _editorRightClickControlValuePure(editorShortcutProfile, editorRightClickBehavior);
    setStatus(_eff === 'eofEdit'
        ? 'Right-click behavior: add/remove notes'
        : _eff.startsWith('tool:')
            ? `Right-click behavior: ${_eff.slice(5)} tool`
            : 'Right-click behavior: context menus');
}
export function editorSetChordSelectBehavior(behavior) {
    editorChordSelectBehavior = EDITOR_CHORD_SELECT_BEHAVIORS.has(behavior) ? behavior : null;
    try {
        if (editorChordSelectBehavior) localStorage.setItem(EDITOR_CHORD_SELECT_KEY, editorChordSelectBehavior);
        else localStorage.removeItem(EDITOR_CHORD_SELECT_KEY);
    } catch (_) {}
    _editorSyncChordSelectControls();
    setStatus(_editorEffectiveChordSelectBehaviorPure(editorShortcutProfile, editorChordSelectBehavior) === 'chord'
        ? 'Chord click: select the whole strum'
        : 'Chord click: select one note');
}
export function editorSetShortcutProfile(profile) {
    editorShortcutProfile = EDITOR_SHORTCUT_PROFILES.has(profile) ? profile : 'feedback';
    try { localStorage.setItem(EDITOR_SHORTCUT_PROFILE_KEY, editorShortcutProfile); } catch (_) {}
    const el = document.getElementById('editor-shortcut-profile');
    if (el) el.value = editorShortcutProfile;
    const panelEl = document.getElementById('editor-shortcut-panel-profile');
    if (panelEl) panelEl.value = editorShortcutProfile;
    _editorSyncRightClickBehaviorControls();
    _editorSyncChordSelectControls();
    _editorRenderShortcutPanel();
    setStatus(`Shortcut profile: ${EDITOR_PROFILE_NAMES[editorShortcutProfile] || 'FeedBack'}`);
}

export function _editorCommandById(id) {
    return EDITOR_SHORTCUT_COMMANDS.find(cmd => cmd.id === id) || null;
}

// The reference app each compat profile is measured against (fidelity pills,
// the differences filter, and the legend all derive their wording from this).
const PROFILE_REFERENCE_NAMES = Object.freeze({ logical: 'Logic', cableton: 'Live', eof: 'EOF' });

// "Show differences" filter state for the shortcut panel — session-only chrome.
let editorShortcutDiffOnly = false;
export function editorSetShortcutDiffFilter(on) {
    editorShortcutDiffOnly = !!on;
    _editorRenderShortcutPanel();
}

export function _editorRenderShortcutPanel() {
    const panel = document.getElementById('editor-shortcut-panel');
    const list = document.getElementById('editor-shortcut-command-list');
    if (!panel || !list || panel.classList.contains('hidden')) return;
    const profileEl = document.getElementById('editor-shortcut-panel-profile');
    if (profileEl) profileEl.value = editorShortcutProfile;
    _editorSyncRightClickBehaviorControls();
    _editorSyncChordSelectControls();
    const refName = PROFILE_REFERENCE_NAMES[editorShortcutProfile];
    const allRows = _editorShortcutRowsPure(editorShortcutProfile);
    const nAdapted = allRows.filter(r => r.fidelity === 'adapted').length;
    const nEditorOnly = allRows.filter(r => r.fidelity === 'editorOnly').length;
    const subtitle = document.getElementById('editor-shortcut-panel-subtitle');
    if (subtitle) {
        // Derived, zero-maintenance: compat profiles state the bucket counts so
        // "unmarked = matches the reference" is an explicit, trustworthy claim.
        subtitle.textContent = refName
            ? `Unmarked keys match ${refName} — ${nAdapted} adapted, ${nEditorOnly} editor-only.`
            : 'FeedBack shows clickable command controls; the native key map will expand in a later pass.';
    }
    // The differences filter only means something against a reference app.
    const diffWrap = document.getElementById('editor-shortcut-diff-wrap');
    if (diffWrap) diffWrap.classList.toggle('hidden', !refName);
    const diffBox = document.getElementById('editor-shortcut-diff-only');
    if (diffBox) diffBox.checked = editorShortcutDiffOnly;
    const filtering = editorShortcutDiffOnly && !!refName;
    list.replaceChildren();
    const groups = new Map();
    for (const row of allRows) {
        // Filtered rows are omitted on re-render (never `.hidden`) — the
        // scoped-.hidden specificity trap makes display toggles unreliable here.
        if (filtering && row.fidelity !== 'adapted' && row.fidelity !== 'editorOnly') continue;
        if (!groups.has(row.group)) groups.set(row.group, []);
        groups.get(row.group).push(row);
    }
    for (const [group, rows] of groups) {
        const section = document.createElement('div');
        section.className = 'rounded border border-gray-700/70 bg-dark-900/45';
        const title = document.createElement('div');
        title.className = 'px-2 py-1.5 border-b border-gray-700/70 text-[11px] uppercase tracking-wide text-gray-500';
        title.textContent = group;
        section.appendChild(title);
        const body = document.createElement('div');
        body.className = 'divide-y divide-gray-800';
        for (const row of rows) {
            const line = document.createElement('div');
            line.className = 'flex items-center gap-2 px-2 py-1.5';
            const label = document.createElement('button');
            label.type = 'button';
            label.className = row.status === 'ready'
                ? 'min-w-0 flex-1 text-left text-gray-200 hover:text-white'
                : 'min-w-0 flex-1 text-left text-gray-500 cursor-not-allowed';
            label.textContent = row.label;
            label.disabled = row.status !== 'ready';
            label.onclick = () => window.editorRunShortcutCommand(row.id);
            const key = document.createElement('span');
            key.className = 'shrink-0 rounded bg-dark-700 border border-gray-700 px-1.5 py-0.5 font-mono text-[11px] text-gray-300';
            key.textContent = row.key || 'Button';
            // Mark only exceptions: faithful rows stay silent (the legend says
            // unmarked = matches the reference), adapted rows get the house
            // amber advisory pill, editor-only rows a muted one. The reference
            // detail rides aria-label too — titles aren't reliably announced.
            let pill = null;
            if (row.fidelity === 'adapted' || row.fidelity === 'editorOnly') {
                pill = document.createElement('span');
                pill.className = row.fidelity === 'adapted'
                    ? 'shrink-0 rounded px-1.5 py-0.5 text-[10px] bg-amber-500/15 text-amber-300 border border-amber-400/30'
                    : 'shrink-0 rounded px-1.5 py-0.5 text-[10px] bg-dark-700 text-gray-500 border border-gray-700';
                pill.textContent = row.fidelity === 'adapted' ? 'Adapted' : 'Editor-only';
                const detail = [row.fidelityOf, row.fidelityWhy].filter(Boolean).join(' — ');
                if (detail) { pill.title = detail; pill.setAttribute('aria-label', `${pill.textContent}: ${detail}`); }
            }
            const badge = document.createElement('span');
            badge.className = row.status === 'ready'
                ? 'shrink-0 rounded px-1.5 py-0.5 text-[10px] bg-green-900/50 text-green-300 border border-green-800/60'
                : 'shrink-0 rounded px-1.5 py-0.5 text-[10px] bg-dark-700 text-gray-500 border border-gray-700';
            badge.textContent = row.status === 'ready' ? 'Ready' : 'Planned';
            if (pill) line.append(label, key, pill, badge);
            else line.append(label, key, badge);
            body.appendChild(line);
        }
        section.appendChild(body);
        list.appendChild(section);
    }
}
