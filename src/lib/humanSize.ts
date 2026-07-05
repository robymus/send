const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = unit === 0 ? String(value) : value.toFixed(1).replace(/\.0$/, '');
  return `${rounded} ${UNITS[unit]}`;
}
