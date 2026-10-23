# Digital twin: calibrate magnification and scan distortion on a cross grating, then correct the profile.
import semview as sv

sem = sv.connect()
# pretend this instrument is miscalibrated (on a real SEM you would not know these numbers)
sem.profile(magCal=1.035, scanAspect=0.985, scanShear=0.9)
sem.set(mode="se", specimen="grid", kV=10, fov_um=4)
r = sem.analyze("calibrate_scale")              # emskills scalebar-calibrate
print(r["summary"])
fit = r["result"]
# store the measured calibration in the twin: the profile now describes this instrument
p = sem.profile(magCal=fit["magnification_calibration"], scanAspect=fit["scan_aspect"], scanShear=fit["scan_shear_deg"])
print("profile:", {k: p[k] for k in ("magCal", "scanAspect", "scanShear")})
