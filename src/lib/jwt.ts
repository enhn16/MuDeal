const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(str)) return null;
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function importHmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

export async function signJwt<T extends Record<string, unknown>>(
  payload: T,
  secret: string,
  ttlSec: number,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = toBase64Url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = toBase64Url(
    encoder.encode(JSON.stringify({ ...payload, iat: nowSec, exp: nowSec + ttlSec })),
  );
  const signingInput = `${header}.${body}`;
  const key = await importHmacKey(secret, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput)));
  return `${signingInput}.${toBase64Url(sig)}`;
}

export async function verifyJwt<T extends Record<string, unknown>>(
  token: string,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<(T & { iat: number; exp: number }) | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, bodyB64, sigB64] = parts;

  const headerBytes = fromBase64Url(headerB64);
  const bodyBytes = fromBase64Url(bodyB64);
  const sigBytes = fromBase64Url(sigB64);
  if (!headerBytes || !bodyBytes || !sigBytes) return null;

  try {
    const header = JSON.parse(decoder.decode(headerBytes)) as { alg?: string; typ?: string };
    if (header.alg !== "HS256") return null;

    const key = await importHmacKey(secret, ["verify"]);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes as BufferSource,
      encoder.encode(`${headerB64}.${bodyB64}`),
    );
    if (!valid) return null;

    const payload = JSON.parse(decoder.decode(bodyBytes)) as T & { iat?: number; exp?: number };
    if (typeof payload.exp !== "number" || payload.exp <= nowSec) return null;
    return payload as T & { iat: number; exp: number };
  } catch {
    return null;
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomTokenHex(byteLen = 32): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
