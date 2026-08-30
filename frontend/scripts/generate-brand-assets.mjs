#!/usr/bin/env node
/**
 * Generates every Tech Office brand asset — mobile app icons, splash screens
 * and notification icon, plus the web favicon, PWA icons and OG image — from
 * one geometric definition of the mark, rasterised with headless Chrome.
 *
 * Run after changing the mark:
 *
 *   node scripts/generate-brand-assets.mjs
 *   (cd apps/mobile && npx expo prebuild)   # to refresh the native projects
 *
 * Chrome is the rasteriser because it is already on every dev machine here and
 * the repo has no image toolchain (no sharp/resvg/imagemagick).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MOBILE = join(ROOT, "apps", "mobile", "assets");
const WEB = join(ROOT, "apps", "web");
const TMP = join(ROOT, "apps", "web", "tmp", "brand-assets");

const CHROME =
  process.env.CHROME_BIN ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const COLOR = {
  navy: "#1F3B73",
  navyDeep: "#16305F",
  amber: "#F0A02E",
  coral: "#F2603C",
  lightBgFrom: "#FBA765",
  lightBgTo: "#F05F3B",
  darkBg: "#101418",
};

/* ---------------------------------------------------------------- geometry */

/** Toothed ring: outer gear silhouette with a concentric bore (evenodd). */
function gear({ cx, cy, r, tooth, teeth, bore = 0, twist = 0 }) {
  const pts = [];
  const step = (Math.PI * 2) / teeth;
  // Each tooth occupies half the pitch; the trapezoid narrows towards the tip.
  const rootHalf = step * 0.29;
  const tipHalf = step * 0.17;
  for (let i = 0; i < teeth; i += 1) {
    const c = twist + i * step;
    pts.push([r, c - rootHalf], [r + tooth, c - tipHalf], [r + tooth, c + tipHalf], [r, c + rootHalf]);
  }
  const ring = pts
    .map(([rad, ang], i) => {
      const x = cx + rad * Math.cos(ang);
      const y = cy + rad * Math.sin(ang);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  if (!bore) return `${ring} Z`;
  // Bore drawn as two arcs so evenodd punches it out.
  const hole =
    `M${(cx - bore).toFixed(2)},${cy.toFixed(2)} ` +
    `a${bore},${bore} 0 1,0 ${bore * 2},0 ` +
    `a${bore},${bore} 0 1,0 ${-bore * 2},0`;
  return `${ring} Z ${hole} Z`;
}

// Arrow: a growth stroke rising from the lower left, through the gear hub and
// out past the teeth at the upper right. The last control point fixes the
// tangent the arrowhead is aimed along.
// It enters and leaves through the gaps between teeth (144 deg and -36 deg off
// the hub) so the knockout never severs a tooth into a floating fragment.
const ARROW_D =
  "M233,706 C330,640 400,600 500,512 C600,424 670,384 767,318";
const ARROW_END = { x: 767, y: 318 };
const ARROW_CTRL = { x: 670, y: 384 };
const ARROW_ANGLE = Math.atan2(ARROW_END.y - ARROW_CTRL.y, ARROW_END.x - ARROW_CTRL.x);
const SHAFT_W = 78;
const HEAD_LEN = 132;
const HEAD_HALF = 98;

/** Solid arrowhead: base across the shaft end, tip further along the tangent. */
function arrowHead(grow = 0) {
  const { x, y } = ARROW_END;
  const dx = Math.cos(ARROW_ANGLE);
  const dy = Math.sin(ARROW_ANGLE);
  const len = HEAD_LEN + grow;
  const half = HEAD_HALF + grow;
  const back = grow; // widening also pushes the base back so the gap is even
  const pt = (along, side) =>
    `${(x + dx * along - dy * side).toFixed(2)},${(y + dy * along + dx * side).toFixed(2)}`;
  return `M${pt(len, 0)} L${pt(-back, half)} L${pt(-back, -half)} Z`;
}

const GEAR_D = gear({
  cx: 500,
  cy: 512,
  r: 250,
  tooth: 58,
  teeth: 10,
  bore: 126,
  twist: -Math.PI / 2,
});

let maskSeq = 0;

/**
 * The mark: a gear with the growth arrow rising through it. The arrow is cut
 * out of the gear with a mask (rather than drawn over it) so the two shapes
 * stay legible even when both are the same colour — which is what the
 * monochrome, tinted and notification variants need.
 */
function markParts(gearFill, arrowFill, { scale = 1, dx = -24, dy = 0 } = {}) {
  const id = `cut${(maskSeq += 1)}`;
  const defs = `
    <mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
      <rect width="1024" height="1024" fill="#fff"/>
      <path fill="none" stroke="#000" stroke-width="${SHAFT_W + 52}" stroke-linecap="round" d="${ARROW_D}"/>
      <path fill="#000" d="${arrowHead(26)}"/>
    </mask>`;
  const body = `
    <g transform="translate(512 512) scale(${scale}) translate(${-512 + dx} ${-512 + dy})">
      <path fill-rule="evenodd" fill="${gearFill}" mask="url(#${id})" d="${GEAR_D}"/>
      <path fill="none" stroke="${arrowFill}" stroke-width="${SHAFT_W}" stroke-linecap="round" d="${ARROW_D}"/>
      <path fill="${arrowFill}" d="${arrowHead()}"/>
    </g>`;
  return { defs, body };
}

function mark({ gearFill, arrowFill, scale = 1, dx, dy }) {
  const { defs, body } = markParts(gearFill, arrowFill, { scale, dx, dy });
  return `<defs>${defs}</defs>${body}`;
}

/** Full-colour lockup: amber gear behind, navy gear front, navy-to-coral arrow. */
function markColor({ scale = 1, dx = -24, dy = 0, front = COLOR.navy } = {}) {
  const back = gear({ cx: 296, cy: 348, r: 140, tooth: 36, teeth: 9, bore: 62, twist: 0.35 });
  // Front gear silhouette with no bore, so the amber gear behind is occluded by
  // the whole navy disc (plus a stroked gap) rather than peeking through its hub.
  const frontSolid = gear({ cx: 500, cy: 512, r: 250, tooth: 58, teeth: 10, twist: -Math.PI / 2 });
  const { defs, body } = markParts(front, "url(#arrowGrad)", { scale, dx, dy });
  return (
    `<defs>${defs}
      <mask id="behind" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
        <rect width="1024" height="1024" fill="#fff"/>
        <path fill="#000" stroke="#000" stroke-width="30" stroke-linejoin="round" d="${frontSolid}"/>
      </mask>
    </defs>` +
    `<g transform="translate(512 512) scale(${scale}) translate(${-512 + dx} ${-512 + dy})">` +
    `<path fill-rule="evenodd" fill="${COLOR.amber}" mask="url(#behind)" d="${back}"/></g>` +
    body
  );
}

const ARROW_GRAD = `
  <linearGradient id="arrowGrad" x1="233" y1="706" x2="800" y2="250" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="${COLOR.navyDeep}"/>
    <stop offset=".55" stop-color="${COLOR.coral}"/>
    <stop offset="1" stop-color="${COLOR.coral}"/>
  </linearGradient>`;

const svg = (defs, body, bg = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">` +
  `<defs>${defs}</defs>${bg}${body}</svg>`;

const WARM_BG = `<linearGradient id="bg" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="${COLOR.lightBgFrom}"/>
    <stop offset="1" stop-color="${COLOR.lightBgTo}"/>
  </linearGradient>`;

/* ------------------------------------------------------------- app artwork */

const ICON_LIGHT = svg(
  WARM_BG,
  mark({ gearFill: COLOR.navy, arrowFill: COLOR.navy, scale: 0.82 }),
  `<rect width="1024" height="1024" fill="url(#bg)"/>`,
);

/** Re-sizes a generated 1024-square SVG for embedding at another scale. */
const sized = (source, n) =>
  source.replace('width="1024" height="1024"', `width="${n}" height="${n}"`);

/** Wordmark lockup for social previews: mark on the left, two-line name right. */
const OG_IMAGE = `
<div style="width:1200px;height:630px;display:flex;align-items:center;gap:56px;
            padding:0 88px;box-sizing:border-box;background:#F5F2ED;
            font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
  ${sized(svg(ARROW_GRAD, markColor({ scale: 0.94 })), 320)}
  <div>
    <div style="font-size:104px;line-height:.94;font-weight:700;letter-spacing:-.035em;
                color:${COLOR.navy}">transformar<br>work</div>
    <div style="margin-top:28px;font-size:30px;font-weight:500;color:#5A6B85">
      One simple workspace for small teams.</div>
  </div>
</div>`;

/**
 * Every generated file. `w`/`h` default to 1024; `html` entries are rendered as
 * a page instead of a bare SVG so the OG image can lay out real text.
 */
const TARGETS = [
  /* ---------------------------------------------------------------- mobile */

  // iOS / default app icon — navy mark on the warm gradient ground.
  { out: join(MOBILE, "icon.png"), svg: ICON_LIGHT },

  // iOS dark appearance — amber mark glowing on near-black.
  {
    out: join(MOBILE, "icon-dark.png"),
    svg: svg(
      `<radialGradient id="glow" cx="50%" cy="48%" r="58%">
         <stop offset="0" stop-color="#1E2A38"/>
         <stop offset="1" stop-color="${COLOR.darkBg}"/>
       </radialGradient>
       <linearGradient id="warm" x1="233" y1="706" x2="800" y2="250" gradientUnits="userSpaceOnUse">
         <stop offset="0" stop-color="${COLOR.coral}"/>
         <stop offset="1" stop-color="${COLOR.amber}"/>
       </linearGradient>`,
      mark({ gearFill: "url(#warm)", arrowFill: "url(#warm)", scale: 0.82 }),
      `<rect width="1024" height="1024" fill="url(#glow)"/>`,
    ),
  },

  // iOS tinted appearance — must be an opaque greyscale image: iOS derives the
  // tint from its luminance, and a transparent PNG gets flattened onto white.
  {
    out: join(MOBILE, "icon-tinted.png"),
    svg: svg(
      "",
      mark({ gearFill: "#F2F2F2", arrowFill: "#F2F2F2", scale: 0.82 }),
      `<rect width="1024" height="1024" fill="#0B0B0B"/>`,
    ),
  },

  // Android adaptive foreground — navy on the gradient background below. Only
  // the middle 66% of an adaptive icon is guaranteed visible, hence the scale.
  {
    out: join(MOBILE, "adaptive-icon.png"),
    svg: svg("", mark({ gearFill: COLOR.navy, arrowFill: COLOR.navy, scale: 0.6 })),
  },
  {
    out: join(MOBILE, "adaptive-icon-background.png"),
    svg: svg(WARM_BG, "", `<rect width="1024" height="1024" fill="url(#bg)"/>`),
  },
  // Android themed-icon layer — single-colour silhouette, system recolours it.
  {
    out: join(MOBILE, "adaptive-icon-monochrome.png"),
    svg: svg("", mark({ gearFill: "#fff", arrowFill: "#fff", scale: 0.6 })),
  },

  // Splash — full-colour lockup on transparent. There is no dark variant: every
  // screen in the app is hardcoded to lightPalette, so a dark splash would flash
  // dark-to-white on launch whenever the OS is in dark mode.
  { out: join(MOBILE, "splash-icon.png"), svg: svg(ARROW_GRAD, markColor({ scale: 0.86 })) },

  // Android notification — must be a flat white silhouette on transparent with
  // padding, because Android masks it to the alpha channel and tints it.
  {
    out: join(MOBILE, "notification-icon.png"),
    svg: svg("", mark({ gearFill: "#fff", arrowFill: "#fff", scale: 0.62 })),
  },

  /* ------------------------------------------------------------------- web */

  // Next.js metadata-file conventions: these are picked up by their filename
  // and emitted as <link rel="icon"> / apple-touch-icon / og:image.
  { out: join(WEB, "src/app/icon.png"), svg: ICON_LIGHT, w: 256, h: 256 },
  { out: join(WEB, "src/app/apple-icon.png"), svg: ICON_LIGHT, w: 180, h: 180 },
  { out: join(WEB, "src/app/opengraph-image.png"), html: OG_IMAGE, w: 1200, h: 630 },

  // Referenced by the web manifest and by firebase-messaging-sw.js.
  { out: join(WEB, "public/icon-192.png"), svg: ICON_LIGHT, w: 192, h: 192 },
  { out: join(WEB, "public/icon-512.png"), svg: ICON_LIGHT, w: 512, h: 512 },
  // Maskable icons get cropped to a circle, so the mark stays in the safe zone.
  {
    out: join(WEB, "public/icon-maskable-512.png"),
    svg: svg(WARM_BG, mark({ gearFill: COLOR.navy, arrowFill: COLOR.navy, scale: 0.58 }),
      `<rect width="1024" height="1024" fill="url(#bg)"/>`),
    w: 512,
    h: 512,
  },

  // Legacy /favicon.ico for crawlers that ignore <link rel="icon">.
  { out: join(WEB, "src/app/favicon.ico"), svg: ICON_LIGHT, w: 32, h: 32, ico: true },
];

/* --------------------------------------------------------------- rasterise */

/** Wraps a PNG in a single-image ICO container (valid since Windows Vista). */
function icoWrap(png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  header.writeUInt8(32, 6); // width
  header.writeUInt8(32, 7); // height
  header.writeUInt8(0, 8); // palette size (0 = truecolour)
  header.writeUInt8(0, 9); // reserved
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18); // offset of the image data
  return Buffer.concat([header, png]);
}

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

for (const [i, t] of TARGETS.entries()) {
  const w = t.w ?? 1024;
  const h = t.h ?? 1024;
  const src = join(TMP, `${i}.html`);
  const shot = join(TMP, `${i}.png`);
  // A zero-margin page sized exactly to the output keeps the screenshot 1:1.
  writeFileSync(
    src,
    `<style>html,body{margin:0;padding:0}svg,div{display:block}</style>` +
      (t.html ?? t.svg.replace('width="1024" height="1024"', `width="${w}" height="${h}"`)),
  );
  execFileSync(
    CHROME,
    [
      "--headless",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--default-background-color=00000000",
      `--window-size=${w},${h}`,
      `--screenshot=${shot}`,
      `file://${src}`,
    ],
    { stdio: "ignore" },
  );
  mkdirSync(dirname(t.out), { recursive: true });
  const png = readFileSync(shot);
  writeFileSync(t.out, t.ico ? icoWrap(png) : png);
  console.log(`wrote ${t.out.replace(`${ROOT}/`, "")}`);
}

rmSync(TMP, { recursive: true, force: true });
