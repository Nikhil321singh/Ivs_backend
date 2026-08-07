/* IVS admin portal. Vanilla JS, no build step — served from the API's own
   origin so relative /api/v1 calls need no CORS handling. */
(function () {
  'use strict';

  var API = '/api/v1/admin';
  var TOKEN_KEY = 'ivs_admin_token';
  var token = localStorage.getItem(TOKEN_KEY);

  var $ = function (id) { return document.getElementById(id); };

  function api(path, options) {
    var opts = options || {};
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;

    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      // Any 401 means the session is gone — drop the token and show login
      // rather than leaving a dead dashboard on screen.
      if (res.status === 401) {
        logout();
        throw new Error('Session expired. Please sign in again.');
      }
      return res.json().then(function (body) {
        if (!res.ok) throw new Error(body.message || 'Request failed');
        return body.data;
      });
    });
  }

  function show(view) {
    $('login-view').classList.toggle('hidden', view !== 'login');
    $('app-view').classList.toggle('hidden', view !== 'app');
  }

  function logout() {
    token = null;
    localStorage.removeItem(TOKEN_KEY);
    show('login');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleString(undefined, {
      day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  }

  function userLabel(user) {
    if (!user) return '—';
    var name = user.name || 'Unnamed';
    var mobile = (user.countryCode || '') + (user.mobile || '');
    return escapeHtml(name) + ' <span class="muted">' + escapeHtml(mobile) + '</span>';
  }

  /* ---------------------------------------------------------------- login */

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('login-error');
    err.classList.add('hidden');

    fetch(API + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('email').value, password: $('password').value }),
    })
      .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, body: b }; }); })
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
      });
  });

  $('logout').addEventListener('click', logout);

  /* ---------------------------------------------------------------- stats */

  function loadStats() {
    return api('/stats').then(function (s) {
      var cards = [
        ['Users', s.totalUsers],
        ['KYC completed', s.kycCompleted],
        ['IMEI checks', s.totalImeiChecks],
        ['Checks (24h)', s.imeiChecksToday],
        ['Tokens spent', s.tokensSpent],
      ];
      $('stats').innerHTML = cards
        .map(function (c) {
          return '<div class="stat"><div class="value">' + c[1] + '</div><div class="label">' + c[0] + '</div></div>';
        })
        .join('');
    });
  }

  /* ------------------------------------------------------------- settings */

  function loadSettings() {
    return api('/settings').then(function (data) {
      var defs = data.definitions;
      $('settings').innerHTML = Object.keys(defs)
        .map(function (key) {
          var def = defs[key];
          var on = data.settings[key] === true;
          return (
            '<div class="setting">' +
            '<div class="setting-text"><strong>' + escapeHtml(def.label) + '</strong>' +
            '<span class="muted">' + escapeHtml(def.description) + '</span></div>' +
            '<label class="switch"><input type="checkbox" data-key="' + key + '"' +
            (on ? ' checked' : '') + ' /><span></span></label>' +
            '</div>'
          );
        })
        .join('');

      Array.prototype.forEach.call($('settings').querySelectorAll('input[type=checkbox]'), function (input) {
        input.addEventListener('change', function () {
          var patch = {};
          patch[input.dataset.key] = input.checked;
          input.disabled = true;

          api('/settings', { method: 'PATCH', body: patch })
            .then(function () {
              var status = $('settings-status');
              status.textContent = 'Saved. Live across the API within a few seconds.';
              status.className = 'status ok';
              setTimeout(function () { status.classList.add('hidden'); }, 4000);
              status.classList.remove('hidden');
            })
            .catch(function (e) {
              // Roll the switch back so the UI never claims a state the
              // server rejected.
              input.checked = !input.checked;
              var status = $('settings-status');
              status.textContent = e.message;
              status.className = 'status error';
              status.classList.remove('hidden');
            })
            .then(function () { input.disabled = false; });
        });
      });
    });
  }

  /* --------------------------------------------------------------- tables */

  var txnPage = 1;
  var imeiPage = 1;

  function renderPager(el, pagination, onGo) {
    if (!pagination || pagination.pages <= 1) { el.innerHTML = ''; return; }
    el.innerHTML =
      '<button class="ghost" id="' + el.id + '-prev">Previous</button>' +
      '<span class="muted">Page ' + pagination.page + ' of ' + pagination.pages +
      ' · ' + pagination.total + ' rows</span>' +
      '<button class="ghost" id="' + el.id + '-next">Next</button>';

    var prev = $(el.id + '-prev');
    var next = $(el.id + '-next');
    prev.disabled = pagination.page <= 1;
    next.disabled = pagination.page >= pagination.pages;
    prev.addEventListener('click', function () { onGo(pagination.page - 1); });
    next.addEventListener('click', function () { onGo(pagination.page + 1); });
  }

  function loadTransactions(page) {
    txnPage = page || txnPage;
    var q = '?page=' + txnPage + '&limit=20';
    if ($('txn-type').value) q += '&type=' + $('txn-type').value;
    if ($('txn-reason').value) q += '&reason=' + $('txn-reason').value;

    return api('/transactions' + q).then(function (data) {
      var rows = data.items
        .map(function (t) {
          var isCredit = t.type === 'CREDIT';
          return (
            '<tr>' +
            '<td>' + fmtDate(t.createdAt) + '</td>' +
            '<td>' + userLabel(t.userId) + '</td>' +
            '<td><span class="pill ' + (isCredit ? 'ok' : 'warn') + '">' + t.type + '</span></td>' +
            '<td>' + escapeHtml(t.reason) + '</td>' +
            '<td>' + (isCredit ? '+' : '−') + t.amount + '</td>' +
            '<td>' + t.balanceAfter + '</td>' +
            '<td class="muted">' + escapeHtml(t.referenceId || '—') + '</td>' +
            '</tr>'
          );
        })
        .join('');

      $('txn-table').innerHTML = data.items.length
        ? '<thead><tr><th>When</th><th>User</th><th>Type</th><th>Reason</th><th>Amount</th><th>Balance</th><th>Reference</th></tr></thead><tbody>' + rows + '</tbody>'
        : '<tbody><tr><td class="empty">No transactions yet.</td></tr></tbody>';

      renderPager($('txn-pager'), data.pagination, loadTransactions);
    });
  }

  function statusPill(status) {
    if (!status) return '<span class="muted">—</span>';
    var cls = status === 'CLEAN' ? 'ok' : (status === 'UNKNOWN' || status === 'ERROR' ? 'warn' : 'bad');
    return '<span class="pill ' + cls + '">' + escapeHtml(status) + '</span>';
  }

  function loadImeiChecks(page) {
    imeiPage = page || imeiPage;
    var q = '?page=' + imeiPage + '&limit=20';
    if ($('imei-status').value) q += '&status=' + $('imei-status').value;

    return api('/imei-checks' + q).then(function (data) {
      var rows = data.items
        .map(function (c) {
          return (
            '<tr>' +
            '<td>' + fmtDate(c.createdAt) + '</td>' +
            '<td>' + userLabel(c.userId) + '</td>' +
            '<td>' + escapeHtml(c.imei1) + '</td>' +
            '<td>' + statusPill(c.imei1Status) + '</td>' +
            '<td>' + escapeHtml(c.imei2 || '—') + '</td>' +
            '<td>' + statusPill(c.imei2Status) + '</td>' +
            '<td>' + (c.allowTransaction ? '<span class="pill ok">Allowed</span>' : '<span class="pill bad">Blocked</span>') + '</td>' +
            '<td>' + escapeHtml(c.deviceModel || '—') + '</td>' +
            '</tr>'
          );
        })
        .join('');

      $('imei-table').innerHTML = data.items.length
        ? '<thead><tr><th>When</th><th>User</th><th>IMEI 1</th><th>Status</th><th>IMEI 2</th><th>Status</th><th>Outcome</th><th>Device</th></tr></thead><tbody>' + rows + '</tbody>'
        : '<tbody><tr><td class="empty">No IMEI checks yet.</td></tr></tbody>';

      renderPager($('imei-pager'), data.pagination, loadImeiChecks);
    });
  }

  ['txn-type', 'txn-reason'].forEach(function (id) {
    $(id).addEventListener('change', function () { loadTransactions(1); });
  });
  $('imei-status').addEventListener('change', function () { loadImeiChecks(1); });

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
    tab.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
        t.classList.toggle('active', t === tab);
      });
      $('tab-transactions').classList.toggle('hidden', tab.dataset.tab !== 'transactions');
      $('tab-imei').classList.toggle('hidden', tab.dataset.tab !== 'imei');
    });
  });

  /* ----------------------------------------------------------------- boot */

  function boot() {
    if (!token) { show('login'); return; }

    api('/me')
      .then(function (data) {
        $('admin-email').textContent = data.admin.email;
        show('app');
        return Promise.all([loadStats(), loadSettings(), loadTransactions(1), loadImeiChecks(1)]);
      })
      .catch(function () { /* api() already redirects to login on 401 */ });
  }

  boot();
})();
