// Instrument and UI state: one plain object, so a session saves as JSON and the simulator runs headless
// (tools/headless.mjs, tools/semview-py, tools/semview-mcp) with exactly the defaults the exhibit uses.
import { newProfile } from './profile.js';

export const defaultState = () => ({
  mode: 'se', clarity: 'edu', spec: 'sn', fov: 20, cx: 0, cy: 0, tilt: 0, coated: false,
  kV: 5, current: 100, aperture: 30, wd: 5, focus: 0, stigX: 0, stigY: 0, apX: 0, apY: 0, dwell: 2, wobble: false,
  etdBias: 250, bseMode: 'comp', seg: { A: 1, B: 1, C: 1, D: 1 },
  mapN: 40, expo: 10, mapView: 'ipf', showHough: true, tkdThick: 90,
  edsSel: 'all', mcMax: 2500,
  clMode: 'pan', clLam: 450, clBand: 10,
  speed: 1, paused: false, showLabels: true, showElectrons: true, showGlass: true, autoRotate: false,
  profile: newProfile('schottky'),
  // hidden misalignment added to the knob settings (training scenarios); never shown in the controls
  mis: null,
});

// keys a saved session may set (UI-only toggles are left alone)
export const SESSION_KEYS = ['mode', 'clarity', 'spec', 'fov', 'cx', 'cy', 'tilt', 'coated', 'kV', 'current', 'aperture', 'wd', 'focus', 'stigX', 'stigY', 'apX', 'apY',
  'dwell', 'etdBias', 'bseMode', 'seg', 'mapN', 'expo', 'mapView', 'tkdThick', 'edsSel', 'mcMax', 'clMode', 'clLam', 'clBand', 'profile', 'mis'];
