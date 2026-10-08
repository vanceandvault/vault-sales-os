// Generates PWA icons with the brand colours using the installed Chromium (dev-time only).
import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";
import fs from "node:fs";
const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#070B12"/>
<g transform="translate(256 256) scale(${pad}) translate(-256 -256)"><rect x="96" y="96" width="320" height="320" rx="44" fill="#17213A" stroke="#517EB7" stroke-width="6"/>
<path d="M160 190 L256 350 L352 190" fill="none" stroke="#F3FF9A" stroke-width="34" stroke-linecap="square" stroke-linejoin="miter"/></g></svg>`;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const out = async (name, size, pad) => {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<body style="margin:0;background:#070B12">${svg(pad).replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body>`);
  fs.writeFileSync(`public/icons/${name}`, await p.screenshot()); await p.close();
};
await out("icon-192.png", 192, 1); await out("icon-512.png", 512, 1); await out("icon-maskable-512.png", 512, 0.78); await out("apple-touch-icon.png", 180, 1);
await b.close();
