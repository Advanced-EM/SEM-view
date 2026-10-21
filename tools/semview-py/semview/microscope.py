"""The Microscope object and its acquisitions. Every call goes to js/scripting.js through a transport, so a
script behaves the same headless, against an open exhibit, and inside the exhibit's Python IDE."""
from __future__ import annotations

import io
import json
import sys
import zipfile

import numpy as np


def in_browser() -> bool:
    """True inside the exhibit's Python IDE (Pyodide)."""
    return sys.platform == "emscripten"


class Acquisition:
    """What the detectors recorded: NumPy arrays by name, with metadata (calibrations, optics, state).

    acq.image          the main array (image, pattern, spectrum, ...)
    acq["probe"]       any array by name; acq.arrays lists them
    acq.calibration    pixel size, camera length, energy scale, ... as recorded
    acq.save("x.npz")  the same .npz the exhibit's Export button writes
    """

    MAIN = ("image", "spectrum", "band_contrast", "pattern_center", "backscatter_energy")

    def __init__(self, npz: bytes, meta: dict | None = None):
        self.npz = bytes(npz)
        self.arrays: dict[str, np.ndarray] = {}
        with zipfile.ZipFile(io.BytesIO(self.npz)) as z:
            for name in z.namelist():
                if name.endswith(".npy"):
                    self.arrays[name[:-4]] = np.load(io.BytesIO(z.read(name)))
                elif name == "metadata.json":
                    meta = json.loads(z.read(name))
        self.meta: dict = meta or {}

    @property
    def image(self) -> np.ndarray:
        for k in self.MAIN:
            if k in self.arrays:
                return self.arrays[k]
        return next(iter(self.arrays.values()))

    @property
    def calibration(self) -> dict:
        return self.meta.get("calibration") or self.meta.get("calibrations") or {}

    def __getitem__(self, name: str) -> np.ndarray:
        return self.arrays[name]

    def save(self, path: str) -> str:
        with open(path, "wb") as f:
            f.write(self.npz)
        return path

    def __repr__(self) -> str:
        shapes = ", ".join(f"{k} {tuple(v.shape)}" for k, v in self.arrays.items())
        mode = self.meta.get("state", {}).get("mode") or self.meta.get("mode") or "?"
        return f"<Acquisition {mode}: {shapes}>"


