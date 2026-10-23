# Scanning with Electrons

An interactive scanning electron microscope in the browser, built as a small science-museum exhibit and a digital
twin. It's the sister exhibit of [Seeing with Electrons](https://advanced-em.github.io/TEM-view/) (TEM-view): the same
look, the same Console, the same AI and scripting tools, for the SEM.

- **3D cutaway SEM:** Schottky gun, condenser, beam-limiting aperture, in-lens detector, scan coils, conical immersion objective, and a chamber with a tilting stage. Detectors: Everhart–Thornley (with Faraday cage), 4-quadrant BSE, EDS, an EBSD camera behind the 70°-tilted sample, and an on-axis TKD detector. Click any label for an instrument-physics card.
- **Imaging (SE · ETD, In-lens, BSE):** images formed pixel by pixel from multiscale specimens, with the SE yield curve, secant law and edge effect, SE2 from backscattered electrons, Reuter/Arnal η(Z, tilt), ETD shadowing and grid bias, BSE composition vs topography and channelling contrast, shot noise, and charging of uncoated insulators above E2.
- **The column as an instrument:** the probe-size budget (source image, Cₛ, Cc, diffraction) comes from the instrument profile. **Astigmatism** has X and Y components and makes the probe elliptical with two line foci, so the image streaks one way below focus and the other way above it; the **stigmator X/Y** cancel it. An **off-axis aperture** makes the image walk sideways as the focus changes and adds blur; the **focus wobbler** shows it, and the **aperture X/Y** knobs center it.
- **Specimens:** tin spheres on carbon (resolution), polished polycrystalline nickel with alumina inclusions, a FIB chip cross-section, a **463 nm cross-grating standard** (gold-shadowed carbon replica) for calibration, and a **GaN LED wafer** with InGaN quantum wells and threading dislocations.
- **EBSD & TKD:** Kikuchi bands from structure factors, mixed over the interaction footprint, indexed live with a Hough transform and interplanar-angle voting, compared with the true orientation. IPF, band contrast and MAD maps.
- **EDS:** X-ray generation range, overvoltage, schematic absorption, the Duane–Hunt limit, a Fano-limited detector with its own resolution and energy scale; element maps blurred by the true X-ray volume.
- **Cathodoluminescence (CL):** electron–hole pairs (one per ~3 E<sub>g</sub> of deposited energy) across the generation volume diffuse to dislocations, which stay dark, or into quantum wells buried 80 nm deep, and recombine at each material's bands: the GaN band edge (365 nm) and yellow band, InGaN wells near 450 nm that shift with the local indium content, the Cr³⁺ ruby line (694 nm) of the alumina inclusions, and the oxygen-vacancy bands of SiO₂. A parabolic mirror sends the light to a photomultiplier (panchromatic, in true colours) or a spectrometer (click the spectrum to image one band); the export includes a hyperspectral cube. Low voltage sees only the surface; higher voltage reaches the wells but blurs the dislocations. `fit_cl` assigns the bands, finds the indium content and counts the dislocations, against the truth.
- **Interaction volume:** a live single-scattering Monte Carlo (screened Rutherford + Joy–Luo), with measured η, backscatter energy spectrum, and energy-deposition and φ(ρz) profiles.
- **Acquire:** the camera button above the detector (or `I`) records what the detectors show into a gallery, each downloadable as PNG or NumPy `.npz` (in BSE mode with all four quadrant images; in EBSD with Bunge Euler maps).
- **Measure:** analyses of the live data, each checked against the simulator's truth ([`js/analyze.js`](js/analyze.js)):

  | Command | Analysis | emskills skill |
  | --- | --- | --- |
  | "calibrate the magnification" | `calibrate_scale`: magnification, scan aspect and shear from the cross grating (2D FFT, QR decomposition) | scalebar-calibrate |
  | "reconstruct the relief" | `reconstruct_relief`: 3D height from the four BSE quadrants (shape from shading, Frankot–Chellappa) | sem-topography |
  | "map the phases" | `phase_map`: k-means phases from the EDS element maps | edax-phase-map |
  | "fit the EDS peaks" | `fit_eds`: elements, detector resolution at Mn Kα, energy gain and zero offset | not in the registry (edax-phase-map is related) |
  | "measure the resolution" | `fit_resolution`: probe size from 25–75 % edge widths | not in the registry |
  | "check the astigmatism" | `fit_focus`: best focus and the astigmatism vector from a through-focus pair | not in the registry |
  | "check the indexing" | `index_ebsd`: indexing rate, MAD and true error of the map | not in the registry |
  | "what is the backscatter coefficient" | `mc_summary`: η and penetration depth from the Monte Carlo | not in the registry |
  | "count the dislocations" | `fit_cl`: CL bands, InGaN indium content, dislocation density | not in the registry |

