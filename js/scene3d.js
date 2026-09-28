// 3D cutaway SEM: column, chamber, stage, detectors, beam and emitted signals.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as P from './physics.js';

export const Y = { tank: 7.3, gun: 6.6, anode: 6.2, cond: 5.3, ap: 4.6, inlens: 4.05, scan: 3.45, obj: 2.8, tip: 1.72, ceil: 2.0, floor: -2.6 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
export const specY = (wd) => Y.tip - wd * 0.085;

function makeMaterials() {
  const iron = new THREE.MeshStandardMaterial({ color: 0x272c33, metalness: 0.85, roughness: 0.4, side: THREE.DoubleSide, envMapIntensity: 0.45 });
  const cut = new THREE.MeshStandardMaterial({ color: 0x6f7883, metalness: 0.7, roughness: 0.48, side: THREE.DoubleSide, envMapIntensity: 0.4 });
  const copper = new THREE.MeshStandardMaterial({ color: 0xb36d3a, metalness: 0.9, roughness: 0.34, side: THREE.DoubleSide, envMapIntensity: 0.55 });
  const plat = new THREE.MeshStandardMaterial({ color: 0xa9aeb5, metalness: 1, roughness: 0.28, side: THREE.DoubleSide, envMapIntensity: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14171c, metalness: 0.5, roughness: 0.6, side: THREE.DoubleSide });
  const wall = new THREE.MeshStandardMaterial({ color: 0x1a1e24, metalness: 0.6, roughness: 0.55, side: THREE.DoubleSide, envMapIntensity: 0.3 });
  const ceramic = new THREE.MeshStandardMaterial({ color: 0xbdb7ab, metalness: 0, roughness: 0.6, side: THREE.DoubleSide, envMapIntensity: 0.35 });
  const glass = new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.035, depthWrite: false, side: THREE.DoubleSide });
  return { iron, cut, copper, plat, dark, wall, ceramic, glass };
}
function halfSolid(pts, mat, capMat, seg = 56) {
  const g = new THREE.Group(), v = pts.map((p) => new THREE.Vector2(p[0], p[1]));
  v.push(v[0].clone());
  g.add(new THREE.Mesh(new THREE.LatheGeometry(v, seg, Math.PI / 2, Math.PI), mat));
  const cg = new THREE.ShapeGeometry(new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1]))));
  const c1 = new THREE.Mesh(cg, capMat), c2 = new THREE.Mesh(cg, capMat);
  c2.scale.x = -1;
  g.add(c1, c2);
  return g;
}
const rectPts = (r0, r1, y0, y1) => [[r0, y0], [r1, y0], [r1, y1], [r0, y1]];

