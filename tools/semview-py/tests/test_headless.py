"""Headless backend tests: python3 -m pytest tools/semview-py/tests (needs Node 20+)."""
import shutil

import numpy as np
import pytest

import semview as sv

pytestmark = pytest.mark.skipif(not shutil.which("node"), reason="needs Node.js")


@pytest.fixture(scope="module")
def sem():
    with sv.connect("headless") as m:
        yield m


def test_info(sem):
    i = sem.info()
    assert "bse" in i["modes"] and "grid" in i["specimens"] and "sem-focus-stig" in [c["id"] for c in i["challenges"]]


def test_set_and_acquire(sem):
    sem.set(mode="se", specimen="sn", kV=5, fov_um=4)
    s = sem.state()
    assert s["kV"] == 5 and s["fov_um"] == 4
    a = sem.acquire()
    assert a.image.shape == (256, 256) and np.isfinite(a.image).all()
    assert abs(a.calibration["pixel_um"] - 4 / 256) < 1e-9


def test_bse_segments(sem):
    sem.set(mode="bse", specimen="ni")
    a = sem.acquire()
    assert all(f"segment_{q}" in a.arrays for q in "ABCD")


def test_calibrate_scale(sem):
    sem.profile(magCal=1.03)
    sem.set(mode="se", specimen="grid", fov_um=4)
    r = sem.analyze("calibrate_scale")
    assert abs(r["result"]["magnification_calibration"] - 1.03) < 0.01
    sem.profile(preset="schottky")


def test_challenge(sem):
    t = sem.challenge("sem-aperture-align", seed=1)
    assert "aperture" in t["task"].lower()
    before = sem.score()["offset_um"]
    hidden = sem.reveal()["hidden"]["mis"]["ap"]
    sem.set(aperture_x_um=hidden[0], aperture_y_um=hidden[1])
    after = sem.score()
    assert after["offset_um"] < 0.1 < before and after["success"]
    sem.end_challenge()


def test_autofocus_blocked(sem):
    sem.challenge("sem-focus-stig", seed=2)
    with pytest.raises(Exception):
        sem.autofocus()
    sem.end_challenge()


def test_errors(sem):
    with pytest.raises(Exception):
        sem.set(bogus=1)


def test_megalibrary_tkd(sem):
    assert sem.library()["particles"] == [1000, 1000]
    sem.goto(375, 375)
    t = sem.particle(375, 375)
    sem.set(stage_um=t["center_um"], mode="tkd", fov_um=0.04, map_size=24, foil_nm=40)
    assert sem.state()["specimen"] == "lib"
    a = sem.acquire()
    e = a["euler_phi1"]
    assert np.isfinite(e).sum() > 20  # the particle indexes; the bare membrane does not