- **Digital twin:**
  - *Instrument profile*: what belongs to one particular SEM: gun brightness and energy spread, Cₛ and Cc, magnification calibration, scan aspect and shear, EDS resolution, gain and zero offset. Three generic presets (field-emission Schottky, ultra-high-resolution cold FEG, conventional tungsten), plus an editor.
  - *Calibrate from data*, from the live detectors or your own files (read in the browser, never uploaded): a cross-grating image (TIFF, with the pixel size read from Thermo Fisher Scientific and Zeiss tags; PNG, JPG, `.npy`) gives magnification, scan aspect and shear; an image with sharp edges gives the resolution and, with the live beam settings, the gun brightness; an EDS spectrum (EMSA/MSA or two columns) gives the detector resolution and energy scale. On simulated data they recover magnification to ~0.1 %, scan aspect to ~0.3 %, shear to ~0.2°, EDS resolution to a few eV and the energy zero to a few eV.
  - *Mystery instrument*: practise on a profile with hidden miscalibrations, then reveal them.
  - *Sessions*: save and load the complete state, profile and calibrations as JSON; *Export* the recorded data as `.npz` with `metadata.json`.
  - *Headless*: `node tools/headless.mjs --mode bse --spec ni --kV 15 --analysis auto --out bse.npz`, or `--session file.json`.
- **Training tasks and behavior telemetry (research pilot):** the **Training** button (or `T`) opens tasks with a hidden, seeded misalignment: **Focus and stigmate** (unknown focus offset and X/Y astigmatism; auto focus disabled), **Center the aperture** (an off-axis aperture, found with the wobbler), **Image an insulator without charging** (an alumina inclusion whose true E2 differs from the textbook value; coating disabled) and **Set up an EBSD map** (from imaging conditions to ≥ 85 % correctly indexed). The user only sees the image; the exhibit keeps the truth (blur against the probe, residual astigmatism, aperture offset, indexing rate), asks the user to rate the result and name their cues, then reveals how good it was. Recording is **opt-in**, anonymous (a random id and a self-reported experience level) and local unless the visitor chooses to share: the session downloads as `sem-view-telemetry/1` JSON, and *Replay a session* plays it back with the true score over time. `python3 tools/analysis/sessions.py sessions/*.json` summarizes sessions.
  - **To Hugging Face:** [`hf/`](hf/README.md) turns sessions into the dataset **`rmsreis/sem-view-alignment`** (`sessions` and `steps` tables for imitation learning and judgment models) and includes the session collector, a free Cloudflare Worker (`hf/worker`). Visitors who choose *Record and share* send their session when the task ends; `js/config.js` holds the collector address (empty keeps everything local).
- **AI mode, voice and agents:**
  - **AI mode** (the brain button, or `/`): a command bar for typed commands, with history and suggestions. Near misses ("swich to bse") are spell-corrected and confirmed before they run. The grammar is in [`js/voice.js`](js/voice.js).
  - **Voice:** hold `M` (or the microphone, the on-screen panel's Talk key, or the Console's talk key) and say the same commands. The browser's speech recognition does the listening (in Chrome and Edge on Google's or Microsoft's servers); the exhibit asks for consent the first time.
  - **AI agents:** [`tools/semview-mcp`](tools/semview-mcp/README.md) is an MCP server. An agent can run the twin headlessly (including the training challenges), or drive an open exhibit after the visitor clicks *Connect agent*: read the state, change settings, acquire data, run the analyses and answer spoken questions out loud.
  - **Python scripting:** [`tools/semview-py`](tools/semview-py/README.md) scripts the microscope from Python: set the beam, acquire NumPy data with calibrations, run analyses, calibrate the twin, and test automation against hidden misalignments (challenges scored from the true optics). The same script runs in the exhibit's Python IDE (terminal button, or `P`; Pyodide in the browser), headless on a desktop, or driving an open exhibit.
