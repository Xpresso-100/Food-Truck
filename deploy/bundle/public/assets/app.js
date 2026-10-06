// Food Truck - shared front-end helpers: fetch wrapper, login, logout, nav.
// Identity always comes from the server session (GET /api/me); pages never trust local state.
// Data is rendered with textContent only, never innerHTML.
'use strict';

const App = (() => {
  /** JSON fetch. Resolves {status, json}; never throws for HTTP errors. */
  async function api(method, path, body) {
    const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(path, opts);
    } catch (e) {
      return { status: 0, json: { error: { code: 'network', message: 'No connection. Check your signal and try again.' } } };
    }
    let json = null;
    if (res.status !== 204) {
      try { json = await res.json(); } catch (e) { json = null; }
    }
    return { status: res.status, json };
  }

  function errorText(res, fallback) {
    return (res && res.json && res.json.error && res.json.error.message) || fallback || 'Something went wrong. Please try again.';
  }

  /** Home page for a role. */
  function homeFor(role) {
    return role === 'hq' ? '/hq.html' : '/stock.html';
  }

  /**
   * The logged-in user, or redirect to the login page. When `roles` is given and the
   * user's role is not in it, redirect to that user's home page instead.
   */
  async function requireUser(roles) {
    const res = await api('GET', '/api/me');
    if (res.status !== 200 || !res.json || !res.json.user) {
      window.location.replace('/');
      return null;
    }
    const user = res.json.user;
    if (roles && !roles.includes(user.role)) {
      window.location.replace(homeFor(user.role));
      return null;
    }
    const who = document.getElementById('who');
    if (who) who.textContent = user.location.name;
    return user;
  }

  async function logout() {
    await api('POST', '/api/logout');
    window.location.replace('/');
  }

  function bindLogout() {
    const btn = document.getElementById('logout');
    if (btn) btn.addEventListener('click', logout);
  }

  /** ZAR display: 585.1 -> "R585.10". */
  function money(n) {
    return 'R' + Number(n || 0).toFixed(2);
  }

  const STATUS_LABELS = {
    in_stock: 'In stock',
    low_stock: 'Low stock',
    out_of_stock: 'Out of stock',
    pending: 'Pending',
    in_process: 'In process',
    out_for_delivery: 'Out for delivery',
    delivered: 'Delivered',
  };

  function statusLabel(s) {
    return STATUS_LABELS[s] || s;
  }

  /** <span class="status" data-status="..">Label</span> */
  function statusBadge(s) {
    const span = el('span', 'status', statusLabel(s));
    span.dataset.status = s;
    return span;
  }

  function dateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Johannesburg' });
  }

  /** Small DOM builder: el('div', 'card', 'text'). */
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function setNotice(node, kind, text) {
    if (!node) return;
    node.className = 'notice ' + kind;
    node.textContent = text || '';
  }

  /** Login page (/). */
  async function initLogin() {
    const form = document.getElementById('login-form');
    if (!form) return;
    const error = document.getElementById('login-error');
    const submit = document.getElementById('login-submit');

    const me = await api('GET', '/api/me');
    if (me.status === 200 && me.json && me.json.user) {
      window.location.replace(homeFor(me.json.user.role));
      return;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setNotice(error, 'error', '');
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;
      if (!username || !password) {
        setNotice(error, 'error', 'Enter your username and password.');
        return;
      }
      submit.disabled = true;
      const res = await api('POST', '/api/login', { username, password });
      submit.disabled = false;
      if (res.status === 200 && res.json && res.json.user) {
        window.location.assign(homeFor(res.json.user.role));
        return;
      }
      setNotice(error, 'error', res.status === 401 ? 'Username or password is incorrect.' : errorText(res));
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindLogout();
    initLogin();
  });

  return { api, errorText, requireUser, money, statusLabel, statusBadge, dateTime, el, setNotice, homeFor };
})();
