# 3D relief from the four BSE quadrants, with your own NumPy reconstruction next to the built-in one.
import numpy as np
import semview as sv

sem = sv.connect()
sem.set(mode="bse", specimen="grid", kV=10, fov_um=2, dwell_us=10)
a = sem.acquire()
A, B, C, D = (a[f"segment_{q}"].astype(float) for q in "ABCD")
px = a.calibration["pixel_um"]
# opposite quadrants differ by the surface slope
nx, ny = (A - B) / (A + B + 1e-9) / 2.4, (C - D) / (C + D + 1e-9) / 2.4
nz = np.sqrt(np.clip(1 - nx ** 2 - ny ** 2, 0.05, 1))
p, q = -nx / nz, ny / nz          # dh/dx; dh/dy with rows running down
# Frankot–Chellappa: the least-squares surface with those slopes
n = A.shape[0]
wx = 2 * np.pi * np.fft.fftfreq(n)[None, :]
wy = 2 * np.pi * np.fft.fftfreq(n)[:, None]
d = wx ** 2 + wy ** 2
d[0, 0] = 1
H = (-1j * wx * np.fft.fft2(p) - 1j * wy * np.fft.fft2(q)) / d
H[0, 0] = 0
h = np.real(np.fft.ifft2(H)) * px
print(f"my relief: Rq {h.std() * 1000:.1f} nm")
print(sem.analyze("reconstruct_relief")["summary"])     # emskills sem-topography
sv.show(h, "height (µm) from quadrants A–D")
