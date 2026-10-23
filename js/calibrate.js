// Measurements on recorded data: the fits behind the analyses (analyze.js) and the digital twin's
// calibration from data (calibui.js). Pure functions of arrays, so they run in browsers and in Node and work
// the same on simulated data and on a user's own files.

// ------------------------------------------------------------------ FFT (radix 2, in place)
function fft1(re, im, inv = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = ((inv ? 2 : -2) * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
// 2D FFT of an n×n array (n a power of two); returns { re, im } with the zero frequency at [0, 0]
export function fft2(arr, n, inv = false, imIn = null) {
  const re = Float64Array.from(arr), im = imIn ? Float64Array.from(imIn) : new Float64Array(n * n);
  const r = new Float64Array(n), i = new Float64Array(n);
  for (let y = 0; y < n; y++) { for (let x = 0; x < n; x++) { r[x] = re[y * n + x]; i[x] = im[y * n + x]; } fft1(r, i, inv); for (let x = 0; x < n; x++) { re[y * n + x] = r[x]; im[y * n + x] = i[x]; } }
  for (let x = 0; x < n; x++) { for (let y = 0; y < n; y++) { r[y] = re[y * n + x]; i[y] = im[y * n + x]; } fft1(r, i, inv); for (let y = 0; y < n; y++) { re[y * n + x] = r[y]; im[y * n + x] = i[y]; } }
  return { re, im };
}
// the largest power of two ≤ the image, centered crop with a Hann window and the mean removed
export function prepSquare(arr, w, h) {
  let n = 1;
  while (n * 2 <= Math.min(w, h)) n *= 2;
  const x0 = (w - n) >> 1, y0 = (h - n) >> 1, out = new Float64Array(n * n);
  let m = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) m += arr[(y + y0) * w + x + x0];
  m /= n * n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * (y + 0.5)) / n), wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * (x + 0.5)) / n);
    out[y * n + x] = (arr[(y + y0) * w + x + x0] - m) * wx * wy;
  }
  return { a: out, n };
}
const power = (F, n) => { const p = new Float64Array(n * n); for (let k = 0; k < n * n; k++) p[k] = F.re[k] ** 2 + F.im[k] ** 2; return p; };
const fq = (k, n) => (k < n / 2 ? k : k - n); // FFT index → signed frequency index

