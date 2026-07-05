import { api, daysLeft, el, humanSize, logout, me } from './api.js';

const session = await me();
if (!session) location.replace('/');
else if (!session.isAdmin) location.replace(`/t/${session.tokenId}`);

el('logout').addEventListener('click', logout);

function expiryLabel(token) {
  if (!token.expiresAt) return '<span class="tag">never</span>';
  const days = daysLeft(token.expiresAt);
  return days === 0 ? '<span class="muted">today</span>' : `in ${days} d`;
}

async function loadTokens() {
  const tokens = await api('/api/tokens');
  const rows = el('token-rows');
  rows.innerHTML = '';
  el('tokens-empty').hidden = tokens.length > 0;
  for (const token of tokens) {
    const tr = document.createElement('tr');
    tr.className = 'clickable';
    tr.innerHTML = `
      <td>${escapeHtml(token.name)}${token.isAdmin ? ' <span class="tag">admin</span>' : ''}</td>
      <td class="mono">${token.isAdmin ? '••••••••' : escapeHtml(token.token)}</td>
      <td>${expiryLabel(token)}</td>
      <td class="num">${humanSize(token.usedBytes)} / ${humanSize(token.limitBytes)}</td>
      <td class="num">${token.fileCount}</td>`;
    tr.addEventListener('click', () => (location.href = `/t/${token.id}`));
    rows.append(tr);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

el('generate').addEventListener('click', async () => {
  const { token } = await api('/api/generate-token');
  el('new-token').value = token;
});

el('create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const msg = el('create-msg');
  msg.textContent = '';
  msg.className = 'msg';
  const body = {
    name: el('new-name').value.trim(),
    ttlDays: Number(el('new-ttl').value) || 7,
    limitBytes: Math.round(Number(el('new-limit').value) * 1024 * 1024) || 104857600,
  };
  const manual = el('new-token').value.trim();
  if (manual) body.token = manual;
  try {
    const created = await api('/api/tokens', { method: 'POST', body });
    location.href = `/t/${created.id}`;
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'msg error';
  }
});

await loadTokens();
