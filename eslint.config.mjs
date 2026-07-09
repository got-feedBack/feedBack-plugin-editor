/* ESLint for the editor's `src/` module graph.
 *
 * The playbook says lint rides in each migrated repo. This is the minimum that
 * earns its keep during the R2 split, and it exists because of two bugs that
 * `node --test` (86/86 green) and the headless harnesses BOTH missed:
 *
 *   1. `MIN_NOTE_W` / `NOTE_PAD` moved to geometry.js and main.js kept using
 *      them unimported → `NOTE_PAD is not defined` on every mousemove.
 *   2. `typeof _coverageEditGen === 'number' ? _coverageEditGen : 0` survived
 *      the counter moving to state.js. `typeof` on an undeclared name is legal
 *      and yields 'undefined', so two memos silently keyed on a constant 0 and
 *      never invalidated on an edit. No error. No failing test.
 *
 * `{ typeof: true }` is what catches (2), and is OFF by default — without it
 * `no-undef` deliberately ignores `typeof x`. Do not drop it.
 *
 * `no-unused-vars` is a WARNING, not an error: a handful of pre-existing
 * declarations are reachable only from tests that slice them out of the source
 * text, so making it an error today would mean deleting code the suite covers.
 * It ratchets down as those tests move to real imports (same shape as core's
 * `max-lines` warn ratchet).
 */

// The subset of browser globals src/ actually touches. Listed explicitly rather
// than pulled from the `globals` package so this config needs no dependency.
const BROWSER = [
    'window', 'document', 'localStorage', 'sessionStorage', 'navigator', 'location',
    'history', 'screen', 'console', 'performance', 'crypto', 'globalThis',
    'requestAnimationFrame', 'cancelAnimationFrame',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
    'fetch', 'Image', 'Audio', 'AudioContext', 'OfflineAudioContext', 'MediaRecorder',
    'FormData', 'URL', 'URLSearchParams', 'Blob', 'File', 'FileReader',
    'TextDecoder', 'TextEncoder', 'AbortController', 'structuredClone', 'btoa', 'atob',
    'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent',
    'MutationObserver', 'ResizeObserver', 'getComputedStyle',
    'alert', 'confirm', 'prompt',
    'CanvasRenderingContext2D', 'Node', 'Element', 'HTMLElement',
];

// Provided by the HOST, not by this plugin: core's shell installs `showScreen`,
// and the read-only tab preview lazy-loads the alphaTab vendor bundle.
const HOST = ['showScreen', 'alphaTab'];

export default [
    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: Object.fromEntries(
                [...BROWSER, ...HOST].map((g) => [g, 'readonly'])),
        },
        rules: {
            'no-undef': ['error', { typeof: true }],
            'no-unused-vars': ['warn', {
                args: 'none',
                caughtErrors: 'all',
                caughtErrorsIgnorePattern: '^_',
                ignoreRestSiblings: true,
            }],
        },
    },
];