// ------------------------------------------------------------------ magnification and scan distortion from a cross grating
// Finds the grating's two fundamental reciprocal vectors, turns them into real-space lattice vectors in pixels,
// and decomposes  pitch · [a1 a2]⁻¹ = Q · M  (QR) into a rotation Q (how the grating sits) and the scan's
// upper-triangular map M = [[px, tan(shear)·px·aspect], [0, px·aspect]] from pixels (x right, y up) to µm.
export function fitGrating(arr, w, h, { pixUm, pitchUm }) {
  const { a, n } = prepSquare(arr, w, h), P = power(fft2(a, n), n);
  const at = (u, v) => P[(((v % n) + n) % n) * n + (((u % n) + n) % n)];
  const cand = [];
  for (let v = -n / 2 + 1; v < n / 2; v++) for (let u = 0; u < n / 2; u++) {
    if (u === 0 && v <= 0) continue; // half plane (the spectrum is symmetric)
    if (u * u + v * v < 9) continue;
    const p = at(u, v);
    if (p > at(u + 1, v) && p >= at(u - 1, v) && p > at(u, v + 1) && p >= at(u, v - 1)) cand.push([p, u, v]);
  }
  cand.sort((x, y) => y[0] - x[0]);
  if (!cand.length) throw new Error('no periodic structure found: image the cross grating so that several periods fill the field');
  const sub = ([, u, v]) => {
    const c = Math.log(at(u, v) + 1e-30), l = Math.log(at(u - 1, v) + 1e-30), r = Math.log(at(u + 1, v) + 1e-30), d = Math.log(at(u, v - 1) + 1e-30), up = Math.log(at(u, v + 1) + 1e-30);
    return [u + (0.5 * (l - r)) / (l - 2 * c + r || 1e-9), v + (0.5 * (d - up)) / (d - 2 * c + up || 1e-9)];
  };
  // the two strongest peaks that are not parallel are the fundamentals (harmonics and sums are weaker)
  const g1 = sub(cand[0]);
  const c2 = cand.slice(1, 40).find((c) => { const g = [c[1], c[2]], s = Math.abs(g1[0] * g[1] - g1[1] * g[0]) / (Math.hypot(...g1) * Math.hypot(...g)); return s > 0.5; });
  if (!c2) throw new Error('found only one family of lines: a cross grating (two directions) is needed for the scan aspect and shear');
  const g2 = sub(c2);
  // reciprocal vectors in cycles per pixel with y up (FFT rows run down)
  const G = [[g1[0] / n, -g1[1] / n], [g2[0] / n, -g2[1] / n]];
  // real lattice: A = (Gᵀ)⁻¹, columns a1, a2 in pixels
  const det = G[0][0] * G[1][1] - G[0][1] * G[1][0];
  const a1 = [G[1][1] / det, -G[1][0] / det], a2 = [-G[0][1] / det, G[0][0] / det];
  // B = pitch · [a1 a2]⁻¹
  const dA = a1[0] * a2[1] - a2[0] * a1[1];
  const B = [[(pitchUm * a2[1]) / dA, (-pitchUm * a2[0]) / dA], [(-pitchUm * a1[1]) / dA, (pitchUm * a1[0]) / dA]];
  // QR by Gram–Schmidt on B's columns: M = Qᵀ B, upper triangular with a positive diagonal
  const c1 = [B[0][0], B[1][0]], r11 = Math.hypot(...c1), q1 = [c1[0] / r11, c1[1] / r11];
  const c2v = [B[0][1], B[1][1]], r12 = q1[0] * c2v[0] + q1[1] * c2v[1];
  let q2 = [c2v[0] - r12 * q1[0], c2v[1] - r12 * q1[1]];
  let r22 = Math.hypot(...q2); q2 = [q2[0] / r22, q2[1] / r22];
  // the lattice basis may come out left-handed: flip the second axis so the y scale stays positive
  if (q1[0] * q2[1] - q1[1] * q2[0] < 0) { q2 = [-q2[0], -q2[1]]; r22 = -r22; }
  const px = r11, aspect = Math.abs(r22) / r11, shear = Math.atan(r12 / Math.abs(r22)) * (180 / Math.PI) * Math.sign(r22);
  const period = [Math.hypot(...a1), Math.hypot(...a2)];
  return { magCal: px / pixUm, pixel_um: px, scanAspect: aspect, scanShear: shear, rotation_deg: (Math.atan2(q1[1], q1[0]) * 180) / Math.PI, period_px: period, periods_in_field: (n / Math.max(...period)) };
}

// ------------------------------------------------------------------ resolution from edges (25–75 % width)
// Finds the steepest edges, takes intensity profiles across them and measures the 25–75 % rise. For a Gaussian
// probe that width is 1.349 σ, so the probe diameter (FWHM) is 1.746 × the median width.
export function fitEdgeResolution(arr, w, h, { pixUm }) {
  const g = new Float32Array(w * h), gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const k = y * w + x;
    // Sobel
    const a = (i, j) => arr[(y + j) * w + x + i];
    gx[k] = a(1, -1) + 2 * a(1, 0) + a(1, 1) - a(-1, -1) - 2 * a(-1, 0) - a(-1, 1);
    gy[k] = a(-1, 1) + 2 * a(0, 1) + a(1, 1) - a(-1, -1) - 2 * a(0, -1) - a(1, -1);
    g[k] = Math.hypot(gx[k], gy[k]);
  }
  const idx = [];
  for (let y = 10; y < h - 10; y++) for (let x = 10; x < w - 10; x++) idx.push(y * w + x);
  idx.sort((p, q) => g[q] - g[p]);
  const bil = (x, y) => { const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, v = (i, j) => arr[Math.min(h - 1, Math.max(0, y0 + j)) * w + Math.min(w - 1, Math.max(0, x0 + i))]; return v(0, 0) * (1 - fx) * (1 - fy) + v(1, 0) * fx * (1 - fy) + v(0, 1) * (1 - fx) * fy + v(1, 1) * fx * fy; };
  const widths = [], taken = new Uint8Array(w * h), L = 9;
  for (const k of idx) {
    if (widths.length >= 60) break;
    if (taken[k]) continue;
    const x = k % w, y = (k / w) | 0, nx = gx[k] / (g[k] || 1), ny = gy[k] / (g[k] || 1);
    for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) { const q = (y + j) * w + x + i; if (q >= 0 && q < w * h) taken[q] = 1; }
    const prof = [];
    for (let t = -L; t <= L; t += 0.25) prof.push(bil(x + t * nx, y + t * ny));
    const lo = Math.min(...prof.slice(0, 12)), hi = Math.max(...prof.slice(-12)), span = hi - lo;
    if (!(span > 0)) continue;
    const cross = (f) => { for (let i = 1; i < prof.length; i++) { const v0 = (prof[i - 1] - lo) / span, v1 = (prof[i] - lo) / span; if (v0 < f && v1 >= f) return (i - 1 + (f - v0) / (v1 - v0 || 1e-9)) * 0.25; } return null; };
    const a25 = cross(0.25), a75 = cross(0.75);
    if (a25 != null && a75 != null && a75 > a25) widths.push(a75 - a25);
  }
  if (widths.length < 5) throw new Error('not enough sharp edges: image small particles (tin spheres, gold islands) at high magnification');
  widths.sort((p, q) => p - q);
  const med = widths[widths.length >> 1];
  return { width_px: med, resolution_nm: 1.746 * med * pixUm * 1000, edge_25_75_nm: med * pixUm * 1000, edges: widths.length };
}

