/** Fetch wrapper: JSON in/out, throws Error with the server's message on failure. */
export async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body ? { 'content-type': 'application/json' } : {},
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Current session, or null when not logged in. */
export async function me() {
  try {
    return await api('/api/me');
  } catch {
    return null;
  }
}

export async function logout() {
  await api('/api/logout', { method: 'POST' });
  location.href = '/';
}

export function humanSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = unit === 0 ? String(value) : value.toFixed(1).replace(/\.0$/, '');
  return `${rounded} ${units[unit]}`;
}

export function countryFlag(cc) {
  if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return '';
  const base = 0x1f1e6 - 0x61;
  const lower = cc.toLowerCase();
  return String.fromCodePoint(base + lower.charCodeAt(0), base + lower.charCodeAt(1));
}

export function formatTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function daysLeft(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 86400000));
}

export function el(id) {
  return document.getElementById(id);
}
