/* Slopsmith Arrangement Editor — snap grid model.
 *
 * Pure: the snap resolutions the toolbar offers, and the arithmetic that
 * turns a chosen resolution into beat subdivisions. No DOM, no editor state.
 */

export const SNAP_OPTIONS = Object.freeze([
    { label: '1/1', value: 1, subdivisions: 1 },
    { label: '1/2', value: 1 / 2, subdivisions: 2 },
    { label: '1/3T', value: 1 / 3, subdivisions: 3 },
    { label: '1/4', value: 1 / 4, subdivisions: 4 },
    { label: '1/6T', value: 1 / 6, subdivisions: 6 },
    { label: '1/8', value: 1 / 8, subdivisions: 8 },
    { label: '1/12T', value: 1 / 12, subdivisions: 12 },
    { label: '1/16', value: 1 / 16, subdivisions: 16 },
    { label: '1/24T', value: 1 / 24, subdivisions: 24 },
    { label: '1/32', value: 1 / 32, subdivisions: 32 },
    { label: '1/48T', value: 1 / 48, subdivisions: 48 },
    { label: '1/64', value: 1 / 64, subdivisions: 64 },
    { label: '1/96T', value: 1 / 96, subdivisions: 96 },
]);
export const SNAP_VALUES = SNAP_OPTIONS.map(opt => opt.value);

export function _editorSnapOptionLabelsPure() {
    return SNAP_OPTIONS.map(opt => opt.label);
}

export function _editorSnapSubdivisionsPure(snapValue) {
    if (!snapValue) return 0;
    return Math.max(1, Math.round(1 / snapValue));
}

export function _editorEffectiveSnapValuePure(snapEnabled, snapValue) {
    return snapEnabled ? snapValue : 0;
}
