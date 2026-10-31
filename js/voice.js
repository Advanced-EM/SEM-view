// Commands for the SEM, typed in AI mode or spoken (push to talk: hold M, the on-screen panel's Talk button or the
// Console's talk key). The browser's speech recognition turns speech into text; parseCommand() turns text into
// exhibit operations with a small grammar ("switch to BSE", "load nickel", "20 kV", "focus plus 0.5", "auto focus",
// "acquire"). Near misses are spell-corrected and confirmed first; anything else goes to a connected agent.
//
// parseCommand() is pure and runs in Node too, so the grammar is tested without a browser (tests/voice.mjs).

const MODES = [
  ['cl', /\b(cl|c\s*l|cathodo\s*-?\s*luminescen\w*|luminescen\w*|light emission)\b/],
  ['tkd', /\b(tkd|t\s*k\s*d|transmission kikuchi|on\s*-?\s*axis kikuchi)\b/],
  ['ebsd', /\b(ebsd|e\s*b\s*s\s*d|orientation map(ping)?|kikuchi|backscatter(ed)? diffraction)\b/],
  ['mc', /\b(monte\s*-?\s*carlo|interaction volume|trajector(y|ies)|mc mode)\b/],
  ['eds', /\b(eds|edx|e\s*d\s*s|x\s*-?\s*rays?|xray|spectrum mode|element map)\b/],
  ['inlens', /\b(in\s*-?\s*lens|through\s*-?\s*the\s*-?\s*lens|tld|immersion)\b/],
  ['bse', /\b(bse|b\s*s\s*e|backscatter(ed)?( electrons?| detector)?)\b/],
  ['se', /\b(se|s\s*e|secondary( electrons?)?|etd|everhart(\s*-?\s*thornley)?)\b/],
];
const SPECS = [
  ['grid', /\b(grating|cross\s*-?\s*grating|calibration (standard|grating|sample)|463)\b/],
  ['gan', /\b(gan|gallium nitride|ingan|quantum wells?|led( wafer)?)\b/],
  ['sn', /\b(tin|sn|resolution standard|spheres)\b/],
  ['ni', /\b(nickel|ni|polycrystal(line)?|grains)\b/],
  ['chip', /\b(chip|cross\s*-?\s*section|interconnects?|copper lines|lamella)\b/],
  ['lib', /\b(mega\s*-?\s*librar(y|ies)|nanoparticle\s*librar(y|ies)|library)\b/],
];
const MODE_NAMES = { se: 'SE (Everhart–Thornley)', inlens: 'in-lens SE', bse: 'BSE', ebsd: 'EBSD', tkd: 'TKD', eds: 'EDS', mc: 'interaction volume (Monte Carlo)', cl: 'cathodoluminescence' };
const SPEC_NAMES = { sn: 'tin on carbon', ni: 'polycrystalline nickel', chip: 'the chip cross-section', grid: 'the 463 nm cross grating', gan: 'GaN with InGaN quantum wells', lib: 'the nanoparticle megalibrary' };

// "minus fifty two point five" → "-52.5"; digits pass through
const SMALL = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
function wordsToNumbers(text) {
  const tok = text.split(/\s+/), out = [];
  for (let i = 0; i < tok.length; i++) {
    let j = i, total = 0, cur = 0, any = false, frac = '';
    while (j < tok.length) {
      const w = tok[j];
      if (w in SMALL) cur += SMALL[w];
      else if (w in TENS) cur += TENS[w];
      else if (w === 'hundred' && any) cur *= 100;
      else if (w === 'thousand' && any) { total += cur * 1000; cur = 0; }
      else if ((w === 'point' || w === 'dot') && any && tok[j + 1] in SMALL) { while (tok[j + 1] in SMALL) { frac += SMALL[tok[j + 1]]; j++; } j++; break; }
      else if (w === 'and' && any && (tok[j + 1] in SMALL || tok[j + 1] in TENS)) { j++; continue; }
      else break;
      any = true; j++;
    }
    if (any) { out.push(String(total + cur) + (frac ? `.${frac}` : '')); i = j - 1; } else out.push(tok[i]);
  }
  return out.join(' ').replace(/\b(minus|negative)\s+(?=\d)/g, '-').replace(/\b(plus|positive)\s+(?=\d)/g, '+');
}

export function normalize(text) {
  return wordsToNumbers(String(text).toLowerCase().replace(/[−–—]/g, '-').replace(/[,!?]/g, ' ').replace(/(\d)\s*,\s*(\d)/g, '$1$2').replace(/\s+/g, ' ').trim());
}