class Microscope:
    """One simulated SEM. Get one with semview.connect()."""

    def __init__(self, transport):
        self._t = transport

    # -- reading and changing the instrument
    def info(self) -> dict:
        """What this backend offers: modes, specimens, settings, analyses, challenges, instrument presets."""
        return self._t.call("info")

    def state(self) -> dict:
        """The current settings and beam (mode, specimen, kV, current, probe size and its budget, focus, ...)."""
        return self._t.call("state")

    def set(self, **settings) -> list:
        """Change settings, e.g. set(mode="bse", specimen="ni", kV=15, current_pA=1000, fov_um=50, tilt_deg=0).
        See info()["settings"] for the full list. Returns what was done."""
        return self._t.call("set", settings)

    def command(self, text: str) -> dict:
        """Run a plain-language command with the exhibit's grammar: "focus plus 0.5", "20 kV", "load nickel"."""
        return self._t.call("command", {"text": text})

    def autofocus(self) -> dict:
        """The instrument's auto focus and stigmation (disabled in challenges that test your own)."""
        return self._t.call("autofocus")

    def profile(self, **fields) -> dict:
        """The digital twin's instrument profile. profile() reads it; profile(preset="coldfeg") picks a preset;
        profile(magCal=1.02, edsFWHM=131) applies calibrations. Fields: Br, dE, CsK, CcK, magCal, scanAspect,
        scanShear, edsFWHM, edsGain, edsOffset."""
        return self._t.call("profile", fields)

    # -- recording and measuring
    def acquire(self, steps: int | None = None) -> Acquisition:
        """Record the detectors. The simulator first advances `steps` frames of 50 ms (a sensible default by
        mode: an EBSD map runs to the end, EDS counts for 3 s), so the data reflects the current settings."""
        r = self._t.call("acquire", {} if steps is None else {"steps": int(steps)})
        return Acquisition(r["npz"], r.get("meta"))

    def analyze(self, name: str | None = None, **options) -> dict:
        """Measure the live data and compare it with the simulator's truth: calibrate_scale, fit_resolution,
        fit_focus, reconstruct_relief, fit_eds, phase_map, index_ebsd, mc_summary. None picks by mode."""
        args = dict(options)
        if name is not None:
            args["name"] = name
        return self._t.call("analyze", args)

    def step(self, n: int = 1) -> dict:
        """Advance the simulation n frames of 50 ms (EDS counts accumulate, maps fill in, the wobbler swings)."""
        return self._t.call("step", {"n": int(n)})

    # -- challenges: a training task's hidden misalignment, for testing automation
    def challenge(self, id: str, seed: int | None = None) -> dict:
        """Start a training task as a challenge: sem-focus-stig, sem-aperture-align, sem-insulator or
        ebsd-setup. The knob readings no longer show the true optics. score() says how well your script did."""
        return self._t.call("challenge", {"id": id} if seed is None else {"id": id, "seed": int(seed)})

    def score(self) -> dict:
        """The challenge's score from the true optics (the same metrics the training task reports)."""
        return self._t.call("score")

    def reveal(self) -> dict:
        """The hidden misalignment of the running challenge."""
        return self._t.call("reveal")

    def end_challenge(self) -> dict:
        return self._t.call("end_challenge")

    def close(self) -> None:
        self._t.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def __repr__(self) -> str:
        return f"<SEM {self._t.name}>"


def connect(backend: str = "auto", **options) -> Microscope:
    """Open a microscope.

    backend="headless"  the simulator in a Node.js process (default on a desktop)
    backend="live"      an exhibit in a browser; options: port=8790, timeout=120 (seconds to wait for
                        "Connect agent" in the exhibit)
    backend="browser"   inside the exhibit's Python IDE (default there)
    """
    from . import transports

    if backend == "auto":
        backend = "browser" if in_browser() else "headless"
    if backend == "browser":
        return Microscope(transports.Browser())
    if backend == "headless":
        return Microscope(transports.Headless(**options))
    if backend == "live":
        return Microscope(transports.Live(**options))
    raise ValueError('backend must be "auto", "headless", "live" or "browser"')


def _as_array(x):
    return x.image if isinstance(x, Acquisition) else np.asarray(x)


def show(x, title: str | None = None):
    """Display an image (2D) or a spectrum or profile (1D). Accepts an Acquisition or an array. In the IDE it
    draws in the output panel; on a desktop it uses matplotlib."""
    a = _as_array(x)
    if a.ndim > 2:
        raise ValueError(f"show() takes a 1D or 2D array; this one is {a.shape}")
    if in_browser():
        from js import semviewIDE  # provided by the exhibit's IDE
        from pyodide.ffi import to_js

        a = np.nan_to_num(a.astype(np.float64))
        if a.ndim == 2:
            lo, hi = np.percentile(a, [0.5, 99.5])
            g = np.clip((a - lo) / ((hi - lo) or 1) * 255, 0, 255).astype(np.uint8)
            semviewIDE.showImage(to_js(g.tobytes()), g.shape[1], g.shape[0], title or "")
        else:
            semviewIDE.showPlot(to_js(a.astype(np.float32).tobytes()), len(a), title or "")
        return None
    try:
        import matplotlib.pyplot as plt
    except ImportError as e:
        raise ImportError("show() needs matplotlib on a desktop: pip install matplotlib") from e
    plt.figure()
    if a.ndim == 2:
        plt.imshow(a, cmap="gray")
        plt.axis("off")
    else:
        plt.plot(a)
    if title:
        plt.title(title)
    plt.show()
