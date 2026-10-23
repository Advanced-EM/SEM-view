// Cache-busting: stamp a version onto every module, the stylesheet and the entry script in index.html,
// so browsers fetch fresh code after each deploy. Run before committing a release:
//   node tools/stamp.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const v = new Date().toISOString().replace(/\D/g, '').slice(0, 12);
const mods = readdirSync(new URL('js/', root)).filter((f) => f.endsWith('.js')).sort();
let html = readFileSync(new URL('index.html', root), 'utf8');
const map = { three: 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', 'three/addons/': 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/' };
for (const f of mods) map[`./js/${f}`] = `./js/${f}?v=${v}`;
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, `<script type="importmap">\n${JSON.stringify({ imports: map }, null, 1)}\n</script>`);
html = html.replace(/href="css\/style\.css(\?v=\w+)?"/, `href="css/style.css?v=${v}"`);
html = html.replace(/src="js\/main\.js(\?v=\w+)?"/, `src="js/main.js?v=${v}"`);
writeFileSync(new URL('index.html', root), html);
console.log(`stamped v=${v} on ${mods.length} modules`);
