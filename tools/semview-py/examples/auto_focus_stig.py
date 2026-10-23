# Test automation: your own auto focus and stigmation against a hidden misalignment.
# The challenge hides where focus is and how astigmatic the column is; the score comes from the true optics.
# The algorithm sees only what a real SEM gives it: images. Run with a seed: python auto_focus_stig.py 3
import sys

import numpy as np
import semview as sv


def sharpness(sem, **settings):
    """image gradient energy: largest when the probe is smallest"""
    sem.set(**settings)
    a = sem.acquire().image.astype(float)
    a = a - a.mean()
    gx, gy = np.diff(a, axis=1), np.diff(a, axis=0)
    return (gx ** 2).mean() + (gy ** 2).mean()


def search(sem, key, lo, hi, n=14):
    """golden-section search for the sharpest setting of one knob"""
    g = (5 ** 0.5 - 1) / 2
    a, b = lo, hi
    c, d = b - g * (b - a), a + g * (b - a)
    fc, fd = sharpness(sem, **{key: c}), sharpness(sem, **{key: d})
    for _ in range(n):
        if fc > fd:
            b, d, fd = d, c, fc
            c = b - g * (b - a)
            fc = sharpness(sem, **{key: c})
        else:
            a, c, fc = c, d, fd
            d = a + g * (b - a)
            fd = sharpness(sem, **{key: d})
    best = (a + b) / 2
    sem.set(**{key: best})
    return best


def align(sem, rounds=2, verbose=True):
    """focus, then stigmator X and Y, twice: each search over the knob's full range"""
    for r in range(rounds):
        f = search(sem, "focus_um", -0.7, 0.7)
        x = search(sem, "stig_x", -2, 2)
        y = search(sem, "stig_y", -2, 2)
        if verbose:
            print(f"round {r + 1}: focus {f:+.3f} µm, stigmator ({x:+.3f}, {y:+.3f})")


if __name__ == "__main__":
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 3  # the IDE has no arguments: seed 3
    sem = sv.connect()
    task = sem.challenge("sem-focus-stig", seed=seed)
    print(task["task"])
    align(sem)
    print("score:", sem.score())
    print("hidden:", sem.reveal()["hidden"])
    sem.end_challenge()
