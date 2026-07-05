/** ISO 3166-1 alpha-2 country code → flag emoji (regional indicator pair), or '' if invalid. */
export function countryFlag(countryCode: string | null): string {
  if (!countryCode || !/^[A-Za-z]{2}$/.test(countryCode)) return '';
  const base = 0x1f1e6 - 0x61; // regional indicator A minus 'a'
  const cc = countryCode.toLowerCase();
  return String.fromCodePoint(base + cc.charCodeAt(0), base + cc.charCodeAt(1));
}
