# Tavern Crashers · Map Tool — Agent Guide

A browser-based, **zero-build** tool for choreographing top-down D&D / tabletop
combat encounters: drop tokens on a battle map, build a per-round timeline of
moves / spells / attacks, and play it back with canvas VFX. Includes a screen
recorder (`.webm`) and a player-facing "clean mode".

There is **no build step, no bundler, no npm, no JSX**. Every source file is
plain modern JavaScript using `React.createElement`. React is vendored locally.
This was deliberately restructured from a single 12 MB self-contained
`index.html` (preserved at `legacy/standalone-bundle.html`) into the file tree
below so it is easy to read, edit, and extend.

## Run it

It must be served over **HTTP** (not opened as a `file://` URL — canvas
recording taints on `file://`, and some browsers restrict workers there):

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works (`npx serve`, `php -S`, etc.). There is nothing to
compile or install.

## File structure

```
index.html                      Entry point. Defines the <script> load order (matters — see below).
src/
  styles.css                    All styling (dark "compositor" theme). @font-face -> ../assets/abril-fatface.ttf
  data/
    spells.js                   window.SPELLS (the spell/weapon DB) + window.SCHOOLS (color palette per school)
    lingerEffects.js            window.LINGER_EFFECTS (persistent environmental effects)
  engine/
    mapEngine.js                window.MapEngine — the ~4200-line canvas VFX renderer + math helpers (IIFE)
  components/                    One React component per file. Each is an IIFE that exposes window.<Name>.
    MapTabs.js                  Map tabs (top row)
    Topbar.js                   Round nav + transport (play/record/speed/clean)
    ToolRail.js                 Left tool rail (select/path/spell/attack/aoe/linger/note) + linger sublist
    SpellLibrary.js             Searchable, school-filtered spell list
    LingerLibrary.js            Persistent-effect library + placed-effect list
    TokenDrawer.js              Sprite palette (bottom dock) + upload
    Inspector.js                Right column. Also contains PropsInspector + MapInspector (internal helpers)
    Timeline.js                 Clip tracks, drag/resize, scrub, playhead
    DrawerHandle.js             Bottom drawer view switch / collapse
    RecordingModal.js           In-app recorded-clip player + download
    Stage.js                    Canvas host, mouse tools, render loop. Exposes window.Stage + window.flashHelp
    App.js                      Root component: all state, playback loop, recording, undo, wiring. window.App
  main.js                       Boot: mounts window.App once all globals exist
vendor/
  react.development.js          React 18.3.1 (UMD dev build)
  react-dom.development.js      ReactDOM 18.3.1 (UMD dev build, has createRoot)
assets/                         token-*.png, map-*.png, longsword.webp, abril-fatface.ttf
legacy/
  standalone-bundle.html        The original self-contained single-file build (reference only)
```

## Architecture: the `window.*` globals contract

Because there are no ES modules, files communicate through `window`. This is the
load-bearing convention — respect it when editing.

| Global | Defined in | Shape |
|---|---|---|
| `window.SPELLS` | `data/spells.js` | `[{ id, name, school, lvl, range, dmg, vfx, ... }]` |
| `window.SCHOOLS` | `data/spells.js` | `{ <school>: { hot, mid, cool } }` color ramps |
| `window.LINGER_EFFECTS` | `data/lingerEffects.js` | `[{ id, name, kind, school, radius }]` |
| `window.MapEngine` | `engine/mapEngine.js` | `{ TOKEN_R, drawScene, commitRound, roundDuration, tokenPosAt, pathArc, pointAt, clamp, lerp, dist }` |
| `window.flashHelp` | `components/Stage.js` | `(msg) => void` toast |
| `window.<Component>` | each `components/*.js` | a React component function |
| `window.App` | `components/App.js` | root component (mounted by `main.js`) |

Notes:
- The engine reads `window.SCHOOLS` at draw time, so data must load before render (it does — see load order).
- `window.__resources` is a leftover hook from the old single-file bundler. It is now always `undefined`, so asset lookups fall back to the `assets/...` paths. You can ignore it.

## Load order (in `index.html`) — do not reorder casually

1. `data/*` and `engine/*` (plain globals; engine is an IIFE)
2. `vendor/react*` (must precede components — each component does `const { useState, ... } = React` at eval time)
3. `components/*` (each attaches `window.<Name>`)
4. `main.js` (polls until `App`, `MapTabs`, `Stage`, `MapEngine` exist, then `createRoot().render`)

Order *among* components doesn't matter: components reference each other only via
`window.X` at render time, by which point every script has executed.

## Component file convention

Every component file follows this shape so the shared `const { useState } = React`
destructuring doesn't collide at global scope:

```js
// One-line description
(function(){
  const { useState, useEffect, useRef, useMemo, useCallback } = React;

  function MyThing(props){
    return React.createElement(/* ... */);
  }

  window.MyThing = MyThing;   // expose for other files + index.html
})();
```

Cross-component references use `window.Other` (e.g. `Inspector.js` renders
`window.SpellLibrary`). Internal-only helpers (like `PropsInspector`) stay inside
their file's IIFE and are *not* put on `window`.

## How to make common changes

- **Add a spell**: append an entry to `window.SPELLS` in `data/spells.js`. Set `vfx` to one of the engine's supported types (the big comment block at the top of `data/spells.js` lists them all, e.g. `projectile`, `aoe-burst`, `cone`, `bolt`, `chain`, `melee-slash`, `ray`, `beam`, `wall`, `vines`, `summon`, `teleport`, …). `school` must be a key in `window.SCHOOLS`.
- **Add a school color**: add a `{ hot, mid, cool }` entry to `window.SCHOOLS`.
- **Add a linger effect**: append to `window.LINGER_EFFECTS`; `kind` must be handled by the engine's linger renderer.
- **Add a new VFX type**: edit `engine/mapEngine.js` — register it in the `vfx` dispatch table (search the file for the existing handler map, e.g. `"melee-longsword": vfxLongswordSlash`) and add a draw function.
- **Add a new component**: create `src/components/Foo.js` using the IIFE convention above, add a `<script src="src/components/Foo.js">` tag in the components section of `index.html`, and reference it as `window.Foo`.
- **Change default maps / starter encounter**: `DEFAULT_SPRITES`, `DEFAULT_MAPS`, and the seeded sample clips live near the top of `components/App.js`.
- **Add an asset**: drop the file in `assets/` and reference it by relative path (`assets/whatever.png`) from JS, or `../assets/...` from `styles.css`.

## Gotchas

- Modern syntax (optional chaining `?.`, nullish `??`, spread) is used freely and runs natively in current browsers — fine without transpilation.
- The playback ticker uses a `Worker` built from a Blob URL (keeps animation running in background tabs). This is why serving over HTTP is recommended.
- Recording uses `canvas.captureStream()` + `MediaRecorder` → `.webm`. Same-origin (HTTP-served) assets keep the canvas untainted.
