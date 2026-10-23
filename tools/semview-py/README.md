# semview

Script the SEM-view scanning electron microscope simulator from Python. The same script runs three ways:

| Backend | How | Needs |
| --- | --- | --- |
| `sv.connect("headless")` | the simulator in a Node.js process, no browser (the default on a desktop) | Node 20+ |
| `sv.connect("live")` | an exhibit open in a browser: click **Connect agent** there | `websockets>=13` |
| `sv.connect("browser")` | inside the exhibit's Python IDE (terminal button, or <kbd>P</kbd>; Pyodide) | nothing |

```bash
pip install -e tools/semview-py            # add [live] for the live backend, [plot] for show()
```

```python
import semview as sv

sem = sv.connect()
sem.set(mode="bse", specimen="ni", kV=15, current_pA=1000, fov_um=60)
a = sem.acquire()                      # NumPy arrays: a.image, a["segment_A"], a.calibration, a.meta
print(sem.state()["probe_nm"], "nm probe")
print(sem.analyze("reconstruct_relief")["summary"])
```

## Calls

| Call | |
| --- | --- |
| `set(**settings)` | mode, specimen, kV, current_pA, aperture_um, wd_mm, focus_um, stig_x, stig_y, aperture_x_um, aperture_y_um, fov_um, stage_um, tilt_deg, dwell_us, coated, etd_bias_V, bse, segments, realistic, beam, wobbler, map_size, exposure_ms, foil_nm, trajectories |
| `state()` | settings and beam: probe size and its budget, depth of field, sharpness, charging |
| `command(text)` | the exhibit's command grammar: "focus plus 0.5", "load nickel" |
| `autofocus()` | the instrument's auto focus and stigmation |
| `profile(**fields)` | the digital twin's instrument profile: `preset`, Br, dE, CsK, CcK, magCal, scanAspect, scanShear, edsFWHM, edsGain, edsOffset |
| `acquire(steps=None)` | record the detectors (an EBSD map runs to the end, EDS counts for 3 s) |
| `analyze(name)` | calibrate_scale, fit_resolution, fit_focus, reconstruct_relief, fit_eds, phase_map, index_ebsd, mc_summary; each with the truth |
| `challenge(id, seed)`, `score()`, `reveal()`, `end_challenge()` | a training task's hidden misalignment, scored from the true optics: `sem-focus-stig`, `sem-aperture-align`, `sem-insulator`, `ebsd-setup` |
| `sv.show(x, title)` | an image or a profile (matplotlib on a desktop, the IDE's output panel in the browser) |

## Examples

`examples/`: `quickstart.py`, `calibrate_magnification.py` (digital twin on the cross grating), `bse_relief.py`
(3D from the quadrants in NumPy), `ebsd_map.py`, `find_e2.py` (challenge), `auto_focus_stig.py` (your own auto focus
and stigmation against a hidden misalignment). Open one in the exhibit with `?script=<name>`.

## Tests

```bash
python3 -m pytest tools/semview-py/tests
```