- **Control panel and Console:** an SEM hand panel (focus, magnification, probe current, a multifunction pair for stigmator X/Y, beam shift, aperture X/Y or tilt, a context knob for scan speed, tilt, current or voltage, stage joystick, wobbler, auto focus) through the Gamepad API. It speaks the same USB protocol as the [TEM-view Console](https://advanced-em.github.io/TEM-view/console/), so one physical Console drives both exhibits; ordinary game controllers work as a stand-in. Without hardware, the **on-screen panel** (`V`) offers the same knobs with the keyboard and mouse: Q/W focus, A/S magnification, Z/X current, H/L and K/J multifunction, Tab for the multifunction mode, O/P context, B wobbler, G auto focus, F fine/coarse, arrows for the stage. It docks over the page or pops out into its own window.
- **Experiments:** *Charge it up* (find E2), *Nanograins: EBSD vs TKD*, and a fly-through tour.
- **Guides:** printable procedures in [`docs/guides`](docs/guides/) with figures computed by the simulator (`node tools/figures.mjs`, then `node tools/guides.mjs` prints the PDFs): *SOP-01 SEM column alignment* and *SOP-02 Analytical set-up: EDS, EBSD and CL*. They are linked from the buttons under the title, next to *Buy me a coffee*, *Subscribe for news* (the shared TEM-view / SEM-view mailing list) and the sister exhibit.
- **Keys:** `1`–`8` modes, `Space` blank the beam, `C` clarity, `L` labels, `E` electrons and signals, `R` reset the view, `X` enlarge the results, `I` acquire, `/` AI mode, `M` hold to talk, `T` training, `P` Python, `V` control panel, `N` auto-narration, `[` and `]` hide or show the side panels, `Esc` close.

## Run

```bash
python3 -m http.server 8767
```

Open http://localhost:8767. Three.js loads from jsDelivr, Pyodide and CodeMirror (for the Python IDE) from their
CDNs on first use. It's plain static files, so it can be hosted on GitHub Pages directly. Before each release run
`node tools/stamp.mjs`: it stamps a version onto every module so browsers load the new code.

## Tests

```bash
node tests/voice.mjs && node tests/fits.mjs && node tests/analyses.mjs    # grammar, calibration fits, analyses vs truth
python3 -m pytest tools/semview-py/tests                                   # Python package, headless
node tools/semview-mcp/test.mjs                                            # MCP server (npm install there first)
node hf/worker/test.mjs                                                    # session collector
```

## Code map

| File | Role |
| --- | --- |
| `js/physics.js` | Probe formation (from the profile), yields and ranges, X-ray lines, crystallography, Kikuchi bands, Monte Carlo, specimens |
| `js/sim.js` | Image formation (astigmatic probe, aperture misalignment, wobbler, scan calibration), Kikuchi patterns, Hough + indexing, EBSD/TKD maps, EDS, Monte Carlo runner |
| `js/state.js`, `js/profile.js` | Default state and session keys; instrument profile, presets, mystery instruments |
| `js/ops.js` | Instrument operations on the state alone, shared by the exhibit and every headless backend |
| `js/calibrate.js`, `js/calibui.js` | Fits (grating FFT, edge resolution, EDS peaks, relief, k-means); the calibration dialog and file readers |
| `js/analyze.js` | Analyses of the live data, named after emskills tools |
| `js/export.js`, `js/npy.js`, `js/acquire.js` | Recorded data as NumPy `.npz`; acquisitions and their gallery |
| `js/voice.js`, `js/agent.js` | Command grammar, spelling correction, confirmation, push-to-talk; bridge to an AI agent |
| `js/scripting.js`, `js/ide.js` | The script calls every backend shares; the in-browser Python IDE |
| `js/scenarios.js`, `js/telemetry.js` | Training tasks with hidden misalignments, judgment, reveal, replay; the opt-in session recorder |
| `js/panel.js`, `js/vpanel.js` | Hardware panel / Console and game controllers; the on-screen panel |
| `js/config.js` | Where shared sessions go, the agent's address, links to TEM-view and the Console |
| `js/render2d.js`, `js/scene3d.js`, `js/explain.js`, `js/components.js` | Detector views, the 3D instrument, explanations and instrument-physics cards |
| `js/main.js` | State, controls, wiring, loop |
| `tools/semview-py/`, `tools/semview-mcp/`, `tools/headless.mjs` | Python package, MCP server, headless runner |
| `hf/`, `tools/analysis/` | Hugging Face dataset builder and session collector; session summaries and a sample session |
