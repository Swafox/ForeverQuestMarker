#!/usr/bin/env bun
/**
 * Draws the marker art.
 *
 *   Media/Badges.tga  128x32 atlas: confirmed, inferred, changed, Season of Discovery
 *   Media/Icon.tga    64x64 addon list icon
 *   docs/media/*.png  previews at in-game sizes on quest-window and dark backgrounds
 *
 * States differ by shape as well as color: solid star, hollow star, half-filled star
 * and a diamond, so they stay distinguishable without relying on color.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { encodePng, encodeTga } from "./media/encode";
import {
  hex,
  Image,
  paint,
  type Point,
  type RGBA,
  shadeColor,
  signedDistance,
} from "./media/raster";
import { REPO_ROOT } from "./data/sources";

const CELL = 32;
const OUTLINE = hex("#24180a", 0.96);
const GOLD = hex("#e6c067");
const BLUE = hex("#8fb3e0");
const VIOLET = hex("#b48ce6");

function star(cx: number, cy: number, outer: number, inner: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI / 4) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? outer : inner;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return points;
}

function diamond(cx: number, cy: number, radius: number): Point[] {
  return [
    [cx, cy - radius],
    [cx + radius, cy],
    [cx, cy + radius],
    [cx - radius, cy],
  ];
}

/** Metal-like vertical gradient: lighter at the top, deeper at the bottom. */
function gradient(color: RGBA, y: number, top: number, bottom: number): RGBA {
  const t = Math.max(0, Math.min(1, (y - top) / (bottom - top)));
  return shadeColor(color, 1.22 - 0.42 * t);
}

type Fill = "solid" | "hollow" | "half";

function drawEmblem(
  shape: Point[],
  color: RGBA,
  fill: Fill,
  extra?: (p: Point) => RGBA | null,
): Image {
  const image = new Image(CELL, CELL);
  const outline = 2.0;
  const ring = 2.8;
  const innerLine = 1.2;
  const top = Math.min(...shape.map((p) => p[1]));
  const bottom = Math.max(...shape.map((p) => p[1]));
  const centerX =
    (Math.min(...shape.map((p) => p[0])) +
      Math.max(...shape.map((p) => p[0]))) /
    2;

  paint(image, (p) => {
    const d = signedDistance(p, shape);
    if (d > outline) return null;
    if (d > 0) return OUTLINE;
    const filled = fill === "solid" || (fill === "half" && p[0] < centerX);
    if (filled || d > -ring) {
      const detail = extra?.(p);
      return detail ?? gradient(color, p[1], top, bottom);
    }
    if (d > -ring - innerLine) return OUTLINE;
    // Hollow interior: a faint shadow keeps the ring readable on parchment.
    return hex("#24180a", 0.18);
  });
  return image;
}

function drawBadges(): Image[] {
  // A full-bodied star: thin sparkle arms would leave no room to show "hollow" or
  // "half" at the 13 to 16 pixel sizes the client draws it.
  const starShape = star(16, 16, 14.6, 7.8);
  const confirmed = drawEmblem(starShape, GOLD, "solid");
  const inferred = drawEmblem(starShape, GOLD, "hollow");
  const changed = drawEmblem(starShape, BLUE, "half");
  const gem = diamond(16, 16, 5.2);
  const sod = drawEmblem(diamond(16, 16, 13.2), VIOLET, "solid", (p) =>
    signedDistance(p, gem) < 0 ? hex("#f3eaff") : null,
  );
  return [confirmed, inferred, changed, sod];
}

function drawIcon(): Image {
  const size = 64;
  const image = new Image(size, size);
  const center = size / 2;
  paint(image, ([x, y]) => {
    const distance = Math.hypot(x - center, y - center);
    if (distance > 30) return null;
    if (distance > 27.5)
      return shadeColor(hex("#9c7738"), 1.1 - (y / size) * 0.4);
    if (distance > 26.5) return hex("#1a1208");
    const t = distance / 26.5;
    return shadeColor(hex("#3a2a14"), 1 - t * 0.55);
  });
  const shape = star(center, center, 22, 8.2);
  const top = center - 22;
  const bottom = center + 22;
  paint(image, (p) => {
    const d = signedDistance(p, shape);
    if (d > 2.6) return null;
    if (d > 0) return OUTLINE;
    return gradient(GOLD, p[1], top, bottom);
  });
  return image;
}

/** Nearest-neighbour upscale for previews, so individual pixels stay visible. */
function magnify(image: Image, factor: number): Image {
  const out = new Image(image.width * factor, image.height * factor);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const [r, g, b, a] = image.get(
        Math.floor(x / factor),
        Math.floor(y / factor),
      );
      out.blend(x, y, [r, g, b, 1], a);
    }
  }
  return out;
}

function filled(width: number, height: number, color: RGBA): Image {
  const image = new Image(width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) image.blend(x, y, color, 1);
  return image;
}

/** Each badge at in-game sizes on the quest window parchment and on a dark panel. */
function drawPreview(badges: Image[]): Image {
  const sizes = [13, 16];
  const backgrounds = [hex("#e9d5a8"), hex("#1c1a17")];
  const pad = 6;
  const cellWidth = sizes.reduce((sum, s) => sum + s + pad, pad);
  const row = filled(cellWidth * badges.length, 16 + pad * 2, backgrounds[0]!);
  const preview = new Image(row.width, row.height * backgrounds.length);
  backgrounds.forEach((background, rowIndex) => {
    const strip = filled(row.width, row.height, background);
    badges.forEach((badge, index) => {
      let x = index * cellWidth + pad;
      for (const size of sizes) {
        strip.place(badge.resize(size, size), x, pad + (16 - size));
        x += size + pad;
      }
    });
    preview.place(strip, 0, rowIndex * row.height);
  });
  return magnify(preview, 4);
}

const badges = drawBadges();
const atlas = new Image(CELL * badges.length, CELL);
badges.forEach((badge, index) => atlas.place(badge, index * CELL, 0));
const icon = drawIcon();

const outputs: [string, Uint8Array][] = [
  ["Media/Badges.tga", encodeTga(atlas)],
  ["Media/Icon.tga", encodeTga(icon)],
  ["docs/media/badges-atlas.png", encodePng(magnify(atlas, 4))],
  ["docs/media/badges-in-game-sizes.png", encodePng(drawPreview(badges))],
  ["docs/media/icon.png", encodePng(magnify(icon, 2))],
];
for (const [relativePath, bytes] of outputs) {
  const path = join(REPO_ROOT, relativePath);
  await mkdir(join(path, ".."), { recursive: true });
  await Bun.write(path, bytes);
  console.log(`wrote ${relativePath} (${bytes.length} bytes)`);
}