// ------------------------------------------------------------------ focus and astigmatism from the power spectrum
// A defocused image loses high frequencies evenly; an astigmatic one loses them more in one direction, so the
// spectrum's second moments in a mid-frequency band become elliptical. Returns that ellipticity and its axis.
export function focusAnisotropy(arr, w, h) {
  const { a, n } = prepSquare(arr, w, h), P = power(fft2(a, n), n);
  let sxx = 0, syy = 0, sxy = 0, tot = 0, hiF = 0;
  for (let v = 0; v < n; v++) for (let u = 0; u < n; u++) {
    const fx = fq(u, n), fy = -fq(v, n), r = Math.hypot(fx, fy) / n;
    if (r < 0.03 || r > 0.35) continue;
    const p = P[v * n + u];
    sxx += p * fx * fx; syy += p * fy * fy; sxy += p * fx * fy; tot += p * (fx * fx + fy * fy);
    if (r > 0.15) hiF += p;
  }
  const tr = sxx + syy, d = Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
  return { ellipticity: tr ? (2 * d) / tr : 0, axis_deg: (0.5 * Math.atan2(2 * sxy, sxx - syy) * 180) / Math.PI, high_frequency_fraction: tot ? hiF / (P.reduce((s, x) => s + x, 0) || 1) : 0 };
}

