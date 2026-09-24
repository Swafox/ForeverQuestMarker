/**
 * A tiny anti-aliased rasterizer for the marker art: shapes are polygons, drawn by
 * sampling a signed distance field several times per pixel.
 */

export type RGBA = [number, number, number, number];
export type Point = [number, number];

export class Image {
  readonly pixels: Float64Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = new Float64Array(width * height * 4);
  }

  /** Source-over blend of a straight-alpha color with the given coverage. */
  blend(x: number, y: number, color: RGBA, coverage: number): void {
    const alpha = color[3] * coverage;
    if (alpha <= 0) return;
    const i = (y * this.width + x) * 4;
    const p = this.pixels;
    const destAlpha = p[i + 3]!;
    const outAlpha = alpha + destAlpha * (1 - alpha);
    for (let c = 0; c < 3; c++) {
      const src = color[c]! * alpha;
      const dest = p[i + c]! * destAlpha * (1 - alpha);
      p[i + c] = outAlpha > 0 ? (src + dest) / outAlpha : 0;
    }
    p[i + 3] = outAlpha;
  }

  get(x: number, y: number): RGBA {
    const i = (y * this.width + x) * 4;
    const p = this.pixels;
    return [p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!];
  }

  /** Copies another image into this one at an offset (used to build the atlas). */
  place(source: Image, offsetX: number, offsetY: number): void {
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const [r, g, b, a] = source.get(x, y);
        this.blend(offsetX + x, offsetY + y, [r, g, b, 1], a);
      }
    }
  }

  /** Box-filtered downscale, the way the client samples a small texture. */
  resize(width: number, height: number): Image {
    const out = new Image(width, height);
    const sx = this.width / width;
    const sy = this.height / height;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0,
          g = 0,
          b = 0,
          a = 0,
          n = 0;
        for (let yy = Math.floor(y * sy); yy < Math.ceil((y + 1) * sy); yy++) {
          for (
            let xx = Math.floor(x * sx);
            xx < Math.ceil((x + 1) * sx);
            xx++
          ) {
            const [pr, pg, pb, pa] = this.get(xx, yy);
            r += pr * pa;
            g += pg * pa;
            b += pb * pa;
            a += pa;
            n++;
          }
        }
        const i = (y * width + x) * 4;
        out.pixels[i] = a > 0 ? r / a : 0;
        out.pixels[i + 1] = a > 0 ? g / a : 0;
        out.pixels[i + 2] = a > 0 ? b / a : 0;
        out.pixels[i + 3] = a / n;
      }
    }
    return out;
  }
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function insidePolygon(p: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (
      yi > p[1] !== yj > p[1] &&
      p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Signed distance to a polygon's outline: negative inside, positive outside. */
export function signedDistance(p: Point, polygon: readonly Point[]): number {
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    best = Math.min(best, distanceToSegment(p, polygon[j]!, polygon[i]!));
  }
  return insidePolygon(p, polygon) ? -best : best;
}

/**
 * Paints each pixel by asking `shade` for the color at several sample points and
 * averaging. `shade` returns null for transparent samples.
 */
export function paint(
  image: Image,
  shade: (p: Point) => RGBA | null,
  samples = 6,
): void {
  const total = samples * samples;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const color = shade([
            x + (sx + 0.5) / samples,
            y + (sy + 0.5) / samples,
          ]);
          if (!color) continue;
          r += color[0] * color[3];
          g += color[1] * color[3];
          b += color[2] * color[3];
          a += color[3];
        }
      }
      if (a > 0) image.blend(x, y, [r / a, g / a, b / a, 1], a / total);
    }
  }
}

export function hex(value: string, alpha = 1): RGBA {
  const n = Number.parseInt(value.replace("#", ""), 16);
  return [
    ((n >> 16) & 255) / 255,
    ((n >> 8) & 255) / 255,
    (n & 255) / 255,
    alpha,
  ];
}

export function shadeColor(color: RGBA, factor: number): RGBA {
  return [
    Math.min(1, color[0] * factor),
    Math.min(1, color[1] * factor),
    Math.min(1, color[2] * factor),
    color[3],
  ];
}