const NUM = String.raw`([-+]?\d+(?:\.\d+)?)`;
const num = (s) => +s;
const UM = (v, u = '') => num(v) * (/^(nm|nanomet)/.test(u) ? 1e-3 : /^(mm|millimet)/.test(u) ? 1e3 : 1); // → µm

// text → { ops: [...] } or { ask: text }. ctx: { mode, paused }
export function parseCommand(raw, ctx = {}) {
  const t = normalize(raw);
  if (!t) return { ops: [] };
  const ops = [];
  const has = (re) => re.test(t);
  let m;

  // help and stop come first: they are short and easy to confuse with other commands
  if (has(/^(help|what can i say|commands|voice commands)\b/)) return { ops: [{ op: 'help' }] };
  if (has(/^(stop|quiet|be quiet|stop talking|shut up|silence)$/)) return { ops: [{ op: 'stopSpeech' }] };
  if (has(/\b(what am i (looking at|seeing)|what is (this|that)|explain( this| that| it)?|describe( this| it)?|tell me about (this|it))\b/)) return { ops: [{ op: 'narrate' }] };

  // analyses (emskills tools where the registry has one)
  const measureVerb = /\b(fit|count|measure|estimate|analy[sz]e|check|index|find|identify|calibrate|calculate|determine|reconstruct|map)\b|^(what|which|how (good|sharp))\b/;
  if (measureVerb.test(t)) {
    if (/\b(magnification|scale|scale bar|pixel size|grating|scan (aspect|shear|distortion))\b/.test(t)) return { ops: [{ op: 'analyze', v: 'calibrate_scale' }] };
    if (/\b(resolution|probe( size| diameter)?|spot size|edge width)\b/.test(t)) return { ops: [{ op: 'analyze', v: 'fit_resolution' }] };
    if (/\b(focus|astigmatism|stigmat\w*|sharp\w*)\b/.test(t) && !/\d/.test(t)) return { ops: [{ op: 'analyze', v: 'fit_focus' }] };
    if (/\b(relief|topograph\w*|height|3\s*-?\s*d|roughness|surface)\b/.test(t)) return { ops: [{ op: 'analyze', v: 'reconstruct_relief' }] };
    if (/\b(phases?)\b/.test(t)) return { ops: [{ op: 'analyze', v: 'phase_map' }] };
    if (/\b(peaks?|elements?|composition|eds|x\s*-?\s*rays?|detector resolution|energy scale)\b/.test(t)) return { ops: [{ op: 'analyze', v: 'fit_eds' }] };
    if (/\b(indexing|indexed|map quality|orientations?|ebsd|tkd|patterns?)\b/.test(t)) return { ops: [{ op: 'analyze', v: 'index_ebsd' }] };
    if (/\b(backscatter(ing)? coefficient|eta|range|penetration)\b/.test(t)) return { ops: [{ op: 'analyze', v: 'mc_summary' }] };
    if (/\b(dislocations?|dark spots|indium|luminescence|cl (peaks|bands|spectrum)|emission (peaks|bands))\b/.test(t)) return { ops: [{ op: 'analyze', v: 'fit_cl' }] };
  }
  if (/^(analy[sz]e|analysis|run (an |the )?analysis|measure (this|it)|fit (this|it))\b/.test(t)) return { ops: [{ op: 'analyze', v: null }] };

  // questions go to the agent, even when they mention a setting ("why does the alumina charge at 15 kV?")
  if (has(/^(why|how|when|where|who|which|what|what's|whats|is|are|does|do|did|should|would|will|explain why|tell me (why|how|what))\b/) || /\?\s*$/.test(String(raw))) return { ask: String(raw).trim() };

  // specimen: "load nickel", "put in the grating"
  const specHit = SPECS.find(([, re]) => re.test(t));
  if (specHit && has(/\b(load|insert|put in|switch to|change to|use|specimen|sample|show me|go to)\b/)) ops.push({ op: 'spec', v: specHit[0] });
  // mode: "switch to BSE", "EBSD mode", or just the mode name
  const modeHit = MODES.find(([, re]) => re.test(t));
  if (modeHit && !/\b(composition|topograph\w*|quadrant)\b/.test(t) && (has(/\b(switch|go|change|move|show|open|mode|take me|let's do|use|detector)\b/) || (!ops.length && t.split(' ').length <= 3))) ops.push({ op: 'mode', v: modeHit[0] });

  // focus and stigmator
  if (has(/\b(auto\s*-?\s*focus|focus (it|the image|for me)|auto\s*-?\s*stig\w*)\b/)) ops.push({ op: 'action', v: 'autofocus', said: 'Auto focus and stigmation' });
  else if ((m = t.match(new RegExp(String.raw`\bfocus(?:\s+(?:to|at|by))?\s+${NUM}\s*(nm|nanomet\w*|microns?|µm|um|mm)?`)))) ops.push({ op: 'set', k: 'focus', v: UM(m[1], m[2] ?? '') });
  else if (has(/\b(under\s*-?\s*focus|focus down|focus (in|closer))\b/)) ops.push({ op: 'nudge', d: -1 });
  else if (has(/\b(over\s*-?\s*focus|focus up|focus (out|further))\b/)) ops.push({ op: 'nudge', d: 1 });
  for (const ax of ['x', 'y']) if ((m = t.match(new RegExp(String.raw`\b(?:stig(?:mator)?|astigmatism)\s*${ax}(?:\s+(?:to|at))?\s+${NUM}`)))) ops.push({ op: 'set', k: ax === 'x' ? 'stigX' : 'stigY', v: num(m[1]) });

  // magnification and field of view
  if ((m = t.match(new RegExp(String.raw`\b(?:field of view|field|fov|horizontal field width|hfw)\s+(?:to\s+|of\s+)?${NUM}\s*(nm|nanomet\w*|microns?|µm|um|mm|millimet\w*)?`)))) ops.push({ op: 'set', k: 'fov', v: Math.abs(UM(m[1], m[2] ?? 'um')) });
  else if ((m = t.match(new RegExp(String.raw`\b(?:magnification|mag)\s+(?:to\s+|of\s+)?${NUM}\s*(k|thousand)?\b`))) || (m = t.match(/\b(\d+(?:\.\d+)?)\s*(k|thousand)?\s*(x|times)\b/))) ops.push({ op: 'set', k: 'fov', v: +(127000 / (Math.abs(num(m[1])) * (m[2] ? 1000 : 1))).toPrecision(4) });
  else if (has(/\bzoom in\b|\b(more|increase|higher) magnification\b|\bmagnify\b/)) ops.push({ op: 'zoom', f: 1 / 1.6 });
  else if (has(/\bzoom out\b|\b(less|decrease|lower) magnification\b/)) ops.push({ op: 'zoom', f: 1.6 });

  // beam: voltage, current, aperture, working distance
  if ((m = t.match(/\b(\d+(?:\.\d+)?)\s*-?\s*(kv|k v|kilo\s*-?\s*volts?|kilovolts?|kev)\b/)) || (m = t.match(/\b(?:voltage|high tension|accelerating|acceleration|hv)\b\D{0,24}(\d+(?:\.\d+)?)\b/))) ops.push({ op: 'set', k: 'kV', v: num(m[1]) });
  if ((m = t.match(new RegExp(String.raw`\b(?:probe |beam )?current(?:\s+(?:to|of))?\s+${NUM}\s*(pa|picoamps?|na|nanoamps?)?`))) || (m = t.match(/\b(\d+(?:\.\d+)?)\s*(pa|picoamps?|na|nanoamps?)\b/))) ops.push({ op: 'set', k: 'current', v: Math.abs(num(m[1])) * (/^n/.test(m[2] ?? 'pa') ? 1000 : 1) });
  else if (has(/\b(more|increase|higher|raise) (current|beam current|probe current)\b|\bbrighter\b/)) ops.push({ op: 'scale', k: 'current', f: 2 });
  else if (has(/\b(less|decrease|lower|reduce) (current|beam current|probe current)\b|\bdimmer\b/)) ops.push({ op: 'scale', k: 'current', f: 0.5 });
  if ((m = t.match(new RegExp(String.raw`\baperture(?:\s+(?:to|of))?\s+${NUM}`)))) ops.push({ op: 'set', k: 'aperture', v: Math.abs(num(m[1])) });
  if ((m = t.match(new RegExp(String.raw`\b(?:working distance|wd)(?:\s+(?:to|of))?\s+${NUM}`)))) ops.push({ op: 'set', k: 'wd', v: Math.abs(num(m[1])) });

  // stage, scan and specimen
  if (has(/\b(untilt|reset (the )?tilt|tilt (to )?(zero|flat)|flat stage)\b/)) ops.push({ op: 'set', k: 'tilt', v: 0 });
  else if ((m = t.match(new RegExp(String.raw`\btilt(?:\s+(?:the stage|the sample|it))?(?:\s+(?:to|by|at))?\s+${NUM}`)))) ops.push({ op: 'set', k: 'tilt', v: num(m[1]) });
  if ((m = t.match(new RegExp(String.raw`\b(?:dwell(?: time)?|pixel time)(?:\s+(?:to|of))?\s+${NUM}`)))) ops.push({ op: 'set', k: 'dwell', v: Math.abs(num(m[1])) });
  else if (has(/\b(scan faster|faster scan|tv rate|fast scan)\b/)) ops.push({ op: 'scale', k: 'dwell', f: 0.4 });
  else if (has(/\b(scan slower|slower scan|slow scan|photo scan)\b/)) ops.push({ op: 'scale', k: 'dwell', f: 2.5 });
  if (has(/\b(remove|no|without|take off)( the)? (carbon )?coat(ing)?\b|\buncoat(ed)?\b/)) ops.push({ op: 'set', k: 'coated', v: false });
  else if (has(/\b(coat|carbon coat(ing)?|sputter)\b/)) ops.push({ op: 'set', k: 'coated', v: true });
  if ((m = t.match(new RegExp(String.raw`\b(?:grid|cage|faraday cage|collector)(?: bias)?(?:\s+(?:to|of))?\s+${NUM}`)))) ops.push({ op: 'set', k: 'etdBias', v: num(m[1]) });
  if (has(/\bcomposition(al)?( contrast| mode)?\b|\ball (four )?quadrants\b/)) ops.push({ op: 'chip', k: 'bseMode', v: 'comp' });
  else if (has(/\btopograph\w*( contrast| mode)?\b/)) ops.push({ op: 'chip', k: 'bseMode', v: /\b(vertical|y|up|c\s*-?\s*minus\s*d)\b/.test(t) ? 'topoY' : 'topoX' });

  // cathodoluminescence: a monochromator wavelength, or panchromatic
  if ((m = t.match(new RegExp(String.raw`\b(?:wavelength|monochromator|lambda)(?:\s+(?:to|at|of))?\s+${NUM}`))) || (!has(/\b(field|fov|view|hfw|width|focus)\b/) && (m = t.match(/\b(\d{3})\s*(?:nm|nanomet\w*)\b/)))) { if (+m[1] >= 300 && +m[1] <= 800) ops.push({ op: 'set', k: 'clLam', v: +m[1] }); }
  if ((m = t.match(new RegExp(String.raw`\bband\s*(?:width|pass)?(?:\s+(?:to|of))?\s+${NUM}`)))) ops.push({ op: 'set', k: 'clBand', v: Math.abs(num(m[1])) });
  if (has(/\bpan\s*-?\s*chromatic\b|\ball (the )?light\b/)) ops.push({ op: 'set', k: 'clMode', v: 'pan' });
  else if (has(/\bmono\s*-?\s*chromatic\b/) && !ops.some((o) => o.k === 'clLam')) ops.push({ op: 'set', k: 'clMode', v: 'mono' });

  // beam and view
  if (has(/\b(unblank|resume|unpause|beam on|turn on the beam|restore the beam)\b/)) { if (ctx.paused) ops.push({ op: 'action', v: 'pause', said: 'Beam on' }); }
  else if (has(/\b(blank|stop|pause|turn off|block)( the)? beam\b|^pause$|\bbeam off\b/)) { if (!ctx.paused) ops.push({ op: 'action', v: 'pause', said: 'Beam blanked' }); }
  if (has(/\b(realistic|real mode|physically realistic|shot noise)\b/)) ops.push({ op: 'set', k: 'clarity', v: 'real' });
  else if (has(/\b(educational|clean view|clarity mode)\b/)) ops.push({ op: 'set', k: 'clarity', v: 'edu' });
  if (has(/\bwobbler\b|\bwobble\b/)) ops.push({ op: 'wobbler' });
  if (has(/\b(training|training mode|start a task)\b/)) ops.push({ op: 'training' });
  if (has(/\brestart( the)? (map|mapping)\b|\bnew map\b/)) ops.push({ op: 'action', v: 'remap', said: 'Map restarted' });
  if (has(/\brestart( the)? (simulation|monte carlo|trajectories)\b/)) ops.push({ op: 'action', v: 'remc', said: 'Monte Carlo restarted' });
  if (has(/\b(show|turn on) (the )?labels\b/)) ops.push({ op: 'set', k: 'showLabels', v: true });
  else if (has(/\b(hide|turn off) (the )?labels\b/)) ops.push({ op: 'set', k: 'showLabels', v: false });
  if (has(/\bnext mode\b/)) ops.push({ op: 'cycle', d: 1 });
  else if (has(/\bprevious mode\b|\blast mode\b/)) ops.push({ op: 'cycle', d: -1 });
  if (has(/\b(export|download)( the)? (data|numpy|npz)\b/)) ops.push({ op: 'export' });

  // acquisition (last, so "switch to BSE and acquire" sets the mode first)
  if (has(/\b(acquire|capture|snap|photo)\b|\b(take|record|grab|save)\s+(an?\s+|the\s+|this\s+)?(image|picture|photo|frame|spectrum|map|pattern|shot|acquisition)\b/)) ops.push({ op: 'acquire' });

  return ops.length ? { ops } : { ask: String(raw).trim() };
}

export const HELP = 'Try: "switch to BSE", "load nickel", "20 kV", "current 1 nA", "auto focus", "focus plus 0.5", "stigmator x 0.3", "field of view 5 microns", "tilt 70", "coat the sample", "acquire". Measure: "calibrate the magnification", "measure the resolution", "check the astigmatism", "reconstruct the relief", "fit the EDS peaks", "map the phases". Or ask a question.';
const ANALYSIS_NAMES = { fit_cl: 'Fit the CL bands and count dislocations', calibrate_scale: 'Calibrate the scale on the grating (emskills scalebar-calibrate)', reconstruct_relief: 'Reconstruct the 3D relief (emskills sem-topography)', phase_map: 'Map the phases (emskills edax-phase-map)', fit_eds: 'Fit the EDS peaks', fit_resolution: 'Measure the resolution', fit_focus: 'Measure focus and astigmatism', index_ebsd: 'Check the EBSD map', mc_summary: 'Summarize the Monte Carlo' };
export const EXAMPLES = ['switch to BSE', 'in-lens mode', 'EBSD', 'load nickel', 'load the grating', '20 kV', 'current 1 nA', 'aperture 30', 'working distance 10', 'auto focus', 'focus plus 0.5', 'stigmator x 0.3', 'stigmator y minus 0.2',
  'zoom in', 'field of view 5 microns', 'magnification 20000', 'tilt 70', 'dwell 5', 'scan slower', 'coat the sample', 'grid bias minus 100', 'topography', 'composition', 'wobbler', 'realistic', 'acquire',
  'calibrate the magnification', 'measure the resolution', 'check the astigmatism', 'reconstruct the relief', 'fit the EDS peaks', 'map the phases', 'check the indexing', 'what is the backscatter coefficient', 'cathodoluminescence', 'load GaN', 'wavelength 450', 'panchromatic', 'count the dislocations', 'analyze', 'what am I looking at?', 'help'];

// ------------------------------------------------------------------ near misses: correct, suggest, then confirm
const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'is', 'are', 'me', 'please', 'can', 'you', 'it', 'this', 'and', 'my', 'for', 'with', 'now']);
const EXTRA = ['cathodoluminescence', 'luminescence', 'wavelength', 'panchromatic', 'monochromatic', 'dislocations', 'gan', 'indium', 'bse', 'backscatter', 'backscattered', 'secondary', 'lens', 'inlens', 'ebsd', 'tkd', 'eds', 'edx', 'monte', 'carlo', 'interaction', 'volume', 'kikuchi',
  'tin', 'nickel', 'chip', 'grating', 'standard', 'focus', 'autofocus', 'stigmator', 'stig', 'astigmatism', 'zoom', 'magnification', 'current', 'aperture', 'working', 'distance',
  'tilt', 'dwell', 'scan', 'faster', 'slower', 'coat', 'coating', 'carbon', 'bias', 'grid', 'composition', 'topography', 'relief', 'phases', 'phase', 'map', 'resolution', 'probe',
  'calibrate', 'beam', 'blank', 'unblank', 'acquire', 'capture', 'labels', 'export', 'analyze', 'measure', 'fit', 'peaks', 'elements', 'load', 'switch', 'show', 'realistic',
  'educational', 'wobbler', 'training', 'explain', 'field', 'view', 'nm', 'mm', 'kv', 'pa', 'na', 'next', 'previous', 'mode', 'restart', 'simulation', 'help', 'stop', 'index',
  'which', 'what', 'turn', 'off', 'microns', 'nanometers', 'degrees', 'minus', 'plus', 'more', 'less', 'out', 'hide', 'quadrant'];
let VOCAB = null;
const vocab = () => VOCAB ?? (VOCAB = new Set([...EXAMPLES.flatMap((e) => normalize(e).split(' ')), ...EXTRA].filter((w) => !/\d/.test(w))));
function lev(a, b) {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
const wsim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length);

// replace misspelled words by the closest vocabulary word ("swich to stm" → "switch to stem")
export function correct(raw) {
  const words = normalize(raw).split(' '), V = vocab();
  let changed = false;
  const out = words.map((w) => {
    if (w.length < 3 || /\d/.test(w) || STOP.has(w) || V.has(w)) return w;
    let best = w, bs = 0;
    for (const v of V) { const sc = wsim(w, v); if (sc > bs) { bs = sc; best = v; } }
    if (bs >= 0.6 && best !== w) { changed = true; return best; }
    return w;
  });
  return { text: out.join(' '), changed };
}

// the closest known commands, with the visitor's own numbers carried over
function closestExamples(raw, ctx, k = 3) {
  const inW = normalize(raw).split(' ').filter((w) => !STOP.has(w));
  const nums = inW.filter((w) => /^[-+]?\d/.test(w));
  const scored = EXAMPLES.map((ex) => {
    const exW = normalize(ex).split(' ').filter((w) => !STOP.has(w) && !/\d/.test(w));
    if (!exW.length) return [ex, 0];
    const sc = exW.reduce((a, w) => a + Math.max(0, ...inW.map((x) => wsim(w, x))), 0) / exW.length;
    let n = 0, text = ex;
    if (nums.length) text = ex.replace(/[-+]?\d+(\.\d+)?/g, (m) => (n < nums.length ? nums[n++] : m));
    return [text, sc];
  }).filter(([, sc]) => sc >= 0.55).sort((a, b) => b[1] - a[1]);
  const seen = new Set(), out = [];
  for (const [text] of scored) {
    if (seen.has(text)) continue; seen.add(text);
    const r = parseCommand(text, ctx);
    if (r.ops) out.push({ text, ops: r.ops });
    if (out.length >= k) break;
  }
  return out;
}

const QUESTION = /^(why|how|when|where|who|which|what|is|are|does|do|did|should|would|will|explain|tell me)\b/;
// exact command → run; near miss → options to confirm; otherwise a question for the agent
export function interpret(raw, ctx = {}) {
  const r = parseCommand(raw, ctx);
  if (r.ops) return { exact: true, ops: r.ops };
  const c = correct(raw);
  if (c.changed) { const r2 = parseCommand(c.text, ctx); if (r2.ops) return { exact: false, options: [{ text: c.text, ops: r2.ops }] }; }
  const isQuestion = QUESTION.test(normalize(raw)) || /\?\s*$/.test(raw);
  const options = isQuestion && ctx.agent ? [] : closestExamples(c.text, ctx);
  return options.length ? { exact: false, options, question: isQuestion } : { ask: String(raw).trim() };
}

// describe what an op did, for the caption
export function describe(op) {
  const f = (v, d = 2) => +(+v).toFixed(d);
  switch (op.op) {
    case 'mode': return `Mode: ${MODE_NAMES[op.v]}`;
    case 'spec': return `Specimen: ${SPEC_NAMES[op.v]}`;
    case 'set': return ({ focus: () => `Focus ${op.v > 0 ? '+' : ''}${f(op.v, 3)} µm`, fov: () => `Field of view ${op.v >= 1 ? `${f(op.v, 2)} µm` : `${f(op.v * 1000, 0)} nm`}`, kV: () => `${op.v} kV`, current: () => (op.v >= 1000 ? `Probe current ${f(op.v / 1000, 2)} nA` : `Probe current ${f(op.v, 0)} pA`),
      aperture: () => `Aperture ${op.v} µm`, wd: () => `Working distance ${op.v} mm`, tilt: () => `Tilt ${op.v}°`, dwell: () => `Dwell ${op.v} µs`, stigX: () => `Stigmator X ${op.v}`, stigY: () => `Stigmator Y ${op.v}`,
      coated: () => (op.v ? 'Carbon coating on' : 'Coating removed'), clLam: () => `CL at ${op.v} nm`, clBand: () => `CL bandwidth ${op.v} nm`, clMode: () => (op.v === 'pan' ? 'Panchromatic CL' : 'Monochromatic CL'), etdBias: () => `ETD grid ${op.v} V`, clarity: () => (op.v === 'real' ? 'Physically realistic view' : 'Educational view'), showLabels: () => (op.v ? 'Labels on' : 'Labels off') }[op.k] ?? (() => `${op.k} ${op.v}`))();
    case 'chip': return op.k === 'bseMode' ? `BSE: ${{ comp: 'composition (A+B+C+D)', topoX: 'topography (A−B)', topoY: 'topography (C−D)' }[op.v]}` : `${op.k} ${op.v}`;
    case 'nudge': return op.d < 0 ? 'Focus down' : 'Focus up';
    case 'zoom': return op.f < 1 ? 'Zoom in' : 'Zoom out';
    case 'scale': return op.k === 'dwell' ? (op.f > 1 ? 'Slower scan' : 'Faster scan') : op.f > 1 ? 'More current' : 'Less current';
    case 'action': return op.said ?? op.v;
    case 'acquire': return 'Acquired';
    case 'wobbler': return 'Wobbler';
    case 'narrate': return 'Explaining this mode';
    case 'training': return 'Training';
    case 'help': return HELP;
    case 'analyze': return op.result ? `${op.result.summary} [${op.result.emskills.in_registry ? `emskills ${op.result.emskills.skill}` : `not in emskills yet${op.result.emskills.related ? `; related: ${op.result.emskills.related}` : ''}`}]` : op.error ?? ANALYSIS_NAMES[op.v] ?? 'Analyze what is on screen';
    case 'cycle': return op.d > 0 ? 'Next mode' : 'Previous mode';
    case 'export': return 'Exporting the data';
    case 'stopSpeech': return 'Stopped';
    default: return '';
  }
}

// ------------------------------------------------------------------------------------------------ browser side
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* private mode */ } return null; };

export class Voice {
  // api: { ctx(), run(op), agent: { connected, utterance(text) }, onEvent(kind, data) }
  constructor(api) {
    this.api = api; this.rec = null; this.listening = false; this.text = ''; this.final = '';
    const R = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    this.Recognition = R || null;
  }
  get supported() { return !!this.Recognition; }

  // the first time: say what happens to the audio, and ask
  consent() {
    if (store('sem-voice-ok') === '1') return Promise.resolve(true);
    return new Promise((resolve) => {
      const m = this.bubble(`<b>Voice commands</b><p>Hold <kbd>M</kbd> (or the Talk key) and speak; release to send. Your browser's speech recognition turns it into text. In Chrome and Edge the audio is sent to Google's or Microsoft's speech service; Safari may process it on the device. Nothing is recorded by this exhibit, and the microphone is only on while you hold the key.</p>
        <div class="vrow"><button class="btn primary" id="vOk">Turn on voice</button><button class="btn" id="vNo">Not now</button></div>`, true);
      m.querySelector('#vOk').onclick = () => { store('sem-voice-ok', '1'); this.hide(); resolve(true); };
      m.querySelector('#vNo').onclick = () => { this.hide(); resolve(false); };
    });
  }

  async start() {
    if (this.listening) return;
    if (!this.supported) { this.bubble('<b>Voice commands</b><p>This browser has no speech recognition. Use Chrome, Edge or Safari, or type a command below.</p>' + this.typeBox()); this.wireType(); return; }
    if (!(await this.consent())) return;
    const rec = new this.Recognition();
    rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
    this.text = ''; this.final = ''; this.rec = rec; this.listening = true;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) this.final += r[0].transcript + ' '; else interim += r[0].transcript; }
      this.text = (this.final + interim).trim();
      this.bubble(`<span class="mic on"></span><i>${esc(this.text) || 'Listening…'}</i>`);
    };
    rec.onerror = (e) => { if (e.error !== 'aborted' && e.error !== 'no-speech') this.bubble(`<b>Voice</b><p>${e.error === 'not-allowed' ? 'Microphone access was blocked. Allow it in the browser\'s site settings to use voice.' : `Speech recognition stopped (${esc(e.error)}).`}</p>`); this.listening = false; };
    rec.onend = () => { const said = (this.final || this.text).trim(); this.listening = false; this.rec = null; if (this.releasing) { this.releasing = false; this.handle(said); } };
    this.bubble('<span class="mic on"></span><i>Listening…</i>');
    this.api.onEvent?.('listening', true);
    try { rec.start(); } catch { this.listening = false; }
  }
  stop() {
    if (!this.rec) return;
    this.releasing = true;
    try { this.rec.stop(); } catch { /* already stopped */ }
    this.api.onEvent?.('listening', false);
  }

  // run a sentence: exact commands run; near misses are confirmed first; everything else goes to the agent
  handle(text, typed = false) {
    text = String(text ?? '').trim();
    if (!text) { if (!typed) this.flash('<i>Didn\'t hear anything.</i>'); return; }
    const t = normalize(text);
    if (this.pending && Date.now() < this.pending.until) {
      const p = this.pending, pick = /^(yes|yeah|yep|yup|correct|right|ok|okay|sure|do it|go( ahead)?|confirm|y|1|first( one)?|the first( one)?)$/.test(t) ? 0
        : /^(2|second( one)?|the second( one)?)$/.test(t) ? 1 : /^(3|third( one)?|the third( one)?)$/.test(t) ? 2 : -1;
      if (pick >= 0 && p.options[pick]) { this.pending = null; this.runOps(p.options[pick].ops, p.options[pick].text, typed); return; }
      if (/^(no|nope|n|cancel|never mind|nevermind|wrong|neither|none)$/.test(t)) { this.pending = null; this.flash('<i>Cancelled.</i>', 2000); return; }
      this.pending = null; // a new sentence replaces the question
    }
    const r = interpret(text, { ...this.api.ctx(), agent: !!this.api.agent?.connected });
    if (r.exact) { this.runOps(r.ops, text, typed); return; }
    if (r.options) { this.confirm(text, r.options, typed); return; }
    this.api.onEvent?.('voice', { intent: 'ask', ok: !!this.api.agent?.connected });
    if (this.api.agent?.connected) { this.api.agent.utterance(text); this.flash(`<span class="mic${typed ? ' typed' : ''}"></span><i>“${esc(text)}”</i><b>Asked the agent…</b>`, 4000); }
    else this.flash(`<span class="mic${typed ? ' typed' : ''}"></span><i>“${esc(text)}”</i><p>That isn't a command I know. ${esc(HELP)}</p>`, 9000);
  }

  runOps(ops, text, typed) {
    const lines = ops.map((op) => { this.api.run(op); return describe(op); }).filter(Boolean);
    this.api.onEvent?.('voice', { intent: ops.map((o) => o.op + (o.v !== undefined && o.v !== null ? `:${o.v}` : o.k ? `:${o.k}` : '')).join(','), ok: true });
    const long = ops.some((o) => o.op === 'help' || o.op === 'analyze');
    this.flash(`<span class="mic${typed ? ' typed' : ''}"></span><i>“${esc(text)}”</i><b>${esc(lines.join(' · '))}</b>`, long ? 12000 : 3500);
  }

  // "Did you mean …?" with buttons; answer by clicking, or by saying/typing yes, no, or "the second one"
  confirm(text, options, typed) {
    this.pending = { options, until: Date.now() + 30000 };
    const agentBtn = this.api.agent?.connected ? '<button class="btn" data-c="agent">Ask the agent instead</button>' : '';
    const el = this.bubble(`<span class="mic${typed ? ' typed' : ''}"></span><i>“${esc(text)}”</i><b>Did you mean${options.length > 1 ? ' one of these' : ''}?</b>
      <div class="vrow">${options.map((o, i) => `<button class="btn${i ? '' : ' primary'}" data-c="${i}">${esc(o.text)} <small>${esc(o.ops.map(describe).join(' · '))}</small></button>`).join('')}
      <button class="btn" data-c="no">No</button>${agentBtn}</div><p>Click, or say or type “yes”${options.length > 1 ? ', “the second one”' : ''} or “no”.</p>`, true);
    el.querySelectorAll('[data-c]').forEach((b) => { b.onclick = () => {
      const c = b.dataset.c, p = this.pending; this.pending = null;
      if (c === 'no') this.flash('<i>Cancelled.</i>', 2000);
      else if (c === 'agent') { this.api.agent.utterance(text); this.flash(`<i>“${esc(text)}”</i><b>Asked the agent…</b>`, 4000); }
      else if (p?.options[+c]) this.runOps(p.options[+c].ops, p.options[+c].text, typed);
    }; });
    this.tm = setTimeout(() => { if (this.pending) { this.pending = null; this.hide(); } }, 30000);
  }

  // Esc: cancel a question, stop listening, close the caption
  escape() {
    this.pending = null; clearTimeout(this.tm);
    if (this.rec) { this.releasing = false; try { this.rec.abort(); } catch { /* not running */ } this.rec = null; this.listening = false; this.api.onEvent?.('listening', false); }
    this.hide();
  }

  typeBox() { return '<form class="vtype"><input id="vText" type="text" placeholder="Type a command, e.g. focus plus 0.5" autocomplete="off"><button class="btn">Send</button></form>'; }
  wireType() { const f = this.el?.querySelector('form.vtype'); if (f) f.onsubmit = (e) => { e.preventDefault(); const v = f.querySelector('input').value; this.handle(v); }; }

  bubble(html, sticky = false) {
    if (!this.el) { this.el = document.createElement('div'); this.el.id = 'voiceBubble'; this.el.className = 'card voicebubble'; this.el.setAttribute('role', 'status'); document.body.appendChild(this.el); }
    clearTimeout(this.tm); this.el.innerHTML = html; this.el.hidden = false; this.sticky = sticky;
    return this.el;
  }
  // hold keeps captions up (tools/shots.mjs takes screenshots of them)
  flash(html, ms = 3500) { this.bubble(html); if (!this.hold) this.tm = setTimeout(() => this.hide(), ms); }
  hide() { if (this.el) this.el.hidden = true; }
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
