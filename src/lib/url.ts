/** BP-DEAL-003-1: only https:// (or http:// when explicitly allowed by admin) with no whitespace/control chars. */
export function parseSafeExternalUrl(raw: string, opts?: { allowHttp?: boolean }): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /[\s\u0000-\u001F\u007F]/.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    const allowed = opts?.allowHttp ? ["https:", "http:"] : ["https:"];
    if (!allowed.includes(parsed.protocol) || !parsed.hostname) return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Returns true if hostname targets localhost, link-local, metadata, or private/reserved IP space. */
export function isPrivateOrInternalHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (!host || host.includes("..") || host.startsWith(".")) return true;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  ) {
    return true;
  }

  // Block all IPv6 literals
  if (host.includes(":")) return true;

  // Reject bare integer / hex / octal IPv4 obfuscation (e.g., 2130706433, 0x7f000001)
  if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) return true;

  // Reject shorthand / non-standard numeric or hex dotted IPv4 notations (e.g., 127.1, 0x7f.0.0.1, 0177.0.0.1)
  const labels = host.split(".");
  if (labels.every((label) => /^(0x[0-9a-f]+|\d+)$/i.test(label))) {
    if (labels.length !== 4) return true;
    const parts = labels.map((p) =>
      /^0x/i.test(p) || (p.length > 1 && p.startsWith("0")) ? -1 : Number(p),
    );
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b, c] = parts;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 168) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    ) {
      return true;
    }
    return false;
  }

  // Public web hostnames must have a dot (reject bare internal hostnames like "db", "redis")
  if (!host.includes(".")) return true;
  return false;
}

/** Strict HTTPS URL validator for server-side outbound fetches (SSRF defense). */
export function parseSafeServerFetchUrl(raw: string): string | null {
  const safe = parseSafeExternalUrl(raw, { allowHttp: false });
  if (!safe) return null;
  const parsed = new URL(safe);
  if (parsed.port !== "" && parsed.port !== "443") return null;
  if (isPrivateOrInternalHost(parsed.hostname)) return null;
  return safe;
}

/** Normalizes protocol-relative (`//`), case-insensitive `HTTP://`, and optional relative paths into a safe HTTPS URL. */
export function normalizeExternalHttpsUrl(raw: string | null | undefined, defaultOrigin?: string): string | null {
  if (!raw) return null;
  let value = raw.trim().replace(/\s+/g, "%20");
  if (!value || value.startsWith("///") || value.includes("\\")) return null;
  if (value.startsWith("//")) {
    value = `https:${value}`;
  } else if (/^http:\/\//i.test(value)) {
    value = `https://${value.slice(7)}`;
  } else if (value.startsWith("/") && defaultOrigin) {
    try {
      const base = new URL(defaultOrigin);
      const resolved = new URL(value, base);
      if (resolved.origin !== base.origin) return null;
      value = resolved.toString();
    } catch {
      return null;
    }
  }
  return parseSafeExternalUrl(value, { allowHttp: false });
}

export function serializeSearchParams(
  params: Record<string, string | number | boolean | string[] | null | undefined>,
): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "" || value === false) continue;
    if (Array.isArray(value)) {
      const cleaned = value.map((v) => v.trim()).filter(Boolean);
      if (cleaned.length > 0) qs.set(key, cleaned.join(","));
      continue;
    }
    qs.set(key, String(value));
  }
  return qs.toString();
}
