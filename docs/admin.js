(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};
  var DEMO = !CFG.API_URL;
  var $ = function (s) { return document.querySelector(s); };
  var esc = CORE.escapeHtml;
  var DAYS = [[1, 'пн'], [2, 'вт'], [3, 'ср'], [4, 'чт'], [5, 'пт'], [6, 'сб'], [7, 'нд']];
  var ERR = {
    BAD_PASSWORD: 'Невірний пароль.', LOCKED: 'Забагато невдалих спроб. Спробуйте за 15 хвилин.', NO_PASSWORD: 'Пароль ще не створено: запустіть setup() у скрипті.',
    AUTH: 'Сесія закінчилась. Увійдіть знову.', BUSY: 'Сервер зайнятий, спробуйте ще раз.', NET: 'Немає зв’язку з сервером.', TIMEOUT: 'Сервер відповідає надто довго.',
    SERVER: 'Щось пішло не так.', BAD_IMAGE: 'Не вдалося прийняти це фото. Спробуйте інше.', NOT_FOUND: 'Не знайдено (можливо, вже змінено).', VALIDATION: 'Перевірте виділені поля.'
  };
  var TOKEN_KEY = 'nails2_admin_token';
  var data = { masters: [], services: [], bookings: [], outbox: [] };
  var editing = null, pendingPhoto = null;   // pendingPhoto: undefined = не трогаем, '' = убрать, 'data:...' = новое

  /* ---------- Связь с сервером ---------- */
  var api = DEMO ? demoApi() : realApi();

  function realApi() {
    function post(action, payload) {
      var body = Object.assign({ action: action, token: sessionStorage.getItem(TOKEN_KEY) || '' }, payload || {});
      var ctl = window.AbortController ? new AbortController() : null, timer = ctl ? setTimeout(function () { ctl.abort(); }, 60000) : null;
      return fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })   // text/plain: без предварительного запроса
        .then(function (r) { return r.json(); })
        .catch(function (e) { return { ok: false, error: e && e.name === 'AbortError' ? 'TIMEOUT' : 'NET' }; })
        .then(function (res) { if (timer) clearTimeout(timer); return res; });
    }
    return {
      login: function (pw) { return post('adminLogin', { password: pw }); },
      logout: function () { return post('adminLogout'); },
      data: function () { return post('adminData'); },
      saveMaster: function (m) { return post('adminSaveMaster', { master: m }); },
      saveService: function (s) { return post('adminSaveService', { service: s }); },
      photo: function (id, dataUrl, remove) { return post('adminPhoto', { masterId: id, dataUrl: dataUrl, remove: !!remove }); },
      cancel: function (t) { return post('adminCancel', { bookingToken: t }); }
    };
  }
  function demoApi() { return window.DEMO_API.admin; }

  /* ---------- Вход / выход ---------- */
  function showPanel(on) { $('#loginBox').hidden = on; $('#panel').hidden = !on; }
  function toast(text, bad) {
    var t = $('#msg'); t.textContent = text; t.className = 'toast' + (bad ? ' err' : ''); t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 5000);
  }
  function onAuthLost() { sessionStorage.removeItem(TOKEN_KEY); showPanel(false); $('#loginErr').textContent = ERR.AUTH; }

  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('#loginBtn'); btn.disabled = true; btn.textContent = 'Входимо…'; $('#loginErr').textContent = '';
    api.login($('#pw').value).then(function (r) {
      btn.disabled = false; btn.textContent = 'Увійти';
      if (!r.ok) { $('#loginErr').textContent = ERR[r.error] || ERR.SERVER; return; }
      sessionStorage.setItem(TOKEN_KEY, r.token); $('#pw').value = '';
      refresh();
    });
  });
  $('#logout').onclick = function () { api.logout().then(function () { sessionStorage.removeItem(TOKEN_KEY); showPanel(false); }); };

  /* ---------- Данные ---------- */
  function refresh() {
    return api.data().then(function (r) {
      if (!r.ok) { if (r.error === 'AUTH') return onAuthLost(); return toast(ERR[r.error] || ERR.SERVER, true); }
      data = r; showPanel(true);
      $('#outboxTab').hidden = !r.demo;
      renderMasters(); renderServices(); renderBookings(); renderOutbox();
    });
  }
  function svcName(id) { var s = data.services.filter(function (x) { return x.id === id; })[0]; return s ? s.name : id; }
  function btn(act, id, label, cls) { return '<button class="btn ' + (cls || '') + '" data-act="' + act + '" data-id="' + esc(id) + '">' + label + '</button>'; }
  function safePhoto(u) { return /^(https:\/\/|data:image\/)/.test(String(u || '')) ? u : ''; }
  function avatar(m, cls) {
    var url = safePhoto(m && m.photo);
    return '<span class="av ' + (cls || 'sm') + '"><span class="ini">' + esc(m && m.name ? m.name.charAt(0).toUpperCase() : '?') + '</span>' + (url ? '<img src="' + esc(url) + '" alt="">' : '') + '</span>';
  }
  function wirePhotos(root) { root.querySelectorAll('.av img').forEach(function (i) { i.addEventListener('error', function () { i.remove(); }); }); }

  function renderMasters() {
    $('#mList').innerHTML = data.masters.map(function (m) {
      var days = DAYS.filter(function (d) { return m.workdays.indexOf(d[0]) >= 0; }).map(function (d) { return d[1]; }).join(' ');
      var contacts = [m.email, m.phone, m.telegram].filter(Boolean).map(esc).join(' · ') || 'контактів немає';
      var sv = m.services.length ? m.services.map(svcName).map(esc).join(', ') : 'усі послуги';
      return '<div class="row' + (m.active ? '' : ' off') + '">' + avatar(m) + '<div class="info"><b>' + esc(m.name) + (m.active ? '' : '<span class="tag">вимкнено</span>') +
        (m.email ? '<span class="tag on">сповіщення</span>' : '') + '</b><small>' + esc(m.role || 'Без спеціальності') + ' · ' + days + ' · ' + CORE.fmt(m.start) + '–' + CORE.fmt(m.end) + '</small>' +
        '<small>' + contacts + '</small><small>Послуги: ' + sv + '</small></div>' + btn('editM', m.id, 'Змінити') + '</div>';
    }).join('') || '<p class="hint">Майстрів ще немає.</p>';
    wirePhotos($('#mList'));
  }
  function renderServices() {
    var groups = CORE.groupByCategory(data.services);
    $('#sList').innerHTML = groups.map(function (g) {
      return '<div class="cat">' + esc(g.name) + '</div>' + g.items.map(function (s) {
        return '<div class="row' + (s.active ? '' : ' off') + '"><div class="info"><b>' + esc(s.name) + (s.active ? '' : '<span class="tag">прихована</span>') + '</b><small>' + s.durationMin + ' хв</small></div><span class="meta">' + s.price + ' ₴</span>' + btn('editS', s.id, 'Змінити') + '</div>';
      }).join('');
    }).join('') || '<p class="hint">Послуг ще немає.</p>';
    $('#catList').innerHTML = groups.map(function (g) { return '<option value="' + esc(g.name) + '">'; }).join('');
  }
  function renderBookings() {
    $('#bList').innerHTML = data.bookings.map(function (b) {
      var live = b.status === 'Записано';
      return '<div class="row' + (live ? '' : ' off') + '"><div class="info"><b>' + esc(b.when) + ' · ' + esc(b.client) + (live ? '' : '<span class="tag">' + esc(b.status) + '</span>') + '</b>' +
        '<small>' + esc(b.service) + ' · майстер ' + esc(b.master) + '</small><small>' + esc(b.phone) + (b.email ? ' · ' + esc(b.email) : '') + (b.comment ? ' · «' + esc(b.comment) + '»' : '') + '</small></div>' +
        (live ? btn('cancelB', b.token, 'Скасувати', 'danger') : '') + '</div>';
    }).join('') || '<p class="hint">Майбутніх записів немає.</p>';
  }
  function renderOutbox() {
    $('#oList').innerHTML = (data.outbox || []).map(function (o) {
      return '<div class="row"><div class="info"><b>' + esc(o.to) + '</b><small>' + esc(o.at) + ' · ' + esc(o.text) + '</small></div></div>';
    }).join('') || '<p class="hint">Поки порожньо. Запишіться на сайті або змініть пошту майстра.</p>';
  }

  /* ---------- Вкладки и кнопки списков ---------- */
  $('#tabs').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('#tabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
    ['masters', 'services', 'bookings', 'outbox'].forEach(function (t) { $('#tab-' + t).hidden = t !== b.dataset.tab; });
  };
  $('#addMaster').onclick = function () { openMaster(null); };
  $('#addService').onclick = function () { openService(null); };
  $('#mList').onclick = function (e) { var b = e.target.closest('[data-act]'); if (b) openMaster(b.dataset.id); };
  $('#sList').onclick = function (e) { var b = e.target.closest('[data-act]'); if (b) openService(b.dataset.id); };
  $('#bList').onclick = function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    if (!confirm('Скасувати цей запис? Клієнт отримає лист (якщо вказав пошту), час звільниться.')) return;
    b.disabled = true;
    api.cancel(b.dataset.id).then(function (r) {
      if (r.ok) { toast('Запис скасовано'); refresh(); } else if (r.error === 'AUTH') onAuthLost(); else { b.disabled = false; toast(ERR[r.error] || ERR.SERVER, true); }
    });
  };

  /* ---------- Окно мастера ---------- */
  function clearMErrors() { ['name', 'workdays', 'hours', 'lunch', 'email', 'phone', 'telegram'].forEach(function (k) { $('#me-' + k).textContent = ''; }); }
  function openMaster(id) {
    var m = id ? data.masters.filter(function (x) { return x.id === id; })[0] : null;
    editing = id; pendingPhoto = undefined; clearMErrors();
    $('#mTitle').textContent = m ? 'Майстер: ' + m.name : 'Новий майстер';
    $('#m-name').value = m ? m.name : ''; $('#m-role').value = m ? m.role : '';
    $('#m-days').innerHTML = DAYS.map(function (d) { return '<label><input type="checkbox" value="' + d[0] + '"' + ((m ? m.workdays : [1, 2, 3, 4, 5]).indexOf(d[0]) >= 0 ? ' checked' : '') + '>' + d[1] + '</label>'; }).join('');
    $('#m-start').value = CORE.fmt(m ? m.start : 600); $('#m-end').value = CORE.fmt(m ? m.end : 1140);
    var hasL = m && m.lunchEnd > m.lunchStart;
    $('#m-lunchStart').value = hasL ? CORE.fmt(m.lunchStart) : ''; $('#m-lunchEnd').value = hasL ? CORE.fmt(m.lunchEnd) : '';
    $('#m-email').value = m ? m.email : ''; $('#m-phone').value = m ? m.phone : ''; $('#m-telegram').value = m ? m.telegram : '';
    $('#m-services').innerHTML = data.services.map(function (s) { return '<label><input type="checkbox" value="' + esc(s.id) + '"' + (m && m.services.indexOf(s.id) >= 0 ? ' checked' : '') + '>' + esc(s.name) + (s.active ? '' : ' (прихована)') + '</label>'; }).join('');
    $('#m-active').checked = m ? m.active : true;
    drawPhoto(m ? m.photo : '', m ? m.name : '');
    $('#mModal').hidden = false;
  }
  function drawPhoto(url, name) {
    $('#mAv').innerHTML = avatar({ photo: url, name: name || $('#m-name').value }, 'lg'); wirePhotos($('#mAv'));
    $('#mDelPhoto').hidden = !url;
    $('#mPhotoHint').textContent = pendingPhoto === undefined ? '' : 'Фото збережеться разом із профілем';
  }
  $('#mPick').onclick = function () { $('#mFile').click(); };
  $('#mFile').onchange = function () {
    var f = this.files && this.files[0]; this.value = '';
    if (!f) return;
    resizeSquare(f, 600).then(function (url) { pendingPhoto = url; drawPhoto(url); }, function () { toast('Не вдалося прочитати файл. Оберіть фото JPG/PNG.', true); });
  };
  $('#mDelPhoto').onclick = function () { pendingPhoto = ''; drawPhoto('', ''); };
  /** Браузер сам стискає фото до квадрата 600×600 — на сервер летит ~60–100 КБ, а не 5 МБ з телефона. */
  function resizeSquare(file, size) {
    return new Promise(function (res, rej) {
      if (!/^image\//.test(file.type)) return rej();
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var s = Math.min(img.width, img.height), c = document.createElement('canvas');
        c.width = c.height = size;
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(); };
      img.src = url;
    });
  }
  function closeMaster() { $('#mModal').hidden = true; editing = null; }
  $('#mCancel').onclick = closeMaster;
  $('#mModal').addEventListener('mousedown', function (e) { if (e.target === $('#mModal')) closeMaster(); });
  function checked(sel) { return Array.prototype.map.call(document.querySelectorAll(sel + ' input:checked'), function (i) { return i.value; }); }

  $('#mForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var payload = {
      id: editing || '', name: $('#m-name').value, role: $('#m-role').value, workdays: checked('#m-days').map(Number),
      start: $('#m-start').value, end: $('#m-end').value, lunchStart: $('#m-lunchStart').value, lunchEnd: $('#m-lunchEnd').value,
      email: $('#m-email').value, phone: $('#m-phone').value, telegram: $('#m-telegram').value, services: checked('#m-services'), active: $('#m-active').checked
    };
    // Та же проверка, что и на сервере — для удобства; настоящая всё равно на сервере.
    var v = CORE.validateMaster(payload);
    clearMErrors();
    if (!v.ok) { for (var k in v.errors) if ($('#me-' + k)) $('#me-' + k).textContent = v.errors[k]; return; }
    var save = $('#mSave'); save.disabled = true; save.textContent = 'Зберігаємо…';
    api.saveMaster(payload).then(function (r) {
      if (!r.ok) return done(r);
      if (pendingPhoto === undefined) return done(r);
      return api.photo(r.id, pendingPhoto, pendingPhoto === '').then(function (p) { done(p.ok ? r : p); });
    });
    function done(r) {
      save.disabled = false; save.textContent = 'Зберегти';
      if (r.ok) { closeMaster(); toast('Збережено'); return refresh(); }
      if (r.error === 'AUTH') { closeMaster(); return onAuthLost(); }
      if (r.error === 'VALIDATION' && r.fields) { for (var k in r.fields) if ($('#me-' + k)) $('#me-' + k).textContent = r.fields[k]; return; }
      toast(ERR[r.error] || ERR.SERVER, true);
    }
  });

  /* ---------- Окно услуги ---------- */
  function openService(id) {
    var s = id ? data.services.filter(function (x) { return x.id === id; })[0] : null;
    editing = id;
    ['name', 'durationMin', 'price'].forEach(function (k) { $('#se-' + k).textContent = ''; });
    $('#sTitle').textContent = s ? 'Послуга: ' + s.name : 'Нова послуга';
    $('#s-name').value = s ? s.name : ''; $('#s-category').value = s ? s.category : '';
    $('#s-durationMin').value = s ? s.durationMin : 60; $('#s-price').value = s ? s.price : 0;
    $('#s-active').checked = s ? s.active : true;
    $('#sModal').hidden = false;
  }
  function closeService() { $('#sModal').hidden = true; editing = null; }
  $('#sCancel').onclick = closeService;
  $('#sModal').addEventListener('mousedown', function (e) { if (e.target === $('#sModal')) closeService(); });
  $('#sForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var payload = { id: editing || '', name: $('#s-name').value, category: $('#s-category').value, durationMin: $('#s-durationMin').value, price: $('#s-price').value, active: $('#s-active').checked };
    var v = CORE.validateService(payload);
    ['name', 'durationMin', 'price'].forEach(function (k) { $('#se-' + k).textContent = ''; });
    if (!v.ok) { for (var k in v.errors) if ($('#se-' + k)) $('#se-' + k).textContent = v.errors[k]; return; }
    var save = $('#sSave'); save.disabled = true; save.textContent = 'Зберігаємо…';
    api.saveService(payload).then(function (r) {
      save.disabled = false; save.textContent = 'Зберегти';
      if (r.ok) { closeService(); toast('Збережено'); return refresh(); }
      if (r.error === 'AUTH') { closeService(); return onAuthLost(); }
      toast(ERR[r.error] || ERR.SERVER, true);
    });
  });

  /* ---------- Старт ---------- */
  if (DEMO) $('#demo-banner').hidden = false;
  if (sessionStorage.getItem(TOKEN_KEY)) refresh();
})();