// ------------------------------------------------------------------ beam tube shader (as in the TEM exhibit)
const BEAM_VS = `attribute float aI; attribute float aS; varying float vI; varying float vS; varying vec3 vN; varying vec3 vV;
void main(){ vI=aI; vS=aS; vec4 wp=modelMatrix*vec4(position,1.0); vN=normalize(mat3(modelMatrix)*normal); vV=normalize(cameraPosition-wp.xyz); gl_Position=projectionMatrix*viewMatrix*wp; }`;
const BEAM_FS = `uniform vec3 uColor; uniform float uOpacity; uniform float uTime; varying float vI; varying float vS; varying vec3 vN; varying vec3 vV;
void main(){ float f=abs(dot(normalize(vN),normalize(vV))); float a=uOpacity*vI*(0.06+0.94*pow(f,2.2)); a*=0.78+0.22*sin(vS*90.0-uTime*8.0); gl_FragColor=vec4(uColor,a); }`;
const SEG = 22, RINGS = 120;
class Beam {
  constructor(group) {
    const nv = RINGS * (SEG + 1), geo = new THREE.BufferGeometry();
    for (const [k, n] of [['position', 3], ['normal', 3], ['aI', 1], ['aS', 1]]) geo.setAttribute(k, new THREE.BufferAttribute(new Float32Array(nv * n), n));
    const idx = [];
    for (let i = 0; i < RINGS - 1; i++) for (let j = 0; j < SEG; j++) { const a = i * (SEG + 1) + j, b = a + SEG + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({ vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uColor: { value: new THREE.Color(0x3dff7a) }, uOpacity: { value: 0.5 }, uTime: { value: 0 } } });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    group.add(this.mesh);
    this.c = new Float32Array(RINGS * 3); this.r = new Float32Array(RINGS); this.len = 1;
  }
  set(keys) { // keys: [x, y, z, r]
    const L = [0];
    for (let i = 1; i < keys.length; i++) L.push(L[i - 1] + Math.hypot(keys[i][0] - keys[i - 1][0], keys[i][1] - keys[i - 1][1], keys[i][2] - keys[i - 1][2]));
    const tot = L[L.length - 1] || 1;
    this.len = tot;
    let k = 0;
    const pos = this.mesh.geometry.attributes.position.array, nor = this.mesh.geometry.attributes.normal.array, aI = this.mesh.geometry.attributes.aI.array, aS = this.mesh.geometry.attributes.aS.array;
    for (let i = 0; i < RINGS; i++) {
      const s = (i / (RINGS - 1)) * tot;
      while (k < keys.length - 2 && L[k + 1] < s) k++;
      const f = clamp((s - L[k]) / (L[k + 1] - L[k] || 1), 0, 1), a = keys[k], b = keys[k + 1];
      const cx = lerp(a[0], b[0], f), cy = lerp(a[1], b[1], f), cz = lerp(a[2], b[2], f), r = Math.max(0.003, Math.abs(lerp(a[3], b[3], f)));
      this.c.set([cx, cy, cz], i * 3); this.r[i] = r;
      const I = clamp(0.05 / (r + 0.03), 0.3, 1.8);
      for (let j = 0; j <= SEG; j++) {
        const ph = (j / SEG) * Math.PI * 2, ox = Math.cos(ph), oz = Math.sin(ph), v = i * (SEG + 1) + j;
        pos[v * 3] = cx + ox * r; pos[v * 3 + 1] = cy; pos[v * 3 + 2] = cz + oz * r;
        nor[v * 3] = ox; nor[v * 3 + 1] = 0; nor[v * 3 + 2] = oz; aI[v] = I; aS[v] = s;
      }
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = g.attributes.normal.needsUpdate = g.attributes.aI.needsUpdate = g.attributes.aS.needsUpdate = true;
  }
  sample(t, u, ph, out) {
    const f = clamp(t, 0, 1) * (RINGS - 1), i = Math.min(RINGS - 2, Math.floor(f)), w = f - i;
    const r = lerp(this.r[i], this.r[i + 1], w) * u;
    out[0] = lerp(this.c[i * 3], this.c[i * 3 + 3], w) + Math.cos(ph) * r;
    out[1] = lerp(this.c[i * 3 + 1], this.c[i * 3 + 4], w);
    out[2] = lerp(this.c[i * 3 + 2], this.c[i * 3 + 5], w) + Math.sin(ph) * r;
  }
}

export class Scene3D {
  constructor(canvas, labelLayer) {
    this.canvas = canvas; this.labelLayer = labelLayer;
    const R = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    R.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 0.95;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050608);
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
    this.home = { pos: new THREE.Vector3(13.2, 6.4, 21.5), target: new THREE.Vector3(0, 2.4, 0) };
    this.camera.position.copy(this.home.pos);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(this.home.target);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.07; this.controls.minDistance = 2; this.controls.maxDistance = 45; this.controls.autoRotateSpeed = 0.6;
    const pm = new THREE.PMREMGenerator(R);
    this.scene.environment = pm.fromScene(new RoomEnvironment(R), 0.04).texture;
    this.scene.add(new THREE.AmbientLight(0x8899aa, 0.3));
    const key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(6, 9, 8); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x6fd6ff, 0.6); rim.position.set(-6, 2, -5); this.scene.add(rim);
    this.spotLight = new THREE.PointLight(0x3dff7a, 2.5, 3, 2); this.scene.add(this.spotLight);
    this.composer = new EffectComposer(R);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.5, 0.5);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.M = makeMaterials();
    this.anim = { bse: 0, ebsd: 0, tkd: 0, tilt: 0, sy: specY(10) };
    this.build();
    this.beamGroup = new THREE.Group(); this.scene.add(this.beamGroup);
    this.beam = new Beam(this.beamGroup);
    this.buildParticles();
    this.buildLabels();
    this.time = 0; this.tour = null;
    canvas.addEventListener('pointerdown', () => { if (this.tour) this.stopTour(); });
  }

  build() {
    const M = this.M, S = this.scene, col = new THREE.Group();
    S.add(col);
    // gun + HV tank
    col.add(halfSolid([[0.3, 6.9], [1.05, 6.9], [1.05, 7.9], [0.3, 7.9]], M.iron, M.cut));
    for (let i = 0; i < 6; i++) col.add(halfSolid(rectPts(0.18, 0.36, 7.0 + i * 0.14, 7.09 + i * 0.14), M.ceramic, M.ceramic, 40));
    col.add(halfSolid([[0.08, 6.55], [0.36, 6.55], [0.36, 6.9], [0.3, 6.9], [0.3, 6.61], [0.08, 6.61]], M.plat, M.cut));
    this.tipMat = new THREE.MeshBasicMaterial({ color: 0xc8ffd6 });
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.2, 16), this.tipMat); tip.rotation.x = Math.PI; tip.position.y = 6.68; col.add(tip);
    this.tipGlow = this.sprite(0x8dffae, 0.8); this.tipGlow.position.set(0, 6.58, 0); col.add(this.tipGlow);
    col.add(halfSolid(rectPts(0.05, 0.6, Y.anode - 0.03, Y.anode + 0.04), M.plat, M.cut));
    // column wall
    col.add(halfSolid([[0.44, Y.ceil], [0.48, Y.ceil], [0.48, 6.9], [0.44, 6.9]], M.dark, M.cut));
    // condenser
    const lens = (yc, rIn, rOut, h, gap) => {
      const t = 0.1, g = new THREE.Group();
      g.add(halfSolid([[rIn, yc + gap / 2], [rIn + 0.06, yc + h / 2], [rOut, yc + h / 2], [rOut, yc - h / 2], [rIn + 0.06, yc - h / 2], [rIn, yc - gap / 2], [rIn + t, yc - gap / 2], [rIn + t + 0.09, yc - h / 2 + t], [rOut - t, yc - h / 2 + t], [rOut - t, yc + h / 2 - t], [rIn + t + 0.09, yc + h / 2 - t], [rIn + t, yc + gap / 2]], M.iron, M.cut));
      g.add(halfSolid(rectPts(rIn + t + 0.14, rOut - t - 0.03, yc - h / 2 + t + 0.03, yc + h / 2 - t - 0.03), M.copper, M.copper));
      return g;
    };
    col.add(lens(Y.cond, 0.4, 1.1, 0.7, 0.12));
    // beam-limiting aperture strip
    this.apGroup = new THREE.Group(); col.add(this.apGroup);
    this.setAperture(30);
    // in-lens detector
    this.inlensMat = new THREE.MeshStandardMaterial({ color: 0x3a4250, metalness: 0.6, roughness: 0.35, emissive: 0x3dff7a, emissiveIntensity: 0, side: THREE.DoubleSide });
    const il = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.36, 48), this.inlensMat); il.rotation.x = -Math.PI / 2; il.position.y = Y.inlens; col.add(il);
    // scan coils
    for (const dy of [0.12, -0.12]) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 12, 48, Math.PI), M.copper); t.rotation.x = -Math.PI / 2; t.position.y = Y.scan + dy; col.add(t); }
    // conical immersion objective lens
    col.add(halfSolid([[0.13, 1.72], [0.26, 1.72], [1.05, 2.3], [1.35, 2.3], [1.35, 3.35], [0.36, 3.35], [0.36, 3.2], [1.2, 3.2], [1.2, 2.45], [0.98, 2.42], [0.24, 1.88], [0.13, 1.88]], M.iron, M.cut));
    col.add(halfSolid(rectPts(0.5, 1.12, 2.55, 3.1), M.copper, M.copper));
    // chamber (back half + floor)
    const ch = new THREE.Group(); col.add(ch);
    const box = (w, h, d, x, y, z, mat = M.wall) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); ch.add(m); return m; };
    box(7.4, 0.12, 6.2, 0, Y.floor - 0.06, 0);
    box(7.4, 4.8, 0.12, 0, (Y.floor + Y.ceil) / 2, -3.1);
    box(0.12, 4.8, 3.2, -3.7, (Y.floor + Y.ceil) / 2, -1.5);
    box(0.12, 4.8, 3.2, 3.7, (Y.floor + Y.ceil) / 2, -1.5);
    const ceil = new THREE.Mesh(new THREE.RingGeometry(0.5, 3.8, 48, 1, Math.PI, Math.PI), M.wall); ceil.rotation.x = Math.PI / 2; ceil.position.y = Y.ceil; ch.add(ceil);
    const glassFront = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 4.8), M.glass); glassFront.position.set(0, (Y.floor + Y.ceil) / 2, 3.1); ch.add(glassFront);
    this.chamberGlass = glassFront;
    // stage
    this.stage = new THREE.Group(); col.add(this.stage);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.35, 40), M.iron); base.position.y = Y.floor + 0.18; this.stage.add(base);
    this.post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1, 20), M.plat); this.stage.add(this.post);
    this.tiltGroup = new THREE.Group(); this.stage.add(this.tiltGroup);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 1.2), M.iron); plate.position.y = -0.34; this.tiltGroup.add(plate);
    this.stub = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.22, 36), M.plat); this.stub.position.y = -0.14; this.tiltGroup.add(this.stub);
    this.specTex = new THREE.CanvasTexture(document.createElement('canvas')); this.specTex.colorSpace = THREE.SRGBColorSpace;
    this.specDisk = new THREE.Mesh(new THREE.CircleGeometry(0.34, 48), new THREE.MeshBasicMaterial({ map: this.specTex, color: 0x999999, toneMapped: false }));
    this.specDisk.rotation.x = -Math.PI / 2; this.specDisk.position.y = -0.028; this.tiltGroup.add(this.specDisk);
    // TKD lamella on a half-moon grid
    this.lamella = new THREE.Group();
    const grid = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 8, 40, Math.PI), M.copper); grid.rotation.x = Math.PI / 2; this.lamella.add(grid);
    const foil = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.12), new THREE.MeshStandardMaterial({ color: 0xc88a5a, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
    foil.rotation.x = -Math.PI / 2; this.lamella.add(foil);
    this.lamella.position.y = -0.02; this.tiltGroup.add(this.lamella);
    // ETD with Faraday cage
    this.etd = new THREE.Group();
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.8, 24), new THREE.MeshBasicMaterial({ color: 0x5a7080, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide })); pipe.rotation.x = Math.PI / 2; pipe.position.z = -0.95; this.etd.add(pipe);
    this.scintMat = new THREE.MeshBasicMaterial({ color: 0x1f3a26 });
    const scint = new THREE.Mesh(new THREE.CircleGeometry(0.15, 28), this.scintMat); scint.position.z = -0.04; this.etd.add(scint);
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.4, 24, 4, true), new THREE.MeshBasicMaterial({ color: 0xc9b37a, wireframe: true, transparent: true, opacity: 0.6 }));
    cage.rotation.x = Math.PI / 2; cage.position.z = 0.1; this.etd.add(cage);
    const pmt = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.6, 24), M.iron); pmt.rotation.x = Math.PI / 2; pmt.position.z = -2.0; this.etd.add(pmt);
    this.etd.position.set(-2.3, 1.05, 0.9);
    col.add(this.etd);
    // BSE annular 4-quadrant detector under the pole piece (retractable)
    this.bse = new THREE.Group();
    this.bseMats = [];
    for (let i = 0; i < 4; i++) {
      const mt = new THREE.MeshStandardMaterial({ color: 0x2c3440, metalness: 0.7, roughness: 0.35, emissive: 0x6fd6ff, emissiveIntensity: 0, side: THREE.DoubleSide });
      this.bseMats.push(mt);
      // sectors centred on the axes: 0 = A (+x), 1 = C, 2 = B (−x), 3 = D
      const q = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.62, 16, 1, (i * Math.PI) / 2 - Math.PI / 4 + 0.04, Math.PI / 2 - 0.08), mt);
      q.rotation.x = -Math.PI / 2; this.bse.add(q);
    }
    const arm = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.05, 0.16), M.iron); arm.position.x = 1.8; this.bse.add(arm);
    col.add(this.bse);
    // EDS detector
    this.eds = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 2.4, 28), M.iron); body.rotation.x = Math.PI / 2; body.position.z = -1.3; this.eds.add(body);
    this.edsWin = new THREE.MeshBasicMaterial({ color: 0x3a2a14 });
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.17, 28), this.edsWin); win.position.z = -0.08; this.eds.add(win);
    col.add(this.eds);
    // EBSD detector (phosphor screen + camera), behind the tilted specimen
    this.ebsd = new THREE.Group();
    this.patTex = new THREE.CanvasTexture(document.createElement('canvas')); this.patTex.colorSpace = THREE.SRGBColorSpace;
    this.ebsdScreen = new THREE.Mesh(new THREE.CircleGeometry(0.55, 48), new THREE.MeshBasicMaterial({ map: this.patTex, toneMapped: false, side: THREE.DoubleSide }));
    this.ebsd.add(this.ebsdScreen);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.62, 1.6, 36, 1, true), M.iron); tube.rotation.x = Math.PI / 2; tube.position.z = -0.82; this.ebsd.add(tube);
    col.add(this.ebsd);
    // TKD detector below the lamella
    this.tkd = new THREE.Group();
    this.tkdScreen = new THREE.Mesh(new THREE.CircleGeometry(0.5, 48), new THREE.MeshBasicMaterial({ map: this.patTex, toneMapped: false, side: THREE.DoubleSide }));
    this.tkdScreen.rotation.x = -Math.PI / 2; this.tkd.add(this.tkdScreen);
    const tb = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.25, 36), M.iron); tb.position.y = -0.14; this.tkd.add(tb);
    const tarm = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.2), M.iron); tarm.position.set(1.9, -0.14, 0); this.tkd.add(tarm);
    col.add(this.tkd);
    // interaction-volume glow
    this.ivol = this.sprite(0x3dff7a, 0.3); col.add(this.ivol);
    this.floorDisk = new THREE.Mesh(new THREE.CircleGeometry(12, 64), new THREE.MeshStandardMaterial({ color: 0x07080a, metalness: 0.4, roughness: 0.75 }));
    this.floorDisk.rotation.x = -Math.PI / 2; this.floorDisk.position.y = Y.floor - 0.2; S.add(this.floorDisk);
  }
  setAperture(ap) {
    if (this._ap === ap) return;
    this._ap = ap;
    this.apGroup.clear();
    const r = 0.012 + (ap / 120) * 0.06;
    this.apGroup.add(halfSolid(rectPts(r, 0.42, Y.ap - 0.012, Y.ap + 0.012), this.M.plat, this.M.plat, 40));
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2, 12), this.M.plat); rod.rotation.z = Math.PI / 2; rod.position.set(-1.4, Y.ap, -0.02);
    this.apGroup.add(rod);
  }
  sprite(color, scale) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.scale.setScalar(scale);
    return s;
  }
  buildParticles() {
    const mk = (n) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1));
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uPR: { value: this.renderer.getPixelRatio() } },
        vertexShader: `attribute vec3 color; attribute float size; varying vec3 vC; uniform float uPR; void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*uPR*(300.0/-mv.z); gl_Position=projectionMatrix*mv; }`,
        fragmentShader: `varying vec3 vC; void main(){ vec2 d=gl_PointCoord-0.5; float a=smoothstep(0.5,0.0,length(d)); gl_FragColor=vec4(vC,a*a); }`,
      });
      const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; this.scene.add(pts);
      return { pts, n };
    };
    this.eP = mk(700); this.eState = Array.from({ length: 700 }, () => ({ t: Math.random(), u: Math.sqrt(Math.random()), ph: Math.random() * 6.28 }));
    this.sP = mk(260); this.sState = Array.from({ length: 260 }, () => ({ life: -1 }));
  }
  buildLabels() {
    const L = [
      ['Electron gun', () => [0.4, Y.gun, 0]], ['Condenser lens', () => [1.1, Y.cond, 0]], ['Beam-limiting aperture', () => [-0.5, Y.ap, 0], 'left'],
      ['In-lens SE detector', () => [0.4, Y.inlens, 0]], ['Scan coils', () => [-0.4, Y.scan, 0], 'left'], ['Objective lens', () => [1.35, Y.obj, 0]],
      ['Specimen & stage', () => [0.55, this.anim.sy, 0.3]], ['Everhart–Thornley detector', () => this.etd.localToWorld(new THREE.Vector3(0, 0.3, -0.4)).toArray(), 'left'],
      ['BSE detector', () => this.bse.localToWorld(new THREE.Vector3(0.62, 0, 0)).toArray(), null, ['bse', 'ebsd']],
      ['EDS detector', () => this.eds.localToWorld(new THREE.Vector3(0, 0.25, -0.8)).toArray(), 'left'],
      ['EBSD detector', () => this.ebsd.localToWorld(new THREE.Vector3(0.6, 0.3, 0)).toArray(), null, ['ebsd']],
      ['TKD detector', () => this.tkd.localToWorld(new THREE.Vector3(0.55, 0, 0)).toArray(), null, ['tkd']],
      ['Vacuum chamber', () => [3.2, Y.floor + 0.4, -2.6]],
    ];
    this.labels = L.map(([text, pos, side, modes]) => {
      const el = document.createElement('div');
      el.className = 'lbl' + (side === 'left' ? ' left' : '');
      el.innerHTML = `<i></i><span role="button" tabindex="0">${text}</span>`;
      const open = (e) => { e.stopPropagation(); this.onLabel?.(text, el); };
      el.querySelector('span').addEventListener('click', open);
      el.querySelector('span').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); });
      this.labelLayer.appendChild(el);
      return { el, pos, modes };
    });
  }
  resize(w, h, off) {
    this.W = w; this.H = h;
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, -(off.left - off.right) / 2, -(off.top - off.bottom) / 2, w, h);
    this.camera.updateProjectionMatrix();
  }
  spot() { return new THREE.Vector3(this.scanOff[0], this.anim.sy + 0.005, this.scanOff[1]); }

  update(dt, S, sim) {
    this.time += dt;
    const A = this.anim, k = Math.min(1, dt * 3), m = S.mode;
    const ebsdOn = m === 'ebsd', tkdOn = m === 'tkd';
    // stage height (working distance) and tilt
    A.sy = lerp(A.sy, specY(S.wd), k);
    A.tilt = lerp(A.tilt, S.tilt * P.DEG, k);
    this.stage.position.y = 0;
    this.tiltGroup.position.y = A.sy;
    this.tiltGroup.rotation.x = -A.tilt;
    const postTop = A.sy - 0.4, postBot = Y.floor + 0.35;
    this.post.scale.y = Math.max(0.05, postTop - postBot); this.post.position.y = (postTop + postBot) / 2;
    this.lamella.visible = tkdOn; this.stub.visible = !tkdOn; this.specDisk.visible = !tkdOn;
    // detectors in / out
    A.bse = lerp(A.bse, m === 'bse' ? 1 : 0, k);
    this.bse.position.set((1 - A.bse) * 2.6, Y.tip - 0.06, 0);
    this.bseMats.forEach((mt, i) => {
      const sg = S.seg[['A', 'C', 'B', 'D'][i]];
      mt.emissive.set(sg < 0 ? 0xff7d7d : 0x6fd6ff);
      mt.emissiveIntensity = m === 'bse' && sg ? 0.5 : 0;
    });
    A.ebsd = lerp(A.ebsd, ebsdOn ? 1 : 0, k);
    this.ebsd.position.set(0, A.sy - 0.25, lerp(-3.4, -1.25, A.ebsd));
    this.ebsd.visible = A.ebsd > 0.02;
    A.tkd = lerp(A.tkd, tkdOn ? 1 : 0, k);
    this.tkd.position.set((1 - A.tkd) * 3, A.sy - 0.95, 0);
    this.tkd.visible = A.tkd > 0.02;
    // scan position
    const rs = ['se', 'inlens', 'bse'].includes(m) ? sim.raster : sim.map && (ebsdOn || tkdOn) ? (sim.map.done % sim.map.N) / sim.map.N : (this.time * 0.37) % 1;
    const row = ['se', 'inlens', 'bse'].includes(m) ? rs : sim.map && (ebsdOn || tkdOn) ? Math.floor(sim.map.done / sim.map.N) / sim.map.N : (this.time * 0.05) % 1;
    const sc = m === 'mc' || m === 'eds' ? 0 : 0.14;
    this.scanOff = [(((rs * 256) % 1) - 0.5) * sc * 2 * 0 + (rs - 0.5) * sc, (row - 0.5) * sc * Math.cos(A.tilt)];
    if (['se', 'inlens', 'bse'].includes(m)) this.scanOff = [(((sim.raster * 256) % 1) - 0.5) * sc, (sim.raster - 0.5) * sc];
    const spot = this.spot();
    // beam
    const apS = clamp(S.aperture / 30, 0.4, 2.2), pivotY = Y.scan - 0.15;
    const keys = [[0, 6.62, 0, 0], [0, Y.anode, 0, 0.06], [0, Y.cond, 0, 0.16], [0, 4.9, 0, 0], [0, Y.ap, 0, -0.05 * apS], [0, pivotY, 0, -0.07 * apS], [-spot.x * 0.35, Y.obj, -spot.z * 0.35, -0.1 * apS], [spot.x, spot.y, spot.z, 0]];
    this.beam.set(keys);
    const edu = S.clarity !== 'real';
    const bright = clamp(0.45 + 0.15 * Math.log10(S.current / 10), 0.25, 1.1);
    this.beam.mat.uniforms.uOpacity.value = bright * (edu ? 0.55 : 0.4);
    this.beam.mat.uniforms.uTime.value = S.paused ? 0 : this.time * S.speed;
    this.setAperture(S.aperture);
    // glows
    this.spotLight.position.copy(spot).add(new THREE.Vector3(0, 0.1, 0));
    const Rk = P.rangeKO(P.MAT[sim.spec.sample(S.cx, S.cy).mat].rho ? P.MAT[sim.spec.sample(S.cx, S.cy).mat] : P.MAT.C, S.kV);
    this.ivol.position.copy(spot).add(new THREE.Vector3(0, -0.02, 0));
    this.ivol.scale.setScalar((m === 'mc' ? 0.45 : 0.16) * clamp(0.5 + Math.log10(1 + Rk * 3), 0.4, 2.2));
    this.tipGlow.scale.setScalar(0.5 + 0.5 * (S.kV / 30));
    this.scintMat.color.set(m === 'se' ? (S.etdBias >= 0 ? 0x5fe38a : 0x2a6b3c) : 0x1f3a26);
    this.inlensMat.emissiveIntensity = m === 'inlens' ? 0.5 + 0.2 * Math.sin(this.time * 7) : 0;
    this.edsWin.color.set(m === 'eds' ? 0xffb45e : 0x3a2a14);
    this.chamberGlass.visible = S.showGlass;
    this.specDisk.material.color.setScalar(['se', 'inlens', 'bse'].includes(m) ? 1.1 : 0.55);
    // ETD and EDS aim at the specimen
    this.etd.lookAt(spot); this.eds.position.set(-1.7, A.sy + 1.05, -1.9); this.eds.lookAt(spot);
    if (this.ebsd.visible) this.ebsd.lookAt(new THREE.Vector3(0, A.sy - 0.25, 5));
    this.updateParticles(dt, S, sim, spot);
    this.updateLabels(S);
    if (this.tour) this.stepTour(dt);
    this.controls.autoRotate = S.autoRotate && !this.tour;
    this.controls.update();
    this.bloom.strength = edu ? 0.8 : 0.6;
    this.composer.render();
  }

  updateParticles(dt, S, sim, spot) {
    const edu = S.clarity !== 'real', sp = S.paused ? 0 : S.speed;
    // primary electrons along the beam
    const pe = this.eP, pos = pe.pts.geometry.attributes.position.array, size = pe.pts.geometry.attributes.size.array, col = pe.pts.geometry.attributes.color.array;
    const nOn = S.showElectrons ? Math.round(pe.n * clamp(0.3 + 0.2 * Math.log10(S.current / 10), 0.1, 1)) : 0;
    const beta = Math.sqrt(1 - 1 / (1 + S.kV / 511) ** 2), out = [0, 0, 0];
    for (let i = 0; i < pe.n; i++) {
      const p = this.eState[i];
      if (i >= nOn) { size[i] = 0; continue; }
      p.t += (dt * sp * (edu ? 0.9 : 2.4) * beta * 2.2) / this.beam.len;
      if (p.t > 1) { p.t = 0; p.u = Math.sqrt(Math.random()); p.ph = Math.random() * 6.28; }
      this.beam.sample(p.t, p.u, p.ph, out);
      pos[i * 3] = out[0]; pos[i * 3 + 1] = out[1]; pos[i * 3 + 2] = out[2];
      size[i] = edu ? 0.045 : 0.03; col[i * 3] = 0.24; col[i * 3 + 1] = 1; col[i * 3 + 2] = 0.48;
    }
    const g1 = pe.pts.geometry; g1.attributes.position.needsUpdate = g1.attributes.size.needsUpdate = g1.attributes.color.needsUpdate = true;
    // emitted signals
    const P2 = this.sP, sPos = P2.pts.geometry.attributes.position.array, sSize = P2.pts.geometry.attributes.size.array, sCol = P2.pts.geometry.attributes.color.array;
    const m = S.mode, V = THREE.Vector3;
    const etdFront = this.etd.localToWorld(new V(0, 0, 0.1)), edsWin = this.eds.localToWorld(new V(0, 0, 0));
    const rate = S.showElectrons ? 60 * clamp(S.current / 300, 0.2, 3) : 0;
    for (let i = 0; i < P2.n; i++) {
      const s = this.sState[i];
      if (s.life < 0) {
        if (Math.random() > dt * sp * rate / 20) { sSize[i] = 0; continue; }
        s.life = 1; s.t = 0; s.a = spot.clone();
        const rnd = () => new V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        if (m === 'se') { s.b = etdFront.clone().add(rnd().multiplyScalar(0.25)); s.c = spot.clone().add(new V(-0.4, 0.7 + Math.random() * 0.4, 0.3)); s.col = [0.8, 1, 0.85]; s.speed = 1.2; s.kind = S.etdBias >= 0 ? 'curve' : 'bse'; if (s.kind === 'bse') { s.b = spot.clone().add(new V(-2.3, 1.1, 0.9).add(rnd().multiplyScalar(1.4))); s.col = [1, 0.75, 0.45]; } }
        else if (m === 'inlens') { s.kind = 'helix'; s.col = [0.75, 1, 0.8]; s.speed = 0.7; }
        else if (m === 'bse') { const a = Math.random() * 6.28, r = 0.25 + Math.random() * 0.35; s.b = new V(this.bse.position.x + Math.cos(a) * r, this.bse.position.y, Math.sin(a) * r); s.kind = 'line'; s.col = [1, 0.72, 0.4]; s.speed = 2.2; }
        else if (m === 'ebsd') { s.b = this.ebsdScreen.localToWorld(new V((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9, 0)); s.kind = 'line'; s.col = [0.6, 1, 0.7]; s.speed = 2; }
        else if (m === 'tkd') { s.b = this.tkdScreen.localToWorld(new V((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, 0)); s.kind = 'line'; s.col = [0.6, 1, 0.7]; s.speed = 2; }
        else if (m === 'eds') { s.b = edsWin.clone().add(rnd().multiplyScalar(0.15)); s.kind = 'line'; s.col = [1, 0.7, 0.35]; s.speed = 3; }
        else { s.life = -1; sSize[i] = 0; continue; }
      }
      s.t += dt * sp * s.speed;
      if (s.t >= 1) { s.life = -1; sSize[i] = 0; continue; }
      let p;
      if (s.kind === 'curve') { const u = s.t, a = s.a.clone().multiplyScalar((1 - u) * (1 - u)), c = s.c.clone().multiplyScalar(2 * u * (1 - u)), b = s.b.clone().multiplyScalar(u * u); p = a.add(c).add(b); }
      else if (s.kind === 'helix') { const u = s.t, r = 0.18 * (1 - u) + 0.02, ang = u * 18 + i; p = new V(spot.x * (1 - u) + Math.cos(ang) * r, spot.y + u * (Y.inlens - spot.y), spot.z * (1 - u) + Math.sin(ang) * r); }
      else p = s.a.clone().lerp(s.b, s.t);
      sPos[i * 3] = p.x; sPos[i * 3 + 1] = p.y; sPos[i * 3 + 2] = p.z;
      sSize[i] = m === 'eds' ? 0.07 : 0.05; sCol.set(s.col, i * 3);
    }
    const g2 = P2.pts.geometry; g2.attributes.position.needsUpdate = g2.attributes.size.needsUpdate = g2.attributes.color.needsUpdate = true;
  }
  updateLabels(S) {
    const v = new THREE.Vector3();
    for (const L of this.labels) {
      const on = S.showLabels && (!L.modes || L.modes.includes(S.mode));
      if (!on) { L.el.style.opacity = 0; L.el.classList.add('off'); continue; }
      v.fromArray(L.pos()).project(this.camera);
      if (v.z > 1) { L.el.style.opacity = 0; L.el.classList.add('off'); continue; }
      L.el.classList.remove('off');
      L.el.style.opacity = 1;
      L.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * this.W}px, ${(-v.y * 0.5 + 0.5) * this.H}px)`;
    }
  }
  startTour(stops, onStop) { this.tour = { stops, i: -1, t: 0, onStop }; this.nextStop(); }
  nextStop() {
    const T = this.tour;
    T.i++;
    if (T.i >= T.stops.length) { this.stopTour(); return; }
    const s = T.stops[T.i];
    T.from = { pos: this.camera.position.clone(), target: this.controls.target.clone() };
    T.to = { pos: new THREE.Vector3(...s.pos), target: new THREE.Vector3(...(s.target ?? [0, s.y, 0])) };
    T.t = 0;
    T.onStop?.(s, T.i, T.stops.length);
  }
  stepTour(dt) {
    const T = this.tour, s = T.stops[T.i];
    T.t += dt;
    const f = Math.min(1, T.t / 1.6), e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
    this.camera.position.lerpVectors(T.from.pos, T.to.pos, e);
    this.controls.target.lerpVectors(T.from.target, T.to.target, e);
    if (T.t > (s.dur ?? 5.5)) this.nextStop();
  }
  stopTour() { const cb = this.tour?.onStop; this.tour = null; cb?.(null); }
  resetView() { this.stopTour(); this.camera.position.copy(this.home.pos); this.controls.target.copy(this.home.target); }
}
