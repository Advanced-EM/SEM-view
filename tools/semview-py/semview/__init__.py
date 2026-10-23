"""semview: script the SEM-view scanning electron microscope simulator from Python.

    import semview as sv
    sem = sv.connect()                      # headless on a desktop; the open exhibit inside its Python IDE
    sem.set(mode="bse", specimen="ni", kV=15)
    img = sem.acquire()                     # NumPy arrays with calibrations
    sv.show(img)

Backends, all with the same calls:
    sv.connect("headless")   the simulator in a Node.js process, no browser (needs Node 20+)
    sv.connect("live")       an exhibit open in a browser: select "Connect agent" there (needs `websockets`)
    sv.connect("browser")    inside the exhibit's Python IDE (Pyodide); the default there
"""
from .microscope import Microscope, Acquisition, connect, show, in_browser

__all__ = ["Microscope", "Acquisition", "connect", "show", "in_browser"]
__version__ = "0.1.0"
