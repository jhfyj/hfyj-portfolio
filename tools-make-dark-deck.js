/* Generates the dark-theme PokerDeck faces from the light ones.
   ---------------------------------------------------------------------------
   The art is drawn from a five-colour palette and nothing else — sampled
   across all thirteen cards, 98.4% of every pixel is one of these five exactly,
   and the rest is JPEG noise and antialiasing between them:

     #F8F8F8  85.2%   the stock
     #5F81E2  11.8%   the accent
     #829FEF   0.9%   the accent, lit
     #DBDBDB   0.5%   the drop shadow under a raised card
     #3C61C9   0.1%   the accent, shaded

   The user gave the five dark tokens to match. So this is a palette swap, not
   a filter: each source colour has one destination, and a pixel between two
   source colours comes out the same distance between their destinations. That
   keeps the antialiasing intact — a hard nearest-colour match would leave every
   edge jagged.

   Run once. The output is committed. Re-run if the light art changes, or simply
   drop hand-made exports over the outputs — nothing reads these except by
   filename, so replacing them needs no code change.

   Chrome does the pixel work because it is already here and Node has no image
   decoder; this file only drives it.
*/
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:5192';
const OUT_DIR = 'C:/dev/hfyj-art/assets/PokerDeck';

// [light, dark]. The light values are the measured modes; the dark ones are the
// tokens the user supplied.
const PALETTE = [
  ['#F8F8F8', '#373737'],   // stock
  ['#5F81E2', '#FFFA50'],   // accent
  ['#829FEF', '#FFFDB2'],   // accent, lit
  ['#3C61C9', '#D4CF28'],   // accent, shaded
  ['#DBDBDB', '#1A1A1A'],   // drop shadow
];

const FACES = Array.from({ length: 13 }, (_, i) => 'Frame ' + (470 + i) + '.jpg');

(async () => {
  const probe = await fetch(BASE + '/footer-deck.js').then(r => r.text()).catch(() => '');
  if (!/AUTO_RETURN_MS/.test(probe)) throw new Error(BASE + ' is not serving the repo under test');

  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const from = PALETTE.map(p => rgb(p[0]));
  const to = PALETTE.map(p => rgb(p[1]));

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', protocolTimeout: 240000,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });

  let worstResidual = 0;
  for (const face of FACES) {
    const res = await page.evaluate(async (face, from, to) => {
      const load = src => new Promise((ok, no) => {
        const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src;
      });
      const img = await load('./assets/PokerDeck/' + encodeURIComponent(face));
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const id = ctx.getImageData(0, 0, c.width, c.height);
      const d = id.data;

      let residual = 0;   // worst distance from a pixel to the segment it was mapped onto
      for (let i = 0; i < d.length; i += 4) {
        const p = [d[i], d[i + 1], d[i + 2]];

        // The two palette entries this pixel sits nearest to. Flat areas land
        // on one exactly; an antialiased edge sits between the two it is an
        // edge between.
        let ai = 0, bi = 1, ad = Infinity, bd = Infinity;
        for (let k = 0; k < from.length; k++) {
          const dx = p[0] - from[k][0], dy = p[1] - from[k][1], dz = p[2] - from[k][2];
          const dist = dx * dx + dy * dy + dz * dz;
          if (dist < ad) { bd = ad; bi = ai; ad = dist; ai = k; }
          else if (dist < bd) { bd = dist; bi = k; }
        }

        const a = from[ai], b = from[bi];
        const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
        let t = 0;
        if (vv > 0) {
          t = ((p[0] - a[0]) * v[0] + (p[1] - a[1]) * v[1] + (p[2] - a[2]) * v[2]) / vv;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
        }
        const rx = p[0] - (a[0] + v[0] * t), ry = p[1] - (a[1] + v[1] * t), rz = p[2] - (a[2] + v[2] * t);
        const r2 = rx * rx + ry * ry + rz * rz;
        if (r2 > residual) residual = r2;

        const da = to[ai], db = to[bi];
        d[i]     = Math.round(da[0] + (db[0] - da[0]) * t);
        d[i + 1] = Math.round(da[1] + (db[1] - da[1]) * t);
        d[i + 2] = Math.round(da[2] + (db[2] - da[2]) * t);
      }
      ctx.putImageData(id, 0, 0);
      return { data: c.toDataURL('image/jpeg', 0.94), residual: Math.sqrt(residual), w: c.width, h: c.height };
    }, face, from, to);

    if (res.residual > worstResidual) worstResidual = res.residual;
    const out = path.join(OUT_DIR, face.replace(/\.jpg$/, '-dark.jpg'));
    fs.writeFileSync(out, Buffer.from(res.data.split(',')[1], 'base64'));
    console.log(path.basename(out).padEnd(24) + res.w + 'x' + res.h
      + '  worst off-palette distance: ' + res.residual.toFixed(1));
  }

  console.log('\nworst across the deck: ' + worstResidual.toFixed(1)
    + ' (0 = every pixel lay exactly on the palette; JPEG noise alone is ~10)');
  await browser.close();
})();
