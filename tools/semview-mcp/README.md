# semview-mcp

An MCP server that lets an AI agent (Claude, an emskills agent, …) use the SEM-view digital twin.

- **Headless:** `simulate` runs the simulator in Node and writes what the detectors record as NumPy `.npz`
  (SE/BSE images and the four BSE quadrants, EBSD Euler maps and patterns, EDS spectra and maps, Monte Carlo
  profiles) with `metadata.json`. `twin` drives one persistent headless SEM with the same calls as the Python
  package: challenges, the instrument profile, analyses.
- **Live:** after the visitor clicks **Connect agent** (Controls → Voice and agent), the exhibit connects to
  `ws://127.0.0.1:8792` and the `exhibit_*` tools read the state, change settings, acquire, analyze, speak, and
  receive what the visitor says or types that the exhibit does not understand itself.

| Tool | What it does |
| --- | --- |
| `simulate` | one-off headless acquisition, optionally analyzed |
| `twin` | `info`, `state`, `set`, `command`, `autofocus`, `profile`, `acquire`, `analyze`, `step`, `challenge`, `score`, `reveal`, `end_challenge` |
| `exhibit_status`, `exhibit_set`, `exhibit_action`, `exhibit_command` | read and drive the open exhibit |
| `exhibit_acquire`, `exhibit_analyze` | record (images inline, `.npz` on disk) and measure |
| `exhibit_say`, `exhibit_wait_for_voice` | talk with the visitor |

Analyses carry emskills tool names where the registry has the skill: `calibrate_scale` (scalebar-calibrate),
`reconstruct_relief` (sem-topography), `phase_map` (edax-phase-map); also `fit_eds`, `fit_resolution`, `fit_focus`,
`index_ebsd`, `mc_summary`. Each returns the measurement and the simulator's truth.

## Install

```bash
cd tools/semview-mcp && npm install
claude mcp add semview -- node "$PWD/server.mjs"
```

Environment: `SEMVIEW_PORT` (8792; TEM-view's server uses 8790, so both can run), `SEMVIEW_ORIGINS` (sites allowed
to connect besides localhost; default the exhibit's GitHub Pages site), `SEMVIEW_OUT` (where files go; `./semview-out`).
The exhibit refuses changes while a training task runs, so the behavior data stays the visitor's own.

## Test

```bash
node test.mjs           # headless
node test.mjs --live    # then open the exhibit and click Connect agent
```
