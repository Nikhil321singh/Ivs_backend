/* ==========================================================================
   IVS Admin Console
   Vanilla JS, no build step — served from the API's own origin, so /api/v1
   calls are same-origin and helmet's script-src 'self' allows this file.
   ========================================================================== */
(function () {
  'use strict';

  var API = '/api/v1/admin';
  var TOKEN_KEY = 'ivs_admin_token';
  var token = localStorage.getItem(TOKEN_KEY);
  var state = { page: 'dashboard', txnPage: 1, imeiPage: 1 };

  var $ = function (id) { return document.getElementById(id); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  /* ----------------------------------------------------------- utilities */

  // Every value interpolated into innerHTML goes through this. Device models
  // and admin-supplied strings are untrusted.
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    var date = d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
    var time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return '<span>' + esc(date) + '<span class="sub">' + esc(time) + '</span></span>';
  }

  function fmtNumber(n) {
    return typeof n === 'number' ? n.toLocaleString() : '—';
  }

  function toast(message, isError) {
    var el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = message;
    $('toasts').appendChild(el);
    setTimeout(function () { el.remove(); }, 4200);
  }

  function skeleton(host, rows) {
    var bars = '';
    for (var i = 0; i < (rows || 4); i++) bars += '<i style="width:' + (94 - i * 11) + '%"></i>';
    host.innerHTML = '<div class="skeleton">' + bars + '</div>';
  }

  function emptyRow(cols, title, hint) {
    return '<tbody><tr><td colspan="' + cols + '" class="empty"><strong>' +
      esc(title) + '</strong>' + esc(hint || '') + '</td></tr></tbody>';
  }

  function userCell(user) {
    if (!user) return '<span class="sub">Unknown user</span>';
    var mobile = (user.countryCode || '') + (user.mobile || '');
    return '<span>' + esc(user.name || 'Unnamed') +
      '<span class="sub mono">' + esc(mobile) + '</span></span>';
  }

  function statusPill(status) {
    if (!status) return '<span class="pill neutral">—</span>';
    var cls = status === 'CLEAN' ? 'ok'
      : (status === 'UNKNOWN' || status === 'ERROR') ? 'warn' : 'bad';
    return '<span class="pill ' + cls + '">' + esc(status) + '</span>';
  }

  /* ---------------------------------------------------------------- http */

  function api(path, options) {
    var opts = options || {};
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;

    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      // A 401 means the session is gone. Drop the token and show login rather
      // than leaving a dashboard on screen that can no longer load anything.
      if (res.status === 401) {
        signOut();
        throw new Error('Session expired. Please sign in again.');
      }
      return res.json().then(function (body) {
        if (!res.ok) throw new Error(body.message || 'Request failed');
        return body.data;
      });
    });
  }

  /* --------------------------------------------------------------- login */

  function showLogin() {
    $('login-view').classList.remove('hidden');
    $('app-view').classList.add('hidden');
  }

  function showApp() {
    $('login-view').classList.add('hidden');
    $('app-view').classList.remove('hidden');
  }

  function signOut() {
    token = null;
    localStorage.removeItem(TOKEN_KEY);
    showLogin();
  }

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('login-error');
    var btn = $('login-submit');
    err.classList.add('hidden');
    btn.disabled = true;
    btn.querySelector('.btn-label').textContent = 'Signing in…';

    fetch(API + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('email').value, password: $('password').value }),
    })
      .then(function (res) {
        return res.json().then(function (b) { return { ok: res.ok, body: b }; });
      })
      .then(function (r) {
        if (!r.ok) throw new Error(r.body.message || 'Sign in failed');
        token = r.body.data.token;
        localStorage.setItem(TOKEN_KEY, token);
        $('password').value = '';
        boot();
      })
      .catch(function (e2) {
        err.textContent = e2.message;
        err.classList.remove('hidden');
      })
      .then(function () {
        btn.disabled = false;
        btn.querySelector('.btn-label').textContent = 'Sign in';
      });
  });

  $('logout').addEventListener('click', signOut);

  /* ---------------------------------------------------------- navigation */

  var PAGES = {
    dashboard: { title: 'Dashboard', sub: 'Live activity across the platform' },
    settings: { title: 'Settings', sub: 'Runtime feature controls' },
    transactions: { title: 'Transactions', sub: 'Every wallet credit and debit' },
    imei: { title: 'IMEI checks', sub: 'CEIR verification audit log' },
  };

  function goto(page) {
    state.page = page;
    $$('.nav-item').forEach(function (b) { b.classList.toggle('active', b.dataset.page === page); });
    $$('.page').forEach(function (s) { s.classList.add('hidden'); });
    $('page-' + page).classList.remove('hidden');
    $('page-title').textContent = PAGES[page].title;
    $('page-subtitle').textContent = PAGES[page].sub;
    $('app-view').classList.remove('nav-open');
    load(page);
  }

  $$('.nav-item').forEach(function (btn) {
    btn.addEventListener('click', function () { goto(btn.dataset.page); });
  });
  $$('[data-goto]').forEach(function (btn) {
    btn.addEventListener('click', function () { goto(btn.dataset.goto); });
  });

  $('menu-btn').addEventListener('click', function () { $('app-view').classList.add('nav-open'); });
  $('sidebar-close').addEventListener('click', function () { $('app-view').classList.remove('nav-open'); });
  $('sidebar-scrim').addEventListener('click', function () { $('app-view').classList.remove('nav-open'); });
  $('refresh').addEventListener('click', function () { load(state.page); });

  /* ----------------------------------------------------------- dashboard */

  function loadDashboard() {
    var host = $('stats');
    if (!host.children.length) skeleton(host, 3);

    return Promise.all([api('/stats'), api('/imei-checks?page=1&limit=5')])
      .then(function (results) {
        var s = results[0];
        var cards = [
          { label: 'Total users', value: s.totalUsers, foot: s.kycCompleted + ' completed KYC' },
          { label: 'IMEI checks', value: s.totalImeiChecks, foot: s.imeiChecksToday + ' in last 24h' },
          { label: 'Tokens spent', value: s.tokensSpent, foot: 'across all features' },
        ];
        host.innerHTML = cards.map(function (c) {
          return '<div class="stat"><div class="stat-label">' + esc(c.label) + '</div>' +
            '<div class="stat-value">' + fmtNumber(c.value) + '</div>' +
            '<div class="stat-foot">' + esc(c.foot) + '</div></div>';
        }).join('');

        var items = results[1].items;
        $('recent-table').innerHTML = items.length
          ? '<thead><tr><th>When</th><th>User</th><th>IMEI</th><th>Status</th><th>Outcome</th></tr></thead><tbody>' +
            items.map(function (c) {
              return '<tr><td>' + fmtDate(c.createdAt) + '</td>' +
                '<td>' + userCell(c.userId) + '</td>' +
                '<td class="mono">' + esc(c.imei1) + '</td>' +
                '<td>' + statusPill(c.imei1Status) + '</td>' +
                '<td>' + (c.allowTransaction
                  ? '<span class="pill ok">Allowed</span>'
                  : '<span class="pill bad">Blocked</span>') + '</td></tr>';
            }).join('') + '</tbody>'
          : emptyRow(5, 'No IMEI checks yet', 'They will appear here as users verify devices.');
      });
  }

  /* ------------------------------------------------------------ settings */

  function loadSettings() {
    var host = $('settings');
    if (!host.children.length) skeleton(host, 3);

    return api('/settings').then(function (data) {
      var defs = data.definitions;

      host.innerHTML = Object.keys(defs).map(function (key) {
        var def = defs[key];
        var on = data.settings[key] === true;
        return '<div class="setting">' +
          '<div class="setting-text">' +
            '<strong>' + esc(def.label) + '</strong>' +
            '<p>' + esc(def.description) + '</p>' +
            '<span class="setting-state ' + (on ? 'on' : 'off') + '" data-state-for="' + esc(key) + '">' +
              (on ? 'ENABLED' : 'DISABLED') + '</span>' +
          '</div>' +
          '<label class="switch">' +
            '<input type="checkbox" data-key="' + esc(key) + '"' + (on ? ' checked' : '') + ' />' +
            '<span class="track"></span>' +
          '</label>' +
        '</div>';
      }).join('');

      host.querySelectorAll('input[type=checkbox]').forEach(function (input) {
        input.addEventListener('change', function () {
          var key = input.dataset.key;
          var patch = {};
          patch[key] = input.checked;
          input.disabled = true;

          api('/settings', { method: 'PATCH', body: patch })
            .then(function (res) {
              var on = res.settings[key] === true;
              var badge = host.querySelector('[data-state-for="' + key + '"]');
              badge.className = 'setting-state ' + (on ? 'on' : 'off');
              badge.textContent = on ? 'ENABLED' : 'DISABLED';
              toast(esc(defs[key].label) + ' ' + (on ? 'enabled' : 'disabled') + '. Live within ~15s.');
            })
            .catch(function (e) {
              // Put the switch back — never show a state the server rejected.
              input.checked = !input.checked;
              toast(e.message, true);
            })
            .then(function () { input.disabled = false; });
        });
      });
    });
  }

  /* -------------------------------------------------------------- tables */

  function renderPager(el, pagination, onGo) {
    if (!pagination || pagination.pages <= 1) { el.innerHTML = ''; return; }

    el.innerHTML =
      '<span class="pager-info">Page ' + pagination.page + ' of ' + pagination.pages +
      ' · ' + fmtNumber(pagination.total) + ' rows</span>' +
      '<button class="btn btn-ghost" data-dir="prev">Previous</button>' +
      '<button class="btn btn-ghost" data-dir="next">Next</button>';

    var prev = el.querySelector('[data-dir=prev]');
    var next = el.querySelector('[data-dir=next]');
    prev.disabled = pagination.page <= 1;
    next.disabled = pagination.page >= pagination.pages;
    prev.addEventListener('click', function () { onGo(pagination.page - 1); });
    next.addEventListener('click', function () { onGo(pagination.page + 1); });
  }

  function loadTransactions(page) {
    state.txnPage = page || state.txnPage;
    var q = '?page=' + state.txnPage + '&limit=20';
    if ($('txn-type').value) q += '&type=' + $('txn-type').value;
    if ($('txn-reason').value) q += '&reason=' + $('txn-reason').value;

    return api('/transactions' + q).then(function (data) {
      $('txn-table').innerHTML = data.items.length
        ? '<thead><tr><th>When</th><th>User</th><th>Type</th><th>Reason</th>' +
          '<th>Amount</th><th>Balance after</th><th>Reference</th></tr></thead><tbody>' +
          data.items.map(function (t) {
            var credit = t.type === 'CREDIT';
            return '<tr><td>' + fmtDate(t.createdAt) + '</td>' +
              '<td>' + userCell(t.userId) + '</td>' +
              '<td><span class="pill ' + (credit ? 'ok' : 'warn') + '">' + esc(t.type) + '</span></td>' +
              '<td>' + esc(String(t.reason || '').replace(/_/g, ' ').toLowerCase()) + '</td>' +
              '<td class="num ' + (credit ? 'pos' : 'neg') + '">' +
                (credit ? '+' : '−') + fmtNumber(t.amount) + '</td>' +
              '<td class="num">' + fmtNumber(t.balanceAfter) + '</td>' +
              '<td class="mono sub">' + esc(t.referenceId || '—') + '</td></tr>';
          }).join('') + '</tbody>'
        : emptyRow(7, 'No transactions found', 'Try clearing the filters above.');

      renderPager($('txn-pager'), data.pagination, loadTransactions);
    });
  }

  function loadImeiChecks(page) {
    state.imeiPage = page || state.imeiPage;
    var q = '?page=' + state.imeiPage + '&limit=20';
    if ($('imei-status').value) q += '&status=' + $('imei-status').value;

    return api('/imei-checks' + q).then(function (data) {
      $('imei-table').innerHTML = data.items.length
        ? '<thead><tr><th>When</th><th>User</th><th>IMEI 1</th><th>Status</th>' +
          '<th>IMEI 2</th><th>Status</th><th>Outcome</th><th>Device</th></tr></thead><tbody>' +
          data.items.map(function (c) {
            return '<tr><td>' + fmtDate(c.createdAt) + '</td>' +
              '<td>' + userCell(c.userId) + '</td>' +
              '<td class="mono">' + esc(c.imei1) + '</td>' +
              '<td>' + statusPill(c.imei1Status) + '</td>' +
              '<td class="mono">' + esc(c.imei2 || '—') + '</td>' +
              '<td>' + statusPill(c.imei2Status) + '</td>' +
              '<td>' + (c.allowTransaction
                ? '<span class="pill ok">Allowed</span>'
                : '<span class="pill bad">Blocked</span>') + '</td>' +
              '<td>' + esc(c.deviceModel || '—') + '</td></tr>';
          }).join('') + '</tbody>'
        : emptyRow(8, 'No IMEI checks found', 'Try clearing the filter above.');

      renderPager($('imei-pager'), data.pagination, loadImeiChecks);
    });
  }

  ['txn-type', 'txn-reason'].forEach(function (id) {
    $(id).addEventListener('change', function () { loadTransactions(1); });
  });
  $('imei-status').addEventListener('change', function () { loadImeiChecks(1); });

  /* ----------------------------------------------------------------- run */

  function load(page) {
    var task = page === 'dashboard' ? loadDashboard()
      : page === 'settings' ? loadSettings()
      : page === 'transactions' ? loadTransactions()
      : loadImeiChecks();

    return task.catch(function (e) { toast(e.message, true); });
  }

  function boot() {
    if (!token) { showLogin(); return; }

    api('/me')
      .then(function (data) {
        var admin = data.admin;
        $('admin-name').textContent = admin.name || 'Administrator';
        $('admin-email').textContent = admin.email;
        $('avatar').textContent = (admin.name || admin.email || 'A').charAt(0).toUpperCase();
        showApp();
        goto(state.page);
      })
      .catch(function () { /* api() already routed a 401 back to login */ });
  }

  boot();
})();
