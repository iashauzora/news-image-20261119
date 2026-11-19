// The World in a Day — Thursday, 19 November 2026.
//
// Entry program for make.fun's news-image-20261119 bounty ("Sum up
// 19 November's world news in one image"). The front page is bundled
// beside this file as entry.png; the program checks the asset is a
// whole PNG of exactly the permitted size and then delivers it, byte
// for byte, to the output directory. It runs offline and writes the
// same bytes on every run.
//
// The page itself lives in design/front-page.html and was rendered to
// entry.png at 1024x1024; design/sources.md lists the reporting each
// of its six stories was checked against.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSET_PATH = join(HERE, "entry.png");
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
const OUT_PATH = join(OUT_DIR, "entry.png");

const BYTE_LIMIT = 1_048_576; // 1 MiB, the competition's cap
const PAGE_WIDTH = 1024;
const PAGE_HEIGHT = 1024;

function refuse(reason: string): never {
  console.error(`entry refused: ${reason}`);
  process.exit(1);
}

const page = readFileSync(ASSET_PATH);

// A PNG opens with this fixed eight-byte signature.
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const signed =
  page.length >= SIGNATURE.length &&
  SIGNATURE.every((byte, i) => page[i] === byte);
if (!signed) refuse("bundled entry.png does not start with a PNG signature");

if (page.length > BYTE_LIMIT) {
  refuse(`bundled entry.png is ${page.length} bytes, over the 1 MiB cap`);
}

// The first chunk is always IHDR; its payload begins with the image
// width and height as big-endian uint32s, at offsets 16 and 20.
const width = page.readUInt32BE(16);
const height = page.readUInt32BE(20);
if (width !== PAGE_WIDTH || height !== PAGE_HEIGHT) {
  refuse(`bundled entry.png is ${width}x${height}, not 1024x1024`);
}

// Walk every chunk and verify its CRC-32, so a truncated or corrupted
// asset is refused here instead of delivered. Each chunk is laid out
// as: length (4 bytes), type (4 bytes), data (length bytes), CRC (4).
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer, from: number, to: number): number {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

let offset = SIGNATURE.length;
let sawEnd = false;
while (offset < page.length) {
  if (offset + 8 > page.length) refuse("chunk header runs past end of file");
  const length = page.readUInt32BE(offset);
  const type = page.toString("ascii", offset + 4, offset + 8);
  const dataEnd = offset + 8 + length;
  if (dataEnd + 4 > page.length) refuse(`chunk ${type} runs past end of file`);
  const stored = page.readUInt32BE(dataEnd);
  if (crc32(page, offset + 4, dataEnd) !== stored) {
    refuse(`chunk ${type} fails its CRC check`);
  }
  offset = dataEnd + 4;
  if (type === "IEND") {
    sawEnd = true;
    break;
  }
}
if (!sawEnd) refuse("no IEND chunk — the PNG is not whole");
if (offset !== page.length) refuse("trailing bytes after IEND");

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_PATH, page);

const digest = createHash("sha256").update(page).digest("hex");
console.log(`wrote ${OUT_PATH} — ${page.length} bytes, sha256 ${digest}`);
