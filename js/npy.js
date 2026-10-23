// Minimal NumPy .npy / .npz writers and readers (float32 data), usable in the browser and in Node.
const enc = new TextEncoder();

export function npy(data, shape) {
  const descr = data instanceof Float64Array ? '<f8' : '<f4';
  const arr = data instanceof Float64Array || data instanceof Float32Array ? data : Float32Array.from(data);
  let h = `{'descr': '${descr}', 'fortran_order': False, 'shape': (${shape.join(', ')}${shape.length === 1 ? ',' : ''}), }`;
  const pad = 64 - ((10 + h.length + 1) % 64);
  h += ' '.repeat(pad % 64) + '\n';
  const head = enc.encode(h), out = new Uint8Array(10 + head.length + arr.byteLength);
  out.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0, head.length & 255, head.length >> 8], 0);
  out.set(head, 10);
  out.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), 10 + head.length);
  return out;
}

// Read a 2D .npy (little-endian float32/64, uint8/16, int16/32) into Float32Array.
export function readNpy(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] !== 0x93 || String.fromCharCode(...u8.slice(1, 6)) !== 'NUMPY') throw new Error('not a .npy file');
  const major = u8[6], hl = major === 1 ? u8[8] | (u8[9] << 8) : u8[8] | (u8[9] << 8) | (u8[10] << 16) | (u8[11] << 24);
  const off = major === 1 ? 10 : 12;
  const h = new TextDecoder().decode(u8.slice(off, off + hl));
  const descr = /'descr':\s*'([^']+)'/.exec(h)?.[1], shape = /'shape':\s*\(([^)]*)\)/.exec(h)?.[1].split(',').filter((v) => v.trim()).map(Number);
  if (/True/.test(/'fortran_order':\s*(\w+)/.exec(h)?.[1] ?? '')) throw new Error('Fortran-ordered arrays are not supported');
  const T = { '<f4': Float32Array, '<f8': Float64Array, '|u1': Uint8Array, '<u2': Uint16Array, '<i2': Int16Array, '<i4': Int32Array, '|i1': Int8Array }[descr];
  if (!T) throw new Error(`unsupported dtype ${descr}`);
  const start = off + hl, n = shape.reduce((a, b) => a * b, 1);
  const raw = new T(buf.slice(start, start + n * T.BYTES_PER_ELEMENT));
  return { data: Float32Array.from(raw), shape };
}

// .npz is a zip of .npy files; stored (uncompressed) entries are enough.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

export function zip(files) { // files: [{ name, bytes }]
  const parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.bytes), sz = f.bytes.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true); lh.setUint16(26, name.length, true);
    parts.push(new Uint8Array(lh.buffer), name, f.bytes);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint32(16, crc, true); ch.setUint32(20, sz, true); ch.setUint32(24, sz, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + sz;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const b of all) { out.set(b, p); p += b.length; }
  return out;
}
export const jsonBytes = (o) => enc.encode(JSON.stringify(o, null, 1));
