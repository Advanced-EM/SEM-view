# Test automation: your own auto focus and stigmation against a hidden misalignment.
# The challenge hides where focus is and how astigmatic the column is; the score comes from the true optics.
import numpy as np
import semview as sv

sem = sv.connect()
task = sem.challenge("sem-focus-stig", seed=3)
print(task["task"])


def sharpness(**settings):
    sem.set(**settings)
    a = sem.acquire().image.astype(float)
    a = a - a.mean()
    gx, gy = np.diff(a, axis=1), np.diff(a, axis=0)
    return (gx ** 2).mean() + (gy ** 2).mean()


def search(key, lo, hi, n=14):
    """golden-section search for the sharpest setting of one knob"""
    g = (5 ** 0.5 - 1) / 2
    a, b = lo, hi
    c, d = b - g * (b - a), a + g * (b - a)
    fc, fd = sharpness(**{key: c}), sharpness(**{key: d})
    for _ in range(n):
        if fc > fd:
            b, d, fd = d, c, fc
            c = b - g * (b - a)
            fc = sharpness(**{key: c})
        else:
            a, c, fc = c, d, fd
            d = a + g * (b - a)
            fd = sharpness(**{key: d})
    best = (a + b) / 2
    sem.set(**{key: best})
    return best


for rnd in range(2):
    f = search("focus_um", -0.7, 0.7)
    x = search("stig_x", -2, 2)
    y = search("stig_y", -2, 2)
    print(f"round {rnd + 1}: focus {f:+.3f} µm, stigmator ({x:+.3f}, {y:+.3f})")

print("score:", sem.score())
print("hidden:", sem.reveal()["hidden"])
sem.end_challenge()
