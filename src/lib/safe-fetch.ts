import dns from "node:dns";
import net from "node:net";
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";

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
  const [a, b, c] = parts;
  return (
    a === 0 || // "this" network
    a === 10 || // private
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, incl. 169.254.169.254 metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // protocol assignments, TEST-NET-1
    (a === 198 && b >= 18 && b <= 19) || // benchmarking 198.18.0.0/15
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast + reserved + broadcast
  );
}

function isBlockedIPv6(address: string): boolean {
  const bytes = ipv6ToBytes(address.toLowerCase().replace(/^\[|\]$/g, ""));
  if (!bytes) return true; // unparseable: refuse

  // IPv4-mapped and IPv4-compatible addresses must be judged as IPv4.
  // WHATWG URL parsing rewrites ::ffff:169.254.169.254 into its hex form
  // (::ffff:a9fe:a9fe), so matching on the dotted-quad spelling alone
  // misses the very bypass this is here to stop.
  const mappedPrefix = bytes.slice(0, 10).every((b) => b === 0);
  if (mappedPrefix && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isBlockedIPv4(bytes.slice(12).join("."));
  }
  if (mappedPrefix && bytes[10] === 0 && bytes[11] === 0) {
    return true; // :: and ::1 and IPv4-compatible legacy forms
  }

  const [b0, b1] = bytes;
  return (
    b0 === 0xff || // multicast
    (b0 === 0xfe && (b1 & 0xc0) === 0x80) || // link-local fe80::/10
    (b0 & 0xfe) === 0xfc || // unique local fc00::/7
    b0 === 0x00 // reserved / unspecified space
  );
}

/** Expand an IPv6 literal (including "::" and embedded IPv4) to 16 bytes. */
function ipv6ToBytes(address: string): number[] | null {
  let text = address;

  // A trailing dotted-quad (::ffff:1.2.3.4) becomes two hex groups.
  const embedded = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (embedded) {
    const quad = embedded[1].split(".").map(Number);
    if (quad.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hi = ((quad[0] << 8) | quad[1]).toString(16);
    const lo = ((quad[2] << 8) | quad[3]).toString(16);
    text = `${text.slice(0, embedded.index)}${hi}:${lo}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) =>
    part === "" ? [] : part.split(":").map((g) => Number.parseInt(g, 16));

  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...tail].some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;

  const groups =
    halves.length === 2
      ? [...head, ...Array(8 - head.length - tail.length).fill(0), ...tail]
      : head;
  if (groups.length !== 8) return null;

  return groups.flatMap((g) => [(g >> 8) & 0xff, g & 0xff]);
}

/** Resolve a hostname to every address, refusing if any is blocked. */
export async function assertHostResolvesPublic(
  hostname: string,
  isBlocked: (address: string) => boolean = isBlockedAddress,
): Promise<void> {
  const bare = hostname.replace(/^\[|\]$/g, "");

  // IP literals (incl. the decimal/hex encodings a regex check misses:
  // Node normalizes 2130706433 and 0x7f000001 at connect time, so refuse
  // anything that is not a well-formed public IP or a resolvable name).
  if (net.isIP(bare)) {
    if (isBlocked(bare)) {
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
    if (isBlocked(address)) {
      throw new BlockedUrlError(`URL host ${hostname} resolves to a blocked address`);
    }
  }
}

export class BlockedUrlError extends Error {}

/** Surface a BlockedUrlError hidden in an error's cause chain. */
export function unwrapBlocked(err: unknown): unknown {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof BlockedUrlError) return current;
    current = (current as { cause?: unknown })?.cause;
  }
  return err;
}

/**
 * Dispatcher whose DNS lookup re-validates at connect time. This is what
 * closes the rebinding window: the address the socket actually connects to
 * is the address that gets checked.
 *
 * It must be paired with undici's own `fetch` below — Node's global fetch
 * uses its bundled copy of undici and silently ignores a dispatcher from
 * a separately installed one, which would leave this hook dead code.
 *
 * The hook only fires for hostnames — undici connects straight to an IP
 * literal without resolving, so those are covered by the pre-flight check
 * in assertHostResolvesPublic. Rebinding needs a hostname anyway.
 *
 * Note this dispatcher connects directly and ignores HTTP(S)_PROXY. That
 * is correct for Vercel, which has no egress proxy. If this is ever
 * deployed behind one, the proxy — not this process — would resolve the
 * target, so the address checks here would no longer bind and SSRF
 * filtering would have to move to the proxy.
 */
export function createGuardedAgent(isBlocked: (address: string) => boolean): Agent {
  return new Agent({
    connect: {
      lookup(hostname, options, callback) {
        dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
          if (err) {
            callback(err, "", 0);
            return;
          }
          const list = addresses as dns.LookupAddress[];
          const blocked = list.find((a) => isBlocked(a.address));
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
}

const guardedAgent = createGuardedAgent(isBlockedAddress);

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
  opts: {
    maxBytes: number;
    allowedContentType: RegExp;
    timeoutMs?: number;
    /**
     * Test-only seam. Substitutes the address policy so the transport can
     * be exercised end to end against a local server. Never pass this
     * from application code — the defaults are the security boundary.
     */
    unsafeTestOverrides?: {
      allowAddress: (address: string) => boolean;
      dispatcher: Agent;
    };
  },
): Promise<SafeFetchResult> {
  const addressAllowed = opts.unsafeTestOverrides
    ? (address: string) => !opts.unsafeTestOverrides!.allowAddress(address)
    : isBlockedAddress;
  const dispatcher = opts.unsafeTestOverrides?.dispatcher ?? guardedAgent;
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
    await assertHostResolvesPublic(current.hostname, addressAllowed);

    let res;
    try {
      res = await undiciFetch(current, {
        redirect: "manual", // every hop is re-validated by this loop
        signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
        headers: { "user-agent": "Wanderwall-Ingest/1.0 (+gallery image fetch)" },
        dispatcher: guardedAgent,
      });
    } catch (err) {
      // undici wraps a connect-time refusal as `TypeError: fetch failed`
      // with our error only in `.cause`. Unwrap it, or a blocked address
      // looks like a transient network fault to every caller.
      throw unwrapBlocked(err);
    }

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

async function readCapped(res: UndiciResponse, maxBytes: number): Promise<Buffer> {
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