// ------------------------------------------------------------------ EDS: peaks, energy scale and resolution
// is there a peak at E? background from the lowest channels 120–350 eV either side; significance in Poisson σ
export function edsPeakAt(spec, dEkeV, E) {
  const n = spec.length, c = Math.round(E / dEkeV - 0.5), w = Math.max(2, Math.round(0.04 / dEkeV));
  let ib = c;
  for (let b = Math.max(0, c - w); b <= Math.min(n - 1, c + w); b++) if (spec[b] > spec[ib]) ib = b;
  const b1 = Math.round(0.12 / dEkeV), b2 = Math.round(0.35 / dEkeV);
  const lowest = (from, to) => { let v = Infinity; for (let b = Math.max(0, from); b <= Math.min(n - 1, to); b++) v = Math.min(v, spec[b]); return v; };
  const bg = (lowest(ib - b2, ib - b1) + lowest(ib + b1, ib + b2)) / 2, top = spec[ib] - bg;
  return { ib, top, bg, sigma: top / Math.sqrt(Math.max(1, bg)) };
}
const FANO = 2.355 * 2.355 * 0.115 * 3.8; // eV² per eV of X-ray energy (Fano factor 0.115, 3.8 eV per pair in Si)
export function fitEDSPeaks(spec, dEkeV, lines) {
  const n = spec.length, found = [];
  // lines closer than 130 eV to a stronger one overlap at SDD resolution: leave them out of the fit
  const usable = lines.filter((l) => !lines.some((o) => o !== l && Math.abs(o.E - l.E) < 0.13 && (o.w ?? 1) >= (l.w ?? 1)) && l.E > 0.9); // below ~1 keV window absorption skews the peaks
  for (const l of usable) {
    const c0 = Math.round(l.E / dEkeV - 0.5), win = Math.max(3, Math.round(0.08 / dEkeV));
    let mx = -1, ib = -1;
    for (let b = Math.max(1, c0 - win); b <= Math.min(n - 2, c0 + win); b++) if (spec[b] > mx) { mx = spec[b]; ib = b; }
    if (ib < 0) continue;
    // background: the lowest points 120–350 eV either side; then a Gaussian through the top of the peak
    // (ln(y − bg) is a parabola), which neighbors' tails hardly touch
    const b1 = Math.round(0.12 / dEkeV), b2 = Math.round(0.35 / dEkeV);
    const lowest = (from, to) => { let v = Infinity, at = from; for (let b = Math.max(0, from); b <= Math.min(n - 1, to); b++) if (spec[b] < v) { v = spec[b]; at = b; } return [at, v]; };
    const [lb, bl] = lowest(ib - b2, ib - b1), [rb, br] = lowest(ib + b1, ib + b2), bg = (b) => bl + ((br - bl) * (b - lb)) / (rb - lb || 1);
    const top = spec[ib] - bg(ib);
    if (!(top > 0) || spec[ib] / Math.max(1e-12, bg(ib)) < 1.6) continue;
    let sx = 0, sy = 0, sxx = 0, sxy = 0, sx3 = 0, sx4 = 0, sx2y = 0, m = 0;
    for (let b = ib - 6; b <= ib + 6; b++) {
      const v = spec[b] - bg(b);
      if (b < 0 || b >= n || v < 0.45 * top) continue;
      const x = b - ib, y = Math.log(v);
      sx += x; sy += y; sxx += x * x; sxy += x * y; sx3 += x ** 3; sx4 += x ** 4; sx2y += x * x * y; m++;
    }
    if (m < 3) continue;
    // least-squares parabola y = c0 + c1 x + c2 x²
    const M3 = [[m, sx, sxx], [sx, sxx, sx3], [sxx, sx3, sx4]], R3 = [sy, sxy, sx2y];
    const det3 = (A) => A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
    const D = det3(M3), col = (j) => M3.map((row, i) => row.map((v, k) => (k === j ? R3[i] : v)));
    const c1 = det3(col(1)) / D, c2 = det3(col(2)) / D;
    if (!(c2 < 0)) continue;
    const sig = Math.sqrt(-1 / (2 * c2)), Em = (ib - c1 / (2 * c2) + 0.5) * dEkeV;
    const counts = top * sig * 2.5066;
    found.push({ label: l.label, E: l.E, Emeas: Em, fwhm: 2.355 * sig * dEkeV * 1000, counts });
  }
  if (found.length < 2) throw new Error('fewer than two clean X-ray peaks: collect longer, or use a specimen with well-separated lines');
  // energy scale: Emeas = gain · E + offset
  const m = found.length, sx = found.reduce((s, p) => s + p.E, 0), sy = found.reduce((s, p) => s + p.Emeas, 0);
  const sxx = found.reduce((s, p) => s + p.E * p.E, 0), sxy = found.reduce((s, p) => s + p.E * p.Emeas, 0);
  const gain = (m * sxy - sx * sy) / (m * sxx - sx * sx || 1e-9), offset = (sy - gain * sx) / m;
  // resolution: the electronic-noise term, from every peak (weighted by counts), referred to Mn Kα
  // resolution: each peak's electronic-noise term (FWHM² minus the Fano part), the count-weighted median of
  // them (weak peaks and unresolved doublets give outliers), referred to Mn Kα
  const nz = found.map((p) => [p.fwhm * p.fwhm - FANO * p.E * 1000, p.counts]).sort((a, b) => a[0] - b[0]);
  const half = nz.reduce((s, x) => s + x[1], 0) / 2;
  let acc = 0, noise2 = nz[0][0];
  for (const [v, w] of nz) { acc += w; if (acc >= half) { noise2 = v; break; } }
  return { found, gain, offset_eV: offset * 1000, fwhmMn: Math.sqrt(Math.max(100, noise2) + FANO * 5899) };
}

