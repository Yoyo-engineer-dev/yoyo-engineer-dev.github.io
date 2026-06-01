# Tavern Crashers · Map Tool

A browser-based tool for animating top-down D&D / tabletop combat encounters.
Drop tokens on a battle map, build a per-round timeline of moves, spells, and
attacks, then play it back with canvas VFX. Includes a `.webm` screen recorder
and a player-facing **clean mode**.

No build step, no dependencies to install — it's plain JavaScript + a vendored
copy of React.

## Run

Serve the folder over HTTP and open it in a modern browser:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

(Any static file server works. Serve over HTTP rather than opening the file
directly, so screen recording and the background-tab playback worker behave.)

## Using it

- **Tabs** (top) — switch between maps; `+` uploads a new map image.
- **Left rail** — tools: Select (V), Path (M), Spell (S), Attack (A), AOE (O), Effects (E), Note (N).
- **Bottom dock** — drag sprites onto the map; the timeline shows clips you can drag/resize/retime.
- **Right column** — token/clip props, the spell library, persistent effects, and map info.
- **Transport** (top right) — play/pause (space), speed, record `.webm`, and Clean mode for recording a chrome-free stage.

## Project layout & contributing

See [CLAUDE.md](CLAUDE.md) for the full architecture, the `window.*` globals
contract, the script load order, and how to add spells, effects, components, or
VFX types.

The original self-contained single-file build is preserved at
`legacy/standalone-bundle.html` for reference.
