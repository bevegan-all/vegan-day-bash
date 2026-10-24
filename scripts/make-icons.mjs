// Draws the app icons (PNG) used when the site is installed on a phone.
// Run once (the PNGs are committed): npm i --no-save sharp && node scripts/make-icons.mjs
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const SPROUT = `<path d="M16 25V14M16 14c0-4 3-7 8-7 0 4-3 7-8 7ZM16 18c0-3-2-5-6-5 0 3 2 5 6 5Z" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;

// rounded: the normal icon. full: a plain square, for phones that cut their own shape (maskable and iOS).
const svg = ({ rounded, pad }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${32 + pad * 2} ${32 + pad * 2}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#23895a"/><stop offset="1" stop-color="#145437"/></linearGradient></defs>
  <rect x="${-pad}" y="${-pad}" width="${32 + pad * 2}" height="${32 + pad * 2}" rx="${rounded ? 7 : 0}" fill="url(#g)"/>
  ${SPROUT}
</svg>`;

mkdirSync("public/icons", { recursive: true });
const jobs = [
  ["icon-192.png", 192, svg({ rounded: true, pad: 0 })],
  ["icon-512.png", 512, svg({ rounded: true, pad: 0 })],
  ["icon-maskable-512.png", 512, svg({ rounded: false, pad: 6 })], // extra margin keeps the sprout inside the safe zone
  ["apple-touch-icon.png", 180, svg({ rounded: false, pad: 3 })],
];
for (const [name, size, art] of jobs) {
  const png = await sharp(Buffer.from(art), { density: 384 }).resize(size, size).png().toBuffer();
  writeFileSync(`public/icons/${name}`, png);
  console.log(name, size, png.length, "bytes");
}
