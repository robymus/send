import { api, el, me } from './api.js';

function destination(session) {
  return session.isAdmin ? '/admin' : `/t/${session.tokenId}`;
}

// Already logged in? Go straight through.
const session = await me();
if (session) location.replace(destination(session));

el('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  el('msg').textContent = '';
  const token = el('token').value.trim();
  if (!token) return;
  try {
    const result = await api('/api/login', { method: 'POST', body: { token } });
    location.href = destination(result);
  } catch (err) {
    el('msg').textContent = err.message;
    const logo = el('logo');
    logo.classList.remove('shake');
    void logo.offsetWidth; // restart the animation
    logo.classList.add('shake');
  }
});
