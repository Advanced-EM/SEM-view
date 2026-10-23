# Quick start: set the microscope, acquire, show. Runs headless, live or in the exhibit's IDE.
import semview as sv

sem = sv.connect()
sem.set(mode="se", specimen="sn", kV=5, current_pA=100, fov_um=5)
print(sem.state()["probe_nm"], "nm probe")
img = sem.acquire()
print(img, img.calibration["pixel_um"] * 1000, "nm per pixel")
sv.show(img, "SE image, tin spheres on carbon")
