# TKD screen of a nanoparticle megalibrary: crystal orientations and twins of single 15–25 nm particles.
# The library (specimen "lib", the same particles as in TEM-view) sits on a 10 nm silicon-nitride membrane,
# so transmission Kikuchi diffraction maps each particle. For each particle chosen, the script drives the stage
# to its grid node, finds it in a BSE image and re-centres (the stage misses by ~25 nm and the particle sits up
# to ~60 nm off its node), maps it by TKD, keeps the points in the particle's core, groups them into
# orientations, and calls the particle single-crystal, twinned (two orientations 60° about <111>) or
# two-crystal. Then it compares with the true particle. Run: python tkd_megalibrary.py --n 4
import itertools
import sys

import numpy as np
import semview as sv

N = int(sys.argv[sys.argv.index("--n") + 1]) if "--n" in sys.argv else 3  # N × N particles across the library
sem = sv.connect()
sem.set(specimen="lib", realistic=True)


def mat(e):
    """Orientation matrix (crystal → sample) from Bunge Euler angles in degrees."""
    p1, P, p2 = np.radians(e)
    c1, s1, c, s, c2, s2 = np.cos(p1), np.sin(p1), np.cos(P), np.sin(P), np.cos(p2), np.sin(p2)
    return np.array([[c1 * c2 - s1 * s2 * c, s1 * c2 + c1 * s2 * c, s2 * s], [-c1 * s2 - s1 * c2 * c, -s1 * s2 + c1 * c2 * c, c2 * s], [s1 * s, -c1 * s, c]]).T


CUBIC = [M for p in itertools.permutations(range(3)) for sg in itertools.product([1, -1], repeat=3)
         for M in [np.array([[sg[i] if j == p[i] else 0 for j in range(3)] for i in range(3)])] if np.linalg.det(M) > 0]


def miso(A, B):
    """Misorientation angle (degrees) between two cubic orientations, and the rotation axis in crystal A."""
    best, ax = 180.0, None
    for S in CUBIC:
        D = A.T @ B @ S
        ang = np.degrees(np.arccos(np.clip((np.trace(D) - 1) / 2, -1, 1)))
        if ang < best:
            best, ax = ang, np.array([D[2, 1] - D[1, 2], D[0, 2] - D[2, 0], D[1, 0] - D[0, 1]])
    return best, ax


def find_particle():
    """BSE survey at 200 nm, then 80 nm: move the stage onto the brightest blob."""
    for fov in (0.2, 0.08):
        sem.set(mode="bse", fov_um=fov)
        a = sem.acquire()
        img = a.image.astype(float)
        bg, pk = np.percentile(img, 50), np.percentile(img, 99.7)
        m = img > bg + 0.4 * (pk - bg)
        if m.sum() < 4:
            return False
        ys, xs = np.nonzero(m)
        n, px = img.shape[0], a.calibration["pixel_um"]
        x, y = sem.state()["stage_um"]
        sem.set(stage_um=[x + (xs.mean() + 0.5 - n / 2) * px, y - (ys.mean() + 0.5 - n / 2) * px])  # image rows run down
    return True


def orientations():
    """TKD map over 40 nm; cluster the well-indexed points into orientations (5° tolerance)."""
    sem.set(mode="tkd", fov_um=0.04, map_size=40, foil_nm=40)
    a = sem.acquire()
    e = np.stack([a["euler_phi1"], a["euler_Phi"], a["euler_phi2"]], -1)
    ok = ~np.isnan(e[..., 0])
    if ok.sum() < 10:
        return []
    # the rim, where the membrane mixes into the pattern, misindexes: keep the inner 8 nm (the stage is centred
    # on the particle, and the smallest particles are 15 nm across)
    n = ok.shape[0]
    jj, ii = np.indices(ok.shape)
    ok &= np.hypot(ii + 0.5 - n / 2, jj + 0.5 - n / 2) * (40 / n) < 8
    clusters = []
    for x in e[ok]:
        O = mat(x)
        for c in clusters:
            if miso(c["O"], O)[0] < 5:
                c["n"] += 1
                break
        else:
            clusters.append({"O": O, "n": 1})
    clusters.sort(key=lambda c: -c["n"])
    return [c for c in clusters if c["n"] >= max(6, 0.12 * ok.sum())]


rows = []
step = 1000 // N
for gj in range(N):
    for gi in range(N):
        i, j = gi * step + step // 2, gj * step + step // 2
        sem.goto(i, j)
        t = sem.particle(i, j)
        if not find_particle():
            print(f"({i:3d},{j:3d}) no particle found (present: {t['present']})")
            continue
        cl = orientations()
        if len(cl) >= 2:
            ang, ax = miso(cl[0]["O"], cl[1]["O"])
            ax = np.abs(ax) / (np.linalg.norm(ax) or 1)
            twin = abs(ang - 60) < 4 and np.all(np.abs(ax - 1 / np.sqrt(3)) < 0.1)
            call = "twinned" if twin else "two crystals"
        else:
            call = "single crystal" if cl else "not indexed"
        truths = [mat(d["euler_deg"]) for d in t["domains"]]
        err = miso(cl[0]["O"], min(truths, key=lambda T: miso(cl[0]["O"], T)[0]))[0] if cl else float("nan")
        # an epitaxial heterostructure (cube-on-cube) has a single orientation: TKD sees one crystal
        epi = t["phase"] == "heterostructure" and t["interface"]["epitaxial"]
        truth = "single crystal" if epi else {"alloy": "single crystal", "twinned": "twinned", "heterostructure": "two crystals"}[t["phase"]]
        rows.append((call, truth, err))
        print(f"({i:3d},{j:3d}) {call:15s} (true: {truth}{', an epitaxial heterostructure' if epi else ''}); main orientation off by {err:.1f}°")

if rows:
    errs = [r[2] for r in rows if r[2] == r[2]]
    print(f"\nOrientation within 3° of the truth for {np.mean(np.array(errs) < 3) * 100:.0f} % of {len(errs)} particles (median {np.median(errs):.1f}°); "
          f"structure called correctly for {np.mean([r[0] == r[1] for r in rows]) * 100:.0f} %. "
          "TKD cannot tell an epitaxial heterostructure from a single crystal: EDS (or HAADF in TEM-view) can.")
