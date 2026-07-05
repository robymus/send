import { api, countryFlag, daysLeft, el, formatTime, humanSize, logout, me } from './api.js';

const tokenId = location.pathname.split('/').pop();
const session = await me();
if (!session) location.replace('/');

el('logout').addEventListener('click', logout);

let token = null;

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderHeader() {
  if (session.isAdmin) {
    el('title').textContent = `${token.name}'s files`;
    const days = token.expiresAt ? `expires in ${daysLeft(token.expiresAt)} d` : 'never expires';
    el('subtitle').innerHTML =
      `token: <span class="mono">${escapeHtml(token.token)}</span> · ${days}`;
    el('back-link').hidden = false;
    el('admin-controls').hidden = false;
    el('limit-mb').value = Math.round(token.limitBytes / 1024 / 1024);
  } else {
    el('title').textContent = `Hello ${token.name} 🐿️`;
    const days = token.expiresAt
      ? ` · this token expires in ${daysLeft(token.expiresAt)} days`
      : '';
    el('subtitle').textContent = `Files shared with you${days}`;
  }
}

function renderFiles() {
  const rows = el('file-rows');
  rows.innerHTML = '';
  el('files-empty').hidden = token.files.length > 0;

  el('usage').textContent = `${humanSize(token.usedBytes)} of ${humanSize(token.limitBytes)} used`;
  const pct = Math.min(100, (token.usedBytes / token.limitBytes) * 100);
  const bar = el('usage-bar');
  bar.style.width = `${pct}%`;
  bar.className = pct >= 85 ? 'warn' : '';

  for (const file of token.files) {
    const canDelete = session.isAdmin || !file.uploadedByAdmin;
    const flag = countryFlag(file.countryCode);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <a href="/api/tokens/${tokenId}/files/${file.id}/download">${escapeHtml(file.name)}</a>
      </td>
      <td class="num">${humanSize(file.sizeBytes)}</td>
      <td class="file-uploader-col">
        ${escapeHtml(file.uploaderName)} ${flag}
        <div class="muted">${formatTime(file.uploadedAt)}</div>
      </td>
      <td class="num"></td>`;
    if (canDelete) {
      const btn = document.createElement('button');
      btn.className = 'danger';
      btn.textContent = 'Delete';
      btn.addEventListener('click', async () => {
        if (!confirm(`Delete "${file.name}"?`)) return;
        await api(`/api/tokens/${tokenId}/files/${file.id}`, { method: 'DELETE' });
        await refresh();
      });
      tr.lastElementChild.append(btn);
    }
    rows.append(tr);
  }
}

async function refresh() {
  try {
    token = await api(`/api/tokens/${tokenId}`);
  } catch (err) {
    // not logged in, foreign token, or deleted token — bounce to login
    location.replace('/');
    throw err;
  }
  renderHeader();
  renderFiles();
}

/* ---------- admin settings ---------- */

el('ttl-save').addEventListener('click', () =>
  saveSettings({ ttlDays: Number(el('ttl-days').value) }),
);
el('limit-save').addEventListener('click', () =>
  saveSettings({ limitBytes: Math.round(Number(el('limit-mb').value) * 1024 * 1024) }),
);

async function saveSettings(patch) {
  const msg = el('settings-msg');
  msg.className = 'msg';
  msg.textContent = '';
  try {
    await api(`/api/tokens/${tokenId}`, { method: 'PATCH', body: patch });
    msg.className = 'msg ok';
    msg.textContent = 'Saved.';
    await refresh();
  } catch (err) {
    msg.className = 'msg error';
    msg.textContent = err.message;
  }
}

/* ---------- upload ---------- */

const dropzone = el('dropzone');
const fileInput = el('file-input');

el('pick').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) upload(fileInput.files[0]);
});

for (const eventName of ['dragenter', 'dragover']) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add('drag');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove('drag');
  });
}
dropzone.addEventListener('drop', (event) => {
  if (event.dataTransfer.files.length) upload(event.dataTransfer.files[0]);
});

function upload(file) {
  const msg = el('upload-msg');
  msg.className = 'msg';
  msg.textContent = '';
  el('progress').classList.add('active');
  el('progress-bar').style.width = '0%';

  const form = new FormData();
  form.append('file', file);

  // XHR instead of fetch: we want upload progress events.
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `/api/tokens/${tokenId}/files`);
  xhr.upload.addEventListener('progress', (event) => {
    if (event.lengthComputable) {
      el('progress-bar').style.width = `${(event.loaded / event.total) * 100}%`;
    }
  });
  xhr.addEventListener('load', async () => {
    el('progress').classList.remove('active');
    fileInput.value = '';
    if (xhr.status === 201) {
      msg.className = 'msg ok';
      msg.textContent = `Uploaded ${file.name}.`;
      await refresh();
    } else {
      let error = `Upload failed (${xhr.status})`;
      try {
        error = JSON.parse(xhr.responseText).error || error;
      } catch {
        /* keep default */
      }
      msg.className = 'msg error';
      msg.textContent = error;
    }
  });
  xhr.addEventListener('error', () => {
    el('progress').classList.remove('active');
    msg.className = 'msg error';
    msg.textContent = 'Upload failed — network error.';
  });
  xhr.send(form);
}

await refresh();
