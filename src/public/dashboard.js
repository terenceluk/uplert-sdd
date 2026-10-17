const authView = document.getElementById('auth-view');
const dashboardView = document.getElementById('dashboard-view');
const userBar = document.getElementById('user-bar');
const userLogin = document.getElementById('user-login');
const adminSection = document.getElementById('admin-section');

let currentUser = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin',
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { ok: response.ok, status: response.status, data };
}

function showDashboard(user) {
  currentUser = user;
  userLogin.textContent = user.login;
  userBar.classList.remove('hidden');
  authView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  adminSection.classList.toggle('hidden', user.role !== 'admin');
  refreshChecks();
  if (user.role === 'admin') refreshAdminRoster();
}

function showAuth() {
  currentUser = null;
  userBar.classList.add('hidden');
  authView.classList.remove('hidden');
  dashboardView.classList.add('hidden');
}

async function refreshChecks() {
  const { ok, data } = await api('/api/checks');
  if (!ok) {
    showAuth();
    return;
  }
  renderChecks(data);
}

function renderChecks(checks) {
  const body = document.getElementById('checks-body');
  body.innerHTML = '';
  for (const check of checks) {
    const row = document.createElement('tr');

    const statusClass = `status-${check.status}`;
    row.innerHTML = `
      <td>${escapeHtml(check.displayName)}</td>
      <td>${escapeHtml(check.url)}</td>
      <td class="${statusClass}">${check.status}</td>
      <td>${check.uptimePercent24h}%</td>
      <td>${check.recentResponseTimesMs.join(', ')}</td>
      <td>
        <input type="url" class="webhook-input" placeholder="https://..." value="${escapeHtml(check.webhookUrl || '')}" />
        <button data-id="${check.id}" class="webhook-save-btn">Save</button>
        <button data-id="${check.id}" class="webhook-clear-btn">Clear</button>
        <span class="error webhook-error" data-id="${check.id}"></span>
        ${renderWebhookDeliveryStatus(check)}
      </td>
      <td><button data-id="${check.id}" class="delete-btn">Delete</button></td>
    `;
    body.appendChild(row);
  }

  body.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/api/checks/${btn.dataset.id}`, { method: 'DELETE' });
      refreshChecks();
    });
  });

  body.querySelectorAll('.webhook-save-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('tr');
      const input = row.querySelector('.webhook-input');
      await setWebhookUrl(btn.dataset.id, input.value.trim() || null);
    });
  });

  body.querySelectorAll('.webhook-clear-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await setWebhookUrl(btn.dataset.id, null);
    });
  });
}

function renderWebhookDeliveryStatus(check) {
  if (!check.webhookUrl || !check.webhookLastDeliveryStatus) return '';
  const ok = check.webhookLastDeliveryStatus === 'succeeded';
  const label = ok ? '✓ delivered' : '✗ failed';
  const cssClass = ok ? 'status-up' : 'status-down';
  const when = new Date(check.webhookLastDeliveryAt).toLocaleString();
  return `<div class="${cssClass}">Webhook: ${label} ${escapeHtml(when)}</div>`;
}

async function setWebhookUrl(checkId, webhookUrl) {
  const { ok, data } = await api(`/api/checks/${checkId}`, {
    method: 'PATCH',
    body: JSON.stringify({ webhookUrl }),
  });
  const errorEl = document.querySelector(`.webhook-error[data-id="${checkId}"]`);
  if (!ok) {
    if (errorEl) errorEl.textContent = data?.error || 'Could not update webhook';
    return;
  }
  refreshChecks();
}

async function refreshAdminRoster() {
  const { ok, data } = await api('/api/admin/users');
  if (!ok) return;
  const body = document.getElementById('admin-body');
  body.innerHTML = '';
  for (const user of data) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${escapeHtml(user.login)}</td>
      <td>${user.role}</td>
      <td>${user.checkCount}</td>
    `;
    body.appendChild(row);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const { ok, data } = await api('/api/login', {
    method: 'POST',
    body: JSON.stringify({ login: form.get('login'), password: form.get('password') }),
  });
  const errorEl = document.getElementById('login-error');
  if (!ok) {
    errorEl.textContent = data?.error || 'Sign in failed';
    return;
  }
  errorEl.textContent = '';
  showDashboard(data);
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const { ok, data } = await api('/api/register', {
    method: 'POST',
    body: JSON.stringify({ login: form.get('login'), password: form.get('password') }),
  });
  const errorEl = document.getElementById('register-error');
  if (!ok) {
    errorEl.textContent = data?.error || 'Registration failed';
    return;
  }
  errorEl.textContent = '';
  // Registration does not sign the user in; prompt them to sign in next.
  e.target.reset();
  document.getElementById('login-error').textContent = 'Account created — sign in below.';
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  showAuth();
});

document.getElementById('add-check-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const { ok, data } = await api('/api/checks', {
    method: 'POST',
    body: JSON.stringify({
      url: form.get('url'),
      displayName: form.get('displayName'),
      intervalSeconds: Number(form.get('intervalSeconds')),
    }),
  });
  const errorEl = document.getElementById('add-check-error');
  if (!ok) {
    errorEl.textContent = data?.error || 'Could not add check';
    return;
  }
  errorEl.textContent = '';
  e.target.reset();
  e.target.intervalSeconds.value = 60;
  refreshChecks();
});

// On load, check whether we already have a valid session.
api('/api/checks').then(({ ok }) => {
  if (!ok) {
    showAuth();
  }
  // If a session exists, GET /api/checks succeeds but doesn't tell us the
  // user's own login/role — that's only returned by /api/login. Since this
  // app has no separate "whoami" endpoint, a page reload while signed in
  // will show the auth view again; signing back in restores the dashboard.
});
