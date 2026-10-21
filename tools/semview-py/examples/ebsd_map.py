# An EBSD orientation map: Euler angles per point, then how well it indexed.
import numpy as np
import semview as sv

sem = sv.connect()
sem.set(mode="ebsd", specimen="ni", map_size=24)
m = sem.acquire()                   # runs the map to the end first
phi1 = m["euler_phi1"]
print(m, f"{np.isfinite(phi1).mean() * 100:.0f} % indexed")
print(sem.analyze("index_ebsd")["summary"])
sv.show(np.nan_to_num(phi1), "φ1 (°)")
