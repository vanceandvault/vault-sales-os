// Builds PWA icons from the brand artwork (design/app-icon.png) using the installed Chromium (dev-time only).
import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";
import fs from "node:fs";
const src = "data:image/png;base64," + fs.readFileSync("design/app-icon.png").toString("base64");
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
// scale < 1 adds safe-zone padding (maskable icons get cropped to a circle/squircle by the OS)
const out = async (name, size, scale) => {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<body style="margin:0;background:linear-gradient(135deg,#060912 0%,#101828 60%,#151d36 100%);display:grid;place-items:center;width:${size}px;height:${size}px;overflow:hidden"><img src="${src}" style="width:${size * scale}px;height:${size * scale}px"></body>`);
  fs.writeFileSync(`public/icons/${name}`, await p.screenshot()); await p.close();
};
await out("icon-192.png", 192, 1); await out("icon-512.png", 512, 1); await out("icon-maskable-512.png", 512, 0.92); await out("apple-touch-icon.png", 180, 1);
await b.close();
