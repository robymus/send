const PRIVATE_IP =
  /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i;

/**
 * Best-effort GeoIP: resolve an IP to an ISO country code via ipwho.is.
 * Returns null on private IPs, timeouts, or any error — the flag is decorative.
 */
export async function lookupCountry(
  ip: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> {
  if (!ip || PRIVATE_IP.test(ip)) return null;
  try {
    const res = await fetchFn(
      `https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country_code`,
      { signal: AbortSignal.timeout(1500) },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { success?: boolean; country_code?: string };
    if (!body.success || !body.country_code || !/^[A-Z]{2}$/.test(body.country_code)) return null;
    return body.country_code;
  } catch {
    return null;
  }
}
