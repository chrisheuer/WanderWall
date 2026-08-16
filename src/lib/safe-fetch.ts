import dns from "node:dns";
import net from "node:net";
import { Agent, type Dispatcher } from "undici";

/**
 * SSRF-hardened fetch for creator-supplied URLs.
 *
 * Three layers, because any one of them alone is bypassable:
 *  1. Every hop's hostname is resolved and every resolved address checked
 *     against the blocked ranges (a public hostname with a private A record
 *     is the classic bypass of a string-only check).
 *  2. Redirects are followed manually so each hop is re-validated — a
 *     `redirect: "follow"` fetch validates only the URL you passed in.
 *  3. The dispatcher's own DNS lookup re-checks at socket-connect time, so
 *     a record that flips between validation and connection (DNS
 *     rebinding) still cannot reach a private address.
 */

const MAX_REDIRECTS = 5;

/** Blocked because they reach the host, the LAN, or cloud metadata. */
function isBlockedAddress(address: string): boolean {
  const type = net.isIP(address);
  if (type === 4) return isBlockedIPv4(address);
  if (type === 6) return isBlockedIPv6(address);
  return true; // unparseable: refuse
}

function isBlockedIPv4(address: string): boolean {
  const parts = address.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 || // "this" network
    a === 10 || // private
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, incl. 169.254.169.254 metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 192 && b === 0) || // IETF protocol assignments
    a === 198 || // benchmarking / test nets
    (a >= 224) // multicast + reserved + broadcast
  );
}

function isBlockedIPv6(address: string): boolean {
  const lower = address.toLowerCase().replace(/^\[|\]$/g, "");
  // IPv4-mapped (::ffff:169.254.169.254) must be judged as its IPv4 form.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isBlockedIPv4(mapped[1]);
  return (
    lower === "::" ||
    lower === "::1" || // loopback
    lower.startsWith("fe80") || // link-local
    lower.startsWith("fc") || // unique local
    lower.startsWith("fd") || // unique local
    lower.startsWith("ff") // multicast
  );
}

/** Resolve a hostname to every address, refusing if any is blocked. */
async function assertHostResolvesPublic(hostname: string): Promise<void> {
  const bare = hostname.replace(/^\[|\]$/g, "");

  // IP literals (incl. the decimal/hex encodings a regex check misses:
  // Node normalizes 2130706433 and 0x7f000001 at connect time, so refuse
  // anything that is not a well-formed public IP or a resolvable name).
  if (net.isIP(bare)) {
    if (isBlockedAddress(bare)) {
      throw new BlockedUrlError(`URL host ${hostname} is not allowed`);
    }
    return;
  }
  if (/^\d+$/.test(bare) || /^0x[0-9a-f]+$/i.test(bare)) {
    // Bare integer / hex hosts are only ever obfuscated IPv4 literals.
    throw new BlockedUrlError(`URL host ${hostname} is not allowed`);
  }

  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(bare, { all: true, verbatim: true });
  } catch {
    throw new BlockedUrlError(`could not resolve ${hostname}`);
  }
  if (addresses.length === 0) {
    throw new BlockedUrlError(`could not resolve ${hostname}`);
  }
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new BlockedUrlError(`URL host ${hostname} resolves to a blocked address`);
    }
  }
}

export class BlockedUrlError extends Error {}

/**
 * Dispatcher whose DNS lookup re-validates at connect time. This is what
 * closes the rebinding window: the address the socket actually connects to
 * is the address that gets checked.
 */
const guardedAgent = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
        if (err) {
          callback(err, "", 0);
          return;
        }
        const list = addresses as dns.LookupAddress[];
        const blocked = list.find((a) => isBlockedAddress(a.address));
        if (blocked) {
          callback(new BlockedUrlError(`blocked address ${blocked.address}`), "", 0);
          return;
        }
        // undici's lookup accepts the all:true array form.
        callback(null, list as never);
      });
    },
  },
});

export interface SafeFetchResult {
  body: Buffer;
  contentType: string;
  finalUrl: string;
}

/**
 * Fetch a creator-supplied URL with SSRF protection and a hard byte cap.
 * The cap is enforced while streaming, so an attacker cannot exhaust
 * memory with a lying (or absent) Content-Length.
 */
export async function safeFetchImage(
  rawUrl: string,
  opts: { maxBytes: number; allowedContentType: RegExp; timeoutMs?: number },
): Promise<SafeFetchResult> {
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError("not a valid URL");
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== "https:" && current.protocol !== "http:") {
      throw new BlockedUrlError("only http(s) URLs are supported");
    }
    await assertHostResolvesPublic(current.hostname);

    const res = await fetch(current, {
      redirect: "manual", // every hop is re-validated by this loop
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
      headers: { "user-agent": "Wanderwall-Ingest/1.0 (+gallery image fetch)" },
      dispatcher: guardedAgent,
    } as RequestInit & { dispatcher: Dispatcher });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new BlockedUrlError("redirect without a location");
      await res.body?.cancel().catch(() => {});
      current = new URL(location, current); // relative redirects are legal
      continue;
    }

    if (!res.ok) throw new BlockedUrlError(`fetch failed: HTTP ${res.status}`);

    const contentType = res.headers.get("content-type") ?? "";
    if (!opts.allowedContentType.test(contentType)) {
      await res.body?.cancel().catch(() => {});
      throw new BlockedUrlError(`not an image (content-type: ${contentType || "unknown"})`);
    }

    const body = await readCapped(res, opts.maxBytes);
    return { body, contentType, finalUrl: current.toString() };
  }

  throw new BlockedUrlError("too many redirects");
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new BlockedUrlError("image exceeds the size limit");
  }
  if (!res.body) throw new BlockedUrlError("empty response");

  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BlockedUrlError("image exceeds the size limit");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}
