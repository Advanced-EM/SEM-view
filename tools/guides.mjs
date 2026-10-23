// Prints the brochure-style guides (docs/guides/*.html) to PDF with headless Chrome: docs/guides/pdf/<name>.pdf
//   node tools/guides.mjs            all guides
//   node tools/guides.mjs sop-01     only guides whose name contains "sop-01"
// Set CHROME=/path/to/chrome if Chrome is not in the usual place.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = resolve('docs/guides'), out = join(dir, 'pdf');
const chrome = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .find((p) => p && existsSync(p));
if (!chrome) { console.error('Chrome not found: set CHROME=/path/to/chrome'); process.exit(1); }
mkdirSync(out, { recursive: true });

const only = process.argv[2] ?? '';
const files = readdirSync(dir).filter((f) => f.endsWith('.html') && f !== 'index.html' && f.includes(only));
for (const f of files) {
  const pdf = join(out, f.replace(/\.html$/, '.pdf'));
  // the virtual-time budget lets web fonts and the QR-code script load before printing
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=10000', '--run-all-compositor-stages-before-draw',
    `--print-to-pdf=${pdf}`, pathToFileURL(join(dir, f)).href], { stdio: ['ignore', 'ignore', 'pipe'] });
  console.log(`${pdf}  ${(statSync(pdf).size / 1e6).toFixed(1)} MB`);
}
