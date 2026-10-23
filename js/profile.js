// Instrument profile: the numbers that make the simulator a twin of one particular SEM.
// Everything that is a property of the instrument (not of today's settings) lives here, so it can be
// calibrated from data, saved with a session and exchanged as JSON.
//
//  gun and lenses (all imaging, probe size): Br reduced brightness (A m⁻² sr⁻¹ V⁻¹), dE energy spread (eV),
//    CsK / CcK spherical and chromatic aberration at a 4 mm working distance (mm)
//  scan (SE, BSE, EBSD, EDS maps): magCal = true / nominal field of view, scanAspect (y / x pixel), scanShear (°)
//  EDS: edsFWHM (eV at Mn Kα), edsGain (true / nominal energy scale), edsOffset (zero offset, eV)
export const PROFILE_FORMAT = 'sem-view-profile/1';

const COMMON = { magCal: 1, scanAspect: 1, scanShear: 0, edsFWHM: 128, edsGain: 1, edsOffset: 0 };
// generic instrument classes, not specific commercial models
export const PRESETS = {
  schottky: { ...COMMON, name: 'Field-emission SEM, Schottky gun', gun: 'Schottky FEG', Br: 1e8, dE: 0.7, CsK: 0.9, CcK: 1.1 },
  coldfeg: { ...COMMON, name: 'Ultra-high-resolution SEM, cold FEG', gun: 'Cold FEG', Br: 5e8, dE: 0.3, CsK: 0.6, CcK: 0.8, edsFWHM: 125 },
  tungsten: { ...COMMON, name: 'Conventional SEM, tungsten hairpin', gun: 'Thermionic W', Br: 1e5, dE: 1.8, CsK: 2.5, CcK: 2.2, edsFWHM: 133 },
};

// editable fields: key, label, unit, min, max (used by the profile editor and to validate files)
export const FIELDS = [
  ['Br', 'Reduced brightness', 'A/m²·sr·V', 1e3, 1e10], ['dE', 'Energy spread (FWHM)', 'eV', 0.1, 4],
  ['CsK', 'Spherical aberration Cs (at 4 mm WD)', 'mm', 0.05, 20], ['CcK', 'Chromatic aberration Cc (at 4 mm WD)', 'mm', 0.05, 20],
  ['magCal', 'Magnification calibration (true / nominal)', '×', 0.5, 2], ['scanAspect', 'Scan aspect (y / x pixel size)', '×', 0.7, 1.3], ['scanShear', 'Scan shear', '°', -10, 10],
  ['edsFWHM', 'EDS resolution at Mn Kα', 'eV', 110, 250], ['edsGain', 'EDS energy gain (true / nominal)', '×', 0.9, 1.1], ['edsOffset', 'EDS zero offset', 'eV', -100, 100],
];

export const newProfile = (key = 'schottky') => ({ format: PROFILE_FORMAT, preset: key, calibrated: {}, ...structuredClone(PRESETS[key]) });

// a profile from a file: keep known fields, fill the rest from its preset, refuse values out of range
export function sanitizeProfile(o) {
  if (!o || typeof o !== 'object') throw new Error('not a profile');
  const base = newProfile(PRESETS[o.preset] ? o.preset : 'schottky');
  for (const k of Object.keys(base)) if (k in o && typeof o[k] === typeof base[k] && typeof o[k] !== 'object') base[k] = o[k];
  if (typeof o.name === 'string') base.name = o.name.slice(0, 120);
  if (typeof o.gun === 'string') base.gun = o.gun.slice(0, 60);
  if (o.calibrated && typeof o.calibrated === 'object') base.calibrated = JSON.parse(JSON.stringify(o.calibrated));
  for (const [k, label, , lo, hi] of FIELDS) if (!(base[k] >= lo && base[k] <= hi)) throw new Error(`${label} out of range (${base[k]})`);
  return base;
}

// a "mystery" instrument for practising calibration: the same preset with hidden, plausible miscalibrations
export function mysteryProfile(rng, key = 'schottky') {
  const p = newProfile(key), u = (a, b) => a + (b - a) * rng();
  Object.assign(p, { magCal: +u(0.94, 1.06).toFixed(4), scanAspect: +u(0.97, 1.03).toFixed(4), scanShear: +u(-1.5, 1.5).toFixed(2), edsFWHM: Math.round(u(122, 150)), edsGain: +u(0.99, 1.01).toFixed(4), edsOffset: +u(-25, 25).toFixed(1), Br: +(p.Br * u(0.4, 1.6)).toPrecision(2) });
  p.name = 'Mystery instrument'; p.preset = key;
  return p;
}
