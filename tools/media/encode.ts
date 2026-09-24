import { deflateSync } from "node:zlib";
import type { Image } from "./raster";

const toByte = (value: number) =>
  Math.max(0, Math.min(255, Math.round(value * 255)));

/**
 * Uncompressed 32-bit TGA with 8 alpha bits and the default bottom-left origin,
 * the most widely supported variant (and what the WoW client reads for addon art).
 */
export function encodeTga(image: Image): Uint8Array {
  const header = new Uint8Array(18);
  const view = new DataView(header.buffer);
  header[2] = 2; // uncompressed true color
  view.setUint16(12, image.width, true);
  view.setUint16(14, image.height, true);
  header[16] = 32;
  header[17] = 8; // 8 alpha bits, bottom-left origin

  const body = new Uint8Array(image.width * image.height * 4);
  let offset = 0;
  for (let y = image.height - 1; y >= 0; y--) {
    for (let x = 0; x < image.width; x++) {
      const [r, g, b, a] = image.get(x, y);
      body[offset++] = toByte(b);
      body[offset++] = toByte(g);
      body[offset++] = toByte(r);
      body[offset++] = toByte(a);
    }
  }
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0);
  out.set(body, header.length);
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** RGBA PNG, used for previews only. */
export function encodePng(image: Image): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, image.width);
  view.setUint32(4, image.height);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = new Uint8Array((image.width * 4 + 1) * image.height);
  let offset = 0;
  for (let y = 0; y < image.height; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < image.width; x++) {
      for (const channel of image.get(x, y)) raw[offset++] = toByte(channel);
    }
  }
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let position = 0;
  for (const part of parts) {
    out.set(part, position);
    position += part.length;
  }
  return out;
}
