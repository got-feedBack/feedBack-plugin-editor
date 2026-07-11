# Arrangement Editor

The **Song Editor** plugin for [feedBack](https://github.com/got-feedback/feedback)
(plugin id `editor`) — a DAW-style timeline editor for building and editing
feedpak arrangements: import Guitar Pro tabs, MIDI, or community XML; sync a
chart to a recording; author and tune every note; and build the result back
into a `.feedpak` package the rest of the ecosystem plays.

It is the largest plugin in the ecosystem. If you are here to work on it,
read this top-to-bottom once — the architecture section saves real time.

## What it does

- **Import** — Guitar Pro (GP3–GP8), MIDI (with tempo-map import), community
  arrangement XML, MusicXML-adjacent sources, GoPlayAlong sync sidecars, and
  existing `.feedpak`/archive files, all normalized into one internal model.
- **Edit** — a canvas timeline with per-part views: String view (lanes per
  string), a piano roll (with resolver-assisted fretted authoring), a drum
  piece-lane grid, and a read-only engraved tab preview. Undo/redo is the
  edit contract: every mutation is a command with exec/rollback.
- **Time** — a beat-primary tempo map (`beatOf`/`timeOf` over one anchor
  set): Tempo Map mode fits the grid to a recording (sync points, tap tempo,
  metric modulation, beat-lock), snap rides the same converter (grid, onset,
  swing), and loop regions/bookmarks/count-in ride the transport.
  The authoritative musical ruler fits bars and beats to fixed source audio;
  authored musical content aligns through that ruler. See
  [`docs/TEMPO-MAPPING-DESIGN.md`](docs/TEMPO-MAPPING-DESIGN.md) for the four
  timing domains, marker model, assisted mapping, and audition-speed rules.
- **Companion strips** — a fretboard strip for fretted parts (candidate
  positions from the suggest-position resolver, click to assign) and a drum
  kit / pad strip for drum parts (GM-mapped, MIDI-monitor capable).
- **Advisory lints** — drum limb feasibility and fretted playability checks
  that name physical questions without ever blocking or auto-fixing.
- **Build** — assembles the finished `.feedpak` through the host's core
  libraries, so output packages are compatible everywhere.

## Layout

| Path | What |
|---|---|
| `plugin.json` | Manifest: id, screens, `scriptType: "module"`, routes. |
| `screen.html` / `screen.js` | The screen DOM and the module entry stub (`src/main.js` is the real entry). |
| `src/` | The frontend, as native ES modules (see below). |
| `routes.py` | The FastAPI backend: session store, `import-*` endpoints, save/build. |
| `goplayalong.py` | GoPlayAlong sync-sidecar parser. |
| `tests/` | `node --test` suites (JS) + `pytest` suites (backend helpers). |
| `assets/` | Icon and the manifest stylesheet. |

## Developing

```bash
npm test                              # full JS suite (node --test over tests/)
node --test tests/loop_ab.test.js     # a single JS suite
npm run lint                          # ESLint over src/ + tests/ (via npx — see below)
python -m pytest                      # backend suite (needs fastapi/pyyaml installed)
```

Two rules that surprise newcomers:

- **No `node_modules`, ever.** The desktop bundler copies this whole
  directory into the packaged app (stripping only `.git`), so `npm run lint`
  shells out to a pinned `npx eslint` instead of installing anything.
- **ESLint's `no-undef` with `{ typeof: true }` is a correctness gate**, not
  style — it exists to catch identifiers left behind by module moves,
  including the `typeof x` reads that fail silently. Don't weaken it.

Frontend edits show on a browser refresh; `routes.py` changes need a server
restart. In the packaged app the host serves `src/` with live-edit caching.

## Architecture in five minutes

The frontend is ~40 ES modules under `src/`, orchestrated by a thin
`src/main.js`. The load-bearing invariants:

- **`src/state.js` exports `S`, the single mutable state object.** It is
  never reassigned — only its properties are. Tests seed it with
  `Object.assign`.
- **Every mutation goes through `S.history`** (`src/history.js`) as a
  command object with `exec`/`rollback`. `editGen` bumps once per committed
  edit; memos over note data key on it.
- **`src/host.js` breaks import cycles**: extracted modules reach the few
  main.js callbacks they need through one hook table. Anything main.js
  *reassigns* must be wired as a thunk — read the warning at the top of that
  file before adding a hook.
- **`src/beats.js` is the single time converter** (`beatOf`/`timeOf`). Beat
  coordinates are truth; seconds are derived. `TempoMapCmd` recomputes
  seconds from beats, `TempoGridCmd` re-lifts beats from seconds.
- **Modules must degrade under node** (no DOM, no host): inert defaults,
  no import-time side effects — that's how the real-import test suites work.

The backend (`routes.py`) keeps a `_sessions` dict keyed by session id, each
owning an unpacked working directory. Every import format normalizes through
its own endpoint into the same model; `/build` is the only path that writes
to the user's library. When the editor and the host disagree about a field,
the [feedpak spec](https://github.com/got-feedback/feedpak-spec) wins.

## Testing conventions

New suites are **real-import ESM** (`tests/*.test.mjs`): import the actual
modules, seed the real `S`, stub only the DOM slice you need
(`tests/_history_env.mjs` is the template for history-driven suites). Older
suites slice functions out of the source text — when touching code they
cover, keep new globals `typeof`-guarded so their environments stay clean.

House rules: never stub the subject under test; round-trip every command
(exec → rollback deep-equality → redo); adversarial inputs; and a stateful
change needs a test that fails without it.

Every user-visible change adds a `CHANGELOG.md` entry under `[Unreleased]`.
