import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const source = await readFile(new URL("../app/data.ts", import.meta.url), "utf8");
const rows = [...source.matchAll(
  /\["(\d+)",\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?),\s*-?\d+(?:\.\d+)?,\s*\d+,\s*\d+,\s*\d+\]/g,
)].map((match) => ({ id: match[1], ra: match[2], dec: match[3] }));

if (rows.length !== 160) {
  throw new Error(`Expected 160 galaxy rows, found ${rows.length}`);
}

const spectraDir = new URL("../public/sdss/spectra/", import.meta.url);
const stampsDir = new URL("../public/sdss/stamps/", import.meta.url);
await mkdir(spectraDir, { recursive: true });
await mkdir(stampsDir, { recursive: true });

async function download(url, destination) {
  if (existsSync(destination)) return;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const response = await fetch(url);
    if (response.ok) {
      await writeFile(destination, Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (attempt === 4) throw new Error(`${response.status} from ${url}`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 750));
  }
}

let cursor = 0;
const workers = Array.from({ length: 6 }, async () => {
  while (cursor < rows.length) {
    const row = rows[cursor++];
    const spectrumPath = new URL(`${row.id}.jpg`, spectraDir);
    const stampPath = new URL(`${row.id}.jpg`, stampsDir);
    const cutout = new URL("https://skyserver.sdss.org/dr18/SkyServerWS/ImgCutout/getjpeg");
    cutout.search = new URLSearchParams({
      ra: row.ra,
      dec: row.dec,
      scale: "0.25",
      width: "420",
      height: "420",
    }).toString();
    await Promise.all([
      download(
        `https://skyserver.sdss.org/dr18/en/get/SpecById.ashx?id=${row.id}`,
        spectrumPath,
      ),
      download(cutout, stampPath),
    ]);
    if (cursor % 20 === 0) console.log(`${cursor}/160 galaxies cached`);
  }
});

await Promise.all(workers);
console.log("SDSS asset cache complete");
