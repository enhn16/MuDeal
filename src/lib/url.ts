/** BP-DEAL-003-1: only https:// (or http:// when explicitly allowed by admin) with no whitespace/control chars. */
export function parseSafeExternalUrl(raw: string, opts?: { allowHttp?: boolean }): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /[\s\u0000-\u001F\u007F]/.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    const allowed = opts?.allowHttp ? ["https:", "http:"] : ["https:"];
    if (!allowed.includes(parsed.protocol) || !parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
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
