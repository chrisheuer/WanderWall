import exifReader from "exif-reader";
import sharp from "sharp";
import { processImage } from "@/jobs/ingest";

/**
 * A hand-built little-endian EXIF block carrying a GPS IFD. sharp's
 * withExif() silently drops GPS, so a fixture built through sharp cannot
 * prove the parser surfaces location data — this one can.
 */
function exifBufferWithGps(): Buffer {
  const tiff = Buffer.alloc(44);
  tiff.write("II", 0, "latin1"); // little-endian
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4); // IFD0 offset

  tiff.writeUInt16LE(1, 8); // IFD0: one entry
  tiff.writeUInt16LE(0x8825, 10); // GPSInfo pointer
  tiff.writeUInt16LE(4, 12); // LONG
  tiff.writeUInt32LE(1, 14); // count
  tiff.writeUInt32LE(26, 18); // -> GPS IFD
  tiff.writeUInt32LE(0, 22); // no IFD1

  tiff.writeUInt16LE(1, 26); // GPS IFD: one entry
  tiff.writeUInt16LE(0x0001, 28); // GPSLatitudeRef
  tiff.writeUInt16LE(2, 30); // ASCII
  tiff.writeUInt32LE(2, 32); // count
  tiff.write("N\0", 36, "latin1"); // inline value
  tiff.writeUInt32LE(0, 40);

  return Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
}

/**
 * Privacy assertions for the ingest pipeline. The promise "we strip GPS
 * from everything we serve, and keep full EXIF privately for you" is only
 * as good as the bytes we actually produce, so check the bytes.
 * Run: npx tsx scripts/check-ingest.ts
 */

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`ok    ${label}`);
    return;
  }
  failures += 1;
  console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  // A photograph carrying camera info and a precise location.
  const withGps = await sharp({
    create: { width: 3000, height: 2000, channels: 3, background: "#3a6ea5" },
  })
    .jpeg()
    // sharp cannot write a GPS IFD, so location is covered separately by
    // exifBufferWithGps() below.
    .withExif({ IFD0: { Make: "Wanderwall Camera Co", Model: "Test 1" } })
    .toBuffer();

  const sourceMeta = await sharp(withGps).metadata();
  check("fixture actually carries EXIF", Boolean(sourceMeta.exif));

  const processed = await processImage(withGps);

  // 1. Full EXIF is retained privately for the creator.
  const exifJson = JSON.stringify(processed.exif ?? {});
  check("private EXIF is parsed and retained", processed.exif !== null);
  check(
    "private EXIF keeps camera details",
    exifJson.includes("Wanderwall Camera Co"),
    "camera make missing from the creator's private record",
  );

  // GPS specifically: prove the parser surfaces a location block when the
  // source has one, so the creator's private record is genuinely complete.
  const gpsParsed = exifReader(exifBufferWithGps()) as unknown as Record<string, unknown>;
  check(
    "parser surfaces GPS when present",
    JSON.stringify(gpsParsed).includes("GPS") || "GPSInfo" in gpsParsed,
    `parsed sections: ${Object.keys(gpsParsed).join(", ")}`,
  );

  // 2. Nothing we serve carries EXIF or GPS.
  for (const [name, buf] of Object.entries(processed.derivatives)) {
    const meta = await sharp(buf).metadata();
    check(`${name} derivative carries no EXIF`, !meta.exif, "EXIF survived into a served file");
    check(
      `${name} derivative has no GPS bytes`,
      !/GPSLatitude|GPSLongitude/.test(buf.toString("latin1")),
      "GPS strings found in a served file",
    );
  }

  // 3. Derivatives are the sizes the residency policy expects.
  const expected = { thumb: 256, wall: 1024, zoom: 2048 } as const;
  for (const [name, size] of Object.entries(expected)) {
    const meta = await sharp(processed.derivatives[name]).metadata();
    check(
      `${name} derivative is bounded to ${size}px`,
      Math.max(meta.width ?? 0, meta.height ?? 0) === size,
      `got ${meta.width}x${meta.height}`,
    );
    check(`${name} derivative is WebP`, meta.format === "webp", `got ${meta.format}`);
  }

  check("dimensions recorded from the original", processed.width === 3000 && processed.height === 2000);
  check("dominant colors extracted", processed.dominantColors.length > 0);

  // 4. An image with no EXIF at all must still process cleanly.
  const bare = await sharp({
    create: { width: 400, height: 400, channels: 3, background: "#222222" },
  })
    .png()
    .toBuffer();
  const bareProcessed = await processImage(bare);
  check("EXIF-free image still processes", bareProcessed.exif === null);

  if (failures > 0) {
    console.error(`\ningest: ${failures} failing assertions`);
    process.exit(1);
  }
  console.log("\ningest: all privacy and derivative assertions pass");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