// ------------------------------------------------------------------ 3D relief from four BSE quadrants (shape from shading)
// Opposite segments differ by the local slope: (A − B)/(A + B) ∝ −∂h/∂x and (C − D)/(C + D) ∝ −∂h/∂y. The slopes are
// integrated into a height map with the Frankot–Chellappa projection (least squares, in Fourier space).
export function reliefFromQuadrants(seg, n, { pixUm, gain = 2.4 }) {
  const p = new Float64Array(n * n), q = new Float64Array(n * n);
  for (let k = 0; k < n * n; k++) {
    // the quadrant contrasts estimate the surface normal's x and y components; the slope is −n_x / n_z
    const sx = seg.A[k] + seg.B[k], sy = seg.C[k] + seg.D[k];
    let nx = sx > 0 ? (seg.A[k] - seg.B[k]) / sx / gain : 0, ny = sy > 0 ? (seg.C[k] - seg.D[k]) / sy / gain : 0;
    const t = Math.hypot(nx, ny);
    if (t > 0.97) { nx *= 0.97 / t; ny *= 0.97 / t; }
    const nz = Math.sqrt(1 - nx * nx - ny * ny);
    p[k] = -nx / nz; q[k] = -ny / nz; // ∂h/∂x, ∂h/∂y (y up)
  }
  const P = fft2(p, n), Q = fft2(q, n), re = new Float64Array(n * n), im = new Float64Array(n * n);
  for (let v = 0; v < n; v++) for (let u = 0; u < n; u++) {
    const k = v * n + u, wx = (2 * Math.PI * fq(u, n)) / n, wy = (-2 * Math.PI * fq(v, n)) / n, d = wx * wx + wy * wy;
    if (!d) continue;
    // H = (−i wx P − i wy Q) / (wx² + wy²)
    re[k] = (wx * P.im[k] + wy * Q.im[k]) / d; im[k] = (-wx * P.re[k] - wy * Q.re[k]) / d;
  }
  const H = fft2(re, n, true, im).re, out = new Float32Array(n * n);
  for (let k = 0; k < n * n; k++) out[k] = H[k] * pixUm;
  return out;
}

// ------------------------------------------------------------------ phases from element maps (k-means)
export function kmeans(X, n, dim, k, iters = 25) {
  const C = [];
  for (let c = 0; c < k; c++) C.push(Array.from({ length: dim }, (_, d) => X[Math.floor(((c + 0.5) / k) * n) * dim + d]));
  // k-means++-like spread: pick centers far from the existing ones
  for (let c = 1; c < k; c++) {
    let best = -1, bi = 0;
    for (let i = 0; i < n; i += 7) { let dm = Infinity; for (let j = 0; j < c; j++) { let s = 0; for (let d = 0; d < dim; d++) s += (X[i * dim + d] - C[j][d]) ** 2; dm = Math.min(dm, s); } if (dm > best) { best = dm; bi = i; } }
    C[c] = Array.from({ length: dim }, (_, d) => X[bi * dim + d]);
  }
  const lab = new Uint8Array(n);
  let inertia = 0;
  for (let it = 0; it < iters; it++) {
    inertia = 0;
    for (let i = 0; i < n; i++) { let bd = Infinity, bc = 0; for (let c = 0; c < k; c++) { let s = 0; for (let d = 0; d < dim; d++) s += (X[i * dim + d] - C[c][d]) ** 2; if (s < bd) { bd = s; bc = c; } } lab[i] = bc; inertia += bd; }
    const S = Array.from({ length: k }, () => new Float64Array(dim + 1));
    for (let i = 0; i < n; i++) { for (let d = 0; d < dim; d++) S[lab[i]][d] += X[i * dim + d]; S[lab[i]][dim]++; }
    for (let c = 0; c < k; c++) if (S[c][dim]) for (let d = 0; d < dim; d++) C[c][d] = S[c][d] / S[c][dim];
  }
  return { centers: C, labels: lab, inertia };
}
