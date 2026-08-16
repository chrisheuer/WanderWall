import http from "node:http";
import {
  assertHostResolvesPublic,
  BlockedUrlError,
  createGuardedAgent,
  safeFetchImage,
} from "@/lib/safe-fetch";

/**
 * SSRF assertions against a live server standing in for an attacker's
 * host. The guard is only worth anything if it holds against the actual
 * bypasses — redirects into private space, obfuscated IP literals, and
 * oversized bodies — so exercise them rather than reasoning about them.
 * Run: npx tsx scripts/check-safe-fetch.ts
 */

const OPTS = {
  maxBytes: 1024 * 1024,
  allowedContentType: /^image\/(jpeg|png|webp|avif|gif|tiff)/i,
  timeoutMs: 5000,
};

let failures = 0;
function record(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`ok    ${label}`);
    return;
  }
  failures += 1;
  console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function expectBlocked(label: string, url: string) {
  try {
    await safeFetchImage(url, OPTS);
    record(label, false, "request was ALLOWED but should have been blocked");
  } catch (err) {
    record(label, err instanceof BlockedUrlError, `threw ${(err as Error).constructor.name}: ${(err as Error).message}`);
  }
}

async function main() {
  // A stand-in for an attacker-controlled public host.
  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/redirect-to-metadata")) {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
      return;
    }
    if (url.startsWith("/redirect-to-loopback")) {
      res.writeHead(302, { location: "http://127.0.0.1:1/" });
      res.end();
      return;
    }
    if (url.startsWith("/redirect-relative-loop")) {
      res.writeHead(302, { location: "/redirect-relative-loop" });
      res.end();
      return;
    }
    if (url.startsWith("/huge")) {
      // Lies about being small, then streams far more than the cap.
      res.writeHead(200, { "content-type": "image/png" });
      const chunk = Buffer.alloc(256 * 1024, 1);
      for (let i = 0; i < 20; i++) res.write(chunk);
      res.end();
      return;
    }
    if (url.startsWith("/html")) {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>not an image</html>");
      return;
    }
    res.writeHead(200, { "content-type": "image/png" });
    res.end(Buffer.alloc(64, 7));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;

  // 1. Direct private/loopback/metadata targets.
  await expectBlocked("blocks loopback by name", "http://localhost:80/x.png");
  await expectBlocked("blocks 127.0.0.1", "http://127.0.0.1/x.png");
  await expectBlocked("blocks cloud metadata IP", "http://169.254.169.254/latest/meta-data/");
  await expectBlocked("blocks private 10.x", "http://10.0.0.5/x.png");
  await expectBlocked("blocks private 192.168.x", "http://192.168.1.1/x.png");
  await expectBlocked("blocks private 172.16.x", "http://172.16.0.1/x.png");
  await expectBlocked("blocks CGNAT 100.64.x", "http://100.64.0.1/x.png");
  await expectBlocked("blocks 0.0.0.0", "http://0.0.0.0/x.png");
  await expectBlocked("blocks IPv6 loopback", "http://[::1]/x.png");
  await expectBlocked("blocks IPv6 link-local", "http://[fe80::1]/x.png");
  await expectBlocked("blocks IPv6 ULA", "http://[fd00::1]/x.png");
  await expectBlocked("blocks IPv4-mapped metadata", "http://[::ffff:169.254.169.254]/x.png");

  // 2. Obfuscated literals that a dotted-quad regex misses.
  await expectBlocked("blocks decimal-encoded 127.0.0.1", "http://2130706433/x.png");
  await expectBlocked("blocks hex-encoded 127.0.0.1", "http://0x7f000001/x.png");

  // 3. Non-http schemes.
  await expectBlocked("blocks file scheme", "file:///etc/passwd");
  await expectBlocked("blocks data scheme", "data:image/png;base64,iVBORw0KGgo=");

  // 4. Redirects — the bypass that a one-shot check misses entirely.
  await expectBlocked(
    "blocks redirect into cloud metadata",
    `http://127.0.0.1:${port}/redirect-to-metadata`,
  );
  await expectBlocked(
    "blocks redirect into loopback",
    `http://127.0.0.1:${port}/redirect-to-loopback`,
  );

  // 5. Content and size limits.
  await expectBlocked("rejects non-image content type", `http://127.0.0.1:${port}/html`);
  await expectBlocked("rejects oversized streaming body", `http://127.0.0.1:${port}/huge`);

  // 6. The guard must not block legitimate public addresses. Checked as a
  //    decision rather than a round trip so the assertion holds even where
  //    egress is restricted.
  for (const host of ["example.com", "8.8.8.8", "93.184.215.14"]) {
    let allowed = true;
    let reason = "";
    try {
      await assertHostResolvesPublic(host);
    } catch (err) {
      allowed = false;
      reason = (err as Error).message;
    }
    record(`allows public host ${host}`, allowed, reason);
  }

  // 7. The transport itself must work end to end. This is the assertion
  //    that would have caught the dispatcher being silently rejected —
  //    every other "allows" check tests policy, not plumbing, so the whole
  //    fetch path could be broken and they would all still pass. Loopback
  //    is permitted here only, via an explicit test seam.
  const permissive = { allowAddress: () => true };
  const testAgent = createGuardedAgent(() => false);
  try {
    const ok = await safeFetchImage(`http://127.0.0.1:${port}/pic.png`, {
      ...OPTS,
      unsafeTestOverrides: { ...permissive, dispatcher: testAgent },
    });
    record(
      "transport completes a real request",
      ok.body.byteLength === 64 && ok.contentType.startsWith("image/png"),
      `got ${ok.contentType} (${ok.body.byteLength} bytes)`,
    );
  } catch (err) {
    record("transport completes a real request", false, (err as Error).message);
  }

  // 8. A connect-time refusal must surface as BlockedUrlError, not as the
  //    TypeError undici wraps it in — otherwise the ingest job treats a
  //    blocked address as transient and retries until the artwork is
  //    permanently stuck with no reason shown.
  //    Uses a hostname, not an IP literal: undici only consults the lookup
  //    hook when it actually has to resolve something. IP literals never
  //    reach it and are covered by the pre-flight check instead.
  const rebindAgent = createGuardedAgent(() => true); // refuse at connect
  try {
    await safeFetchImage(`http://localhost:${port}/pic.png`, {
      ...OPTS,
      unsafeTestOverrides: { ...permissive, dispatcher: rebindAgent },
    });
    record("connect-time block surfaces as BlockedUrlError", false, "request was allowed");
  } catch (err) {
    record(
      "connect-time block surfaces as BlockedUrlError",
      err instanceof BlockedUrlError,
      `got ${(err as Error).constructor.name}: ${(err as Error).message}`,
    );
  }

  // A real public fetch too, when the environment permits outbound.
  try {
    const result = await safeFetchImage(
      "https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png",
      { ...OPTS, maxBytes: 8 * 1024 * 1024, timeoutMs: 15000 },
    );
    record(
      "allows a genuine public image",
      result.body.byteLength > 0 && /^image\//.test(result.contentType),
      `got ${result.contentType} (${result.body.byteLength} bytes)`,
    );
  } catch (err) {
    console.log(
      `skip  allows a genuine public image — no outbound access (${(err as Error).message})`,
    );
  }

  server.close();

  if (failures > 0) {
    console.error(`\nsafe-fetch: ${failures} failing assertions`);
    process.exit(1);
  }
  console.log("\nsafe-fetch: all SSRF assertions hold");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
