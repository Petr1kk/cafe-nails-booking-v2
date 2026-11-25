(function () {
  'use strict';
  var CFG = window.APP_CONFIG || {};
  var DEMO = !CFG.API_URL;
  var $ = function (s) { return document.querySelector(s); };
  var esc = CORE.escapeHtml;   // любой текст с сервера вставляем на страницу только через экранирование

  var WD = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  var MON = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
  var ERR = {
    TAKEN: 'Цей час щойно зайняли. Оберіть, будь ласка, інший.',
    BUSY: 'Забагато запитів. Спробуйте за хвилину.',
    LIMIT: 'У вас уже кілька записів. Щоб записатися ще, зателефонуйте нам.',
    CAP: 'На сьогодні онлайн-запис закрито. Спробуйте завтра або зателефонуйте.',
    CLOSED: 'Онлайн-запис тимчасово закрито.',
    SERVER: 'Щось пішло не так. Спробуйте ще раз.',
    NET: 'Немає зв’язку з сервером. Перевірте інтернет і спробуйте ще раз.',
    TIMEOUT: 'Сервер відповідає надто довго. Спробуйте ще раз.'
  };

  var state = { cfg: null, selected: [], rest: [], service: null, master: 'any', days: {}, day: null, time: null, openedAt: 0, query: '', cat: null, step: 0, cache: {} };

  /* ---------- Связь с сервером ---------- */
  var api = DEMO ? window.DEMO_API : realApi();

  function realApi() {
    function req(url, init) {
      var ctl = window.AbortController ? new AbortController() : null, timer = null;
      init = init || {};
      if (ctl) { init.signal = ctl.signal; timer = setTimeout(function () { ctl.abort(); }, 35000); }
      return fetch(url, init).then(function (r) { return r.json(); })
        .catch(function (e) { return { ok: false, error: e && e.name === 'AbortError' ? 'TIMEOUT' : 'NET' }; })
        .then(function (res) { if (timer) clearTimeout(timer); return res; });
    }
    function post(action, data) {
      // text/plain, чтобы браузер не делал предварительный запрос (Apps Script его не поддерживает)
      return req(CFG.API_URL, { method: 'POST', body: JSON.stringify(Object.assign({ action: action }, data)) });
    }
    return {
      config: function () { return req(CFG.API_URL + '?action=config'); },
      overview: function () { return req(CFG.API_URL + '?action=overview'); },
      slots: function (service, master) { return req(CFG.API_URL + '?action=slots&service=' + encodeURIComponent(service) + '&master=' + encodeURIComponent(master)); },
      book: function (p) { return post('book', p); },
      booking: function (token) { return req(CFG.API_URL + '?action=booking&token=' + encodeURIComponent(token)); },
      cancel: function (token) { return post('cancel', { token: token }); }
    };
  }

  /* ---------- Показ экранов ---------- */
  var SCREENS = ['step1', 'step2', 'step3', 'step4', 'done', 'cancelBox'];
  function show(id) {
    SCREENS.forEach(function (s) { $('#' + s).hidden = s !== id; });
    $('#loading').hidden = true; $('#error').hidden = true;
    var n = { step1: 1, step2: 2, step3: 3, step4: 4 }[id] || 0;
    state.step = n;
    $('#steps').hidden = !n;
    document.querySelectorAll('#steps li').forEach(function (li) {
      var k = Number(li.dataset.s);
      li.classList.toggle('on', k <= n); li.classList.toggle('cur', k === n); li.classList.toggle('past', k < n);
      li.querySelector('button').disabled = !(k < n);   // вернуться можна лише на пройдені кроки
    });
    window.scrollTo(0, 0);
  }
  function loading(on) { $('#loading').hidden = !on; if (on) SCREENS.forEach(function (s) { $('#' + s).hidden = true; }); }
  function fail(code) {
    SCREENS.forEach(function (s) { $('#' + s).hidden = true; });
    $('#loading').hidden = true; $('#steps').hidden = true;
    $('#error').hidden = false;
    $('#error').innerHTML = esc(ERR[code] || ERR.SERVER) + ' <button class="back" id="retry">Спробувати ще</button>';
    $('#retry').onclick = function () { location.reload(); };
  }
  function prettyDay(d) {
    var p = d.split('-'), dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return { wd: WD[dt.getDay()], n: dt.getDate(), mon: MON[dt.getMonth()] };
  }
  function longDay(d) { var x = prettyDay(d); return x.wd + ', ' + x.n + ' ' + x.mon; }
  function localDay(offset) {
    var d = new Date(); d.setDate(d.getDate() + offset);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function whenLabel(day, time) {
    var w = day === localDay(0) ? 'Сьогодні' : day === localDay(1) ? 'Завтра' : longDay(day);
    return w + ' ' + time;
  }
  function fmtDur(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return (h ? h + ' год' : '') + (h && m ? ' ' : '') + (m ? m + ' хв' : '');
  }
  /** Фото берём только если это https-ссылка или картинка data: (демо). Всё остальное — не показываем. */
  function safePhoto(u) { return /^(https:\/\/|data:image\/)/.test(String(u || '')) ? u : ''; }
  function initials(name) { return String(name || '?').trim().charAt(0).toUpperCase(); }
  function avatar(m, cls) {
    var url = safePhoto(m && m.photo);
    return '<span class="av ' + (cls || '') + '"><span class="ini">' + esc(m ? initials(m.name) : '★') + '</span>' + (url ? '<img src="' + esc(url) + '" alt="" loading="lazy">' : '') + '</span>';
  }
  /** Если картинка не загрузилась — остаётся буква-заглушка. */
  function wirePhotos(root) {
    root.querySelectorAll('.av img').forEach(function (img) { img.addEventListener('error', function () { img.remove(); }); });
  }

  /** Выбранные услуги → одна «составная» (общее время и цена); та же функция считает и на сервере. */
  function combined() { return CORE.combineServices(state.cfg.services, state.selected.join(',')); }
  function masterObj(id) { return id === 'any' ? null : state.cfg.masters.filter(function (x) { return x.id === id; })[0] || null; }
  function masterLabel(id) { var m = masterObj(id); return id === 'any' ? 'будь-який майстер' : (m ? m.name : ''); }
  function svcOf(ids) { return ids.length ? CORE.combineServices(state.cfg.services, ids.join(',')) : null; }

  /* ---------- Крок 1: послуги ---------- */
  var ICONS = {
    hair: '<svg viewBox="0 0 32 32"><circle cx="9" cy="24" r="4"/><circle cx="23" cy="24" r="4"/><path d="M12 21 26 4M20 21 6 4"/></svg>',
    nails: '<svg viewBox="0 0 32 32"><rect x="11" y="14" width="10" height="14" rx="2"/><path d="M13 14v-4h6v4M14 10V4h4v6"/></svg>',
    feet: '<svg viewBox="0 0 32 32"><path d="M16 4c5 6 8 10 8 15a8 8 0 0 1-16 0c0-5 3-9 8-15z"/></svg>',
    other: '<svg viewBox="0 0 32 32"><path d="M16 4l2.5 7.5L26 14l-7.5 2.5L16 24l-2.5-7.5L6 14l7.5-2.5z"/></svg>'
  };
  function catIcon(name) {
    var n = String(name || '').toLowerCase();
    return /стриж|волос|зачіс/.test(n) ? ICONS.hair : /педик/.test(n) ? ICONS.feet : /манік|нігт/.test(n) ? ICONS.nails : ICONS.other;
  }
  function plural(n) { var a = n % 10, b = n % 100; return n + (a === 1 && b !== 11 ? ' послуга' : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? ' послуги' : ' послуг'); }
  /** Послуги, які хоч хтось із активних майстрів справді робить. */
  function allServices() { return state.cfg.services.filter(function (s) { return CORE.eligibleMasters(state.cfg.masters, s.id).length > 0; }); }
  function catOf(s) { return s.category || 'Інше'; }

  function renderStep1() {
    var c = state.cfg;
    $('#title').textContent = c.title; $('#subtitle').textContent = c.subtitle || '';
    document.title = c.title;
    state.master = 'any'; state.cache = {};
    if (!allServices().length) {
      $('#cats').innerHTML = ''; $('#services').innerHTML = ''; $('#q').hidden = true; $('#to2').disabled = true; $('#total').textContent = '';
      $('#noServices').textContent = 'Зараз немає доступних майстрів. Зателефонуйте нам.'; $('#noServices').hidden = false;
      show('step1'); return;
    }
    $('#q').hidden = false; $('#q').value = state.query;
    renderCats(); renderServiceList(); updateTotal();
    show('step1');
  }
  function renderCats() {
    var g = CORE.groupByCategory(allServices());
    if (!state.cat || !g.some(function (x) { return x.name === state.cat; })) state.cat = g.length ? g[0].name : null;
    $('#cats').innerHTML = g.map(function (x) {
      var n = x.items.filter(function (s) { return state.selected.indexOf(s.id) >= 0; }).length;
      return '<button class="cat' + (x.name === state.cat && !state.query ? ' sel' : '') + '" data-cat="' + esc(x.name) + '">' + (n ? '<span class="cnt">' + n + '</span>' : '') +
        catIcon(x.name) + '<span class="t">' + esc(x.name) + '</span><span class="d">' + plural(x.items.length) + '</span></button>';
    }).join('');
  }
  function renderServiceList() {
    var q = state.query.trim(), base = allServices(), list, groups;
    if (q) { list = CORE.filterServices(base, q); groups = CORE.groupByCategory(list); $('#catname').textContent = '· пошук'; }
    else {
      list = base.filter(function (s) { return catOf(s) === state.cat; });
      groups = [{ name: state.cat, items: list }];
      $('#catname').textContent = state.cat ? '· ' + state.cat : '';
    }
    $('#noServices').textContent = 'Нічого не знайдено'; $('#noServices').hidden = list.length > 0;
    $('#services').innerHTML = groups.map(function (g) {
      return (q ? '<h3>' + esc(g.name) + '</h3>' : '') + '<div class="list">' + g.items.map(function (s) {
        return '<button class="opt' + (state.selected.indexOf(s.id) >= 0 ? ' sel' : '') + '" data-id="' + esc(s.id) + '"><span class="chk"></span><span class="nm">' + esc(s.name) + '<small>' + fmtDur(s.durationMin) + '</small></span><span class="price">' + s.price + ' ₴</span></button>';
      }).join('') + '</div>';
    }).join('');
  }
  $('#q').addEventListener('input', function () { state.query = $('#q').value; renderCats(); renderServiceList(); });
  $('#cats').addEventListener('click', function (e) {
    var b = e.target.closest('.cat'); if (!b) return;
    state.cat = b.dataset.cat; state.query = ''; $('#q').value = '';
    renderCats(); renderServiceList();
  });
  $('#services').addEventListener('click', function (e) {
    var b = e.target.closest('.opt'); if (!b) return;
    var id = b.dataset.id, i = state.selected.indexOf(id);
    if (i >= 0) state.selected.splice(i, 1);
    else if (state.selected.length < 4) state.selected.push(id);
    b.classList.toggle('sel', state.selected.indexOf(id) >= 0);
    state.rest = []; state.master = 'any'; state.cache = {};
    renderCats(); updateTotal();
  });

  /** Майстри, які зможуть зробити ВСІ обрані послуги. */
  function whoCan(ids) { return CORE.eligibleMasters(state.cfg.masters, ids.join(',')); }
  /** Найдовше вікно у підходящих майстрів. */
  function limitFor(ids) {
    var best = 0;
    whoCan(ids).forEach(function (m) { if (typeof m.maxBlockMin !== 'number') best = Infinity; else if (m.maxBlockMin > best) best = m.maxBlockMin; });
    return best;
  }
  /** Залишаємо послуги за порядком вибору, поки влазять у вікно; решта — на окремий візит. */
  function splitToFit(max) {
    var keep = [], rest = [], sum = 0;
    state.selected.forEach(function (id) {
      var d = svcOf([id]).durationMin;
      if (sum + d <= max) { keep.push(id); sum += d; } else rest.push(id);
    });
    return { keep: keep, rest: rest };
  }
  function updateTotal() {
    var sv = svcOf(state.selected), warn = $('#warn'), t = $('#total');
    var noOne = !!sv && whoCan(state.selected).length === 0;           // жоден майстер не робить усе разом
    var max = sv ? limitFor(state.selected) : 0, tooLong = !!sv && !noOne && sv.durationMin > max;
    warn.hidden = !(tooLong || noOne);
    $('#to2').disabled = !sv || tooLong || noOne;
    if (noOne) {
      warn.innerHTML = '<b>Усе це за один візит ніхто не зробить.</b> Різні майстри роблять різні послуги. Що можна зробити:' +
        '<button class="alt" data-act="drop">Залишити тільки останню обрану<small>Решту запишете окремим візитом</small></button>' +
        '<button class="alt" data-act="call">Зателефонувати нам<small>Підберемо майстрів і час</small></button>';
    } else if (tooLong) {
      var sp = splitToFit(max), kept = svcOf(sp.keep), html;
      html = '<b>Це забагато для одного візиту.</b> Обрані послуги займають ' + fmtDur(sv.durationMin) +
        ', а найдовше вільне вікно у майстрів — ' + fmtDur(max) + '. Що можна зробити:';
      if (kept) html += '<button class="alt" data-act="fit">Залишити: ' + esc(kept.name) + ' (' + fmtDur(kept.durationMin) + ')<small>Решту (' + esc(svcOf(sp.rest).name) + ') запишете окремим візитом одразу після цього</small></button>';
      html += '<button class="alt" data-act="call">Зателефонувати нам<small>Дуже довгі набори краще узгодити з майстром</small></button>';
      warn.innerHTML = html;
    }
    if (!sv) t.textContent = 'Можна обрати кілька послуг';
    else if (tooLong || noOne) t.textContent = '';
    else {
      t.textContent = 'Разом: ' + fmtDur(sv.durationMin) + ' · ' + sv.price + ' ₴';
      if (state.rest.length) t.textContent += ' · решту (' + svcOf(state.rest).name + ') запишемо окремим візитом';
    }
  }
  function syncSelected() {
    document.querySelectorAll('#services .opt').forEach(function (x) { x.classList.toggle('sel', state.selected.indexOf(x.dataset.id) >= 0); });
    renderCats(); updateTotal();
  }
  $('#warn').onclick = function (e) {
    var b = e.target.closest('.alt'); if (!b) return;
    var act = b.dataset.act;
    if (act === 'fit') {
      var sp = splitToFit(limitFor(state.selected));
      state.selected = sp.keep; state.rest = sp.rest; syncSelected();
    } else if (act === 'drop') {
      var last = state.selected[state.selected.length - 1];
      state.rest = state.selected.slice(0, -1); state.selected = [last]; syncSelected();
    } else if (act === 'call') alert('Зателефонуйте нам — підберемо час під великий набір послуг.');
  };

  /* ---------- Крок 2: майстер (тільки ті, хто робить обрані послуги) ---------- */
  /** Вільний час тягнемо один раз на пару «послуги + майстер» і запам’ятовуємо (кеш скидається при зміні послуг). */
  function loadSlots(ids, master) {
    var key = ids + '|' + master;
    if (!state.cache[key]) {
      state.cache[key] = api.slots(ids, master).then(function (r) { if (!r || !r.ok) delete state.cache[key]; return r; });
    }
    return state.cache[key];
  }
  function nearHtml(r) {
    if (!r || !r.ok) return '<span class="dim">час не вдалося завантажити</span>';
    var out = [];
    Object.keys(r.days).sort().forEach(function (d) { r.days[d].forEach(function (t) { if (out.length < 3) out.push(whenLabel(d, t).toLowerCase()); }); });
    if (!out.length) return '<span class="dim">найближчим часом місць немає</span>';
    return out.map(function (x, i) { return (i ? '<em>/</em>' + esc(x) : '<b>' + esc(x) + '</b>'); }).join('');
  }
  function renderStep2() {
    var sv = svcOf(state.selected); if (!sv) return renderStep1();
    $('#chosen').innerHTML = '<span><small>Ваші послуги</small><b>' + esc(sv.name) + '</b><small>' + fmtDur(sv.durationMin) + ' · ' + sv.price + ' ₴</small></span><button class="link" id="chg">змінити</button>';
    $('#chg').onclick = function () { show('step1'); };
    var ms = whoCan(state.selected).filter(function (m) { return typeof m.maxBlockMin !== 'number' || m.maxBlockMin >= sv.durationMin; });
    $('#noMasters').hidden = ms.length > 0;
    var html = ms.map(function (m) {
      return '<button class="mrow" data-id="' + esc(m.id) + '">' + avatar(m) + '<span class="mi"><b>' + esc(m.name) + '</b><small>' + esc(m.role || 'Майстер') + '</small>' +
        '<span class="near" data-near="' + esc(m.id) + '"><span class="dim">шукаємо вільний час…</span></span></span><span class="go">→</span></button>';
    }).join('');
    if (ms.length > 1) html += '<button class="mrow" data-id="any">' + avatar(null, 'any') + '<span class="mi"><b>Будь-який майстер</b><small>Покажемо весь вільний час усіх, хто це робить</small></span><span class="go">→</span></button>';
    $('#masters').innerHTML = html;
    wirePhotos($('#masters'));
    ms.forEach(function (m) {
      loadSlots(sv.ids, m.id).then(function (r) {
        var el = document.querySelector('[data-near="' + m.id.replace(/["\\]/g, '') + '"]');
        if (el) el.innerHTML = nearHtml(r);
      });
    });
    show('step2');
  }
  $('#masters').onclick = function (e) {
    var b = e.target.closest('.mrow'); if (!b) return;
    state.master = b.dataset.id;
    goStep3();
  };

  /* ---------- Крок 3: день и время ---------- */
  function goStep3() {
    state.service = combined();
    state.day = null; state.time = null; $('#to4').disabled = true;
    loading(true);
    loadSlots(state.service.ids, state.master).then(function (r) {
      if (!r.ok) { loading(false); return fail(r.error); }
      if (!r.accepting) { loading(false); return fail('CLOSED'); }
      state.days = r.days;
      renderStep3();
    });
  }
  function renderStep3() {
    $('#summary3').innerHTML = esc(state.service.name) + '<br>' + fmtDur(state.service.durationMin) + ' · ' + state.service.price + ' ₴ · ' + esc(masterLabel(state.master));
    var free = Object.keys(state.days).sort().filter(function (d) { return state.days[d].length; });
    $('#nodays').hidden = free.length > 0;
    $('#nodays').textContent = state.service.durationMin >= 240
      ? 'На такий набір послуг потрібно ' + fmtDur(state.service.durationMin) + ' — це не вміщається в один робочий день майстра. Оберіть менше послуг (їх можна розділити на два візити) або зателефонуйте нам.'
      : 'Найближчим часом вільних місць немає. Спробуйте іншого майстра або зателефонуйте нам.';
    $('#days').innerHTML = free.map(function (d) {
      var x = prettyDay(d);
      return '<button class="chip day" data-d="' + d + '"><small>' + x.wd + '</small><b>' + x.n + '</b><small>' + x.mon + '</small></button>';
    }).join('');
    $('#times').innerHTML = '';
    $('#days').onclick = function (e) {
      var b = e.target.closest('.day'); if (!b) return;
      state.day = b.dataset.d; state.time = null; $('#to4').disabled = true;
      document.querySelectorAll('#days .day').forEach(function (x) { x.classList.toggle('sel', x === b); });
      $('#times').innerHTML = state.days[state.day].map(function (t) { return '<button class="time" data-t="' + t + '">' + t + '</button>'; }).join('');
    };
    $('#times').onclick = function (e) {
      var b = e.target.closest('.time'); if (!b) return;
      state.time = b.dataset.t;
      document.querySelectorAll('#times .time').forEach(function (x) { x.classList.toggle('sel', x === b); });
      $('#to4').disabled = false;
    };
    show('step3');
  }

  /* ---------- Крок 4: данные клиента ---------- */
  function renderStep4() {
    $('#summary4').innerHTML = esc(state.service.name) + '<br>' + esc(longDay(state.day)) + ', ' + state.time + ' · ' + esc(masterLabel(state.master));
    state.openedAt = Date.now();
    clearErrors();
    show('step4');
  }
  function clearErrors() {
    ['name', 'phone', 'email'].forEach(function (k) { $('#e-' + k).textContent = ''; $('#f-' + k).classList.remove('bad'); });
  }
  function showErrors(fields) {
    clearErrors();
    for (var k in fields) { if ($('#e-' + k)) { $('#e-' + k).textContent = fields[k]; $('#f-' + k).classList.add('bad'); } }
  }

  $('#form').addEventListener('submit', function (e) {
    e.preventDefault();
    var data = {
      service: state.service.ids, master: state.master, day: state.day, time: state.time,
      name: $('#f-name').value, phone: $('#f-phone').value, email: $('#f-email').value, comment: $('#f-comment').value,
      website: $('#f-website').value, elapsedMs: Date.now() - state.openedAt
    };
    // Проверка в браузере — для удобства гостя. Настоящая проверка всё равно будет на сервере.
    var v = CORE.validateClient(data);
    if (!v.ok) return showErrors(v.errors);
    clearErrors();
    var btn = $('#submit'); btn.disabled = true; btn.textContent = 'Записуємо…';
    api.book(data).then(function (r) {
      btn.disabled = false; btn.textContent = 'Записатися';
      if (r.ok) return renderDone(r.booking);
      if (r.error === 'VALIDATION') return showErrors(r.fields || {});
      if (r.error === 'TAKEN') { alert(ERR.TAKEN); state.cache = {}; return goStep3(); }
      alert(ERR[r.error] || ERR.SERVER);
    });
  });

  /* ---------- Готово ---------- */
  function renderDone(b) {
    $('#doneInfo').innerHTML = esc(b.service) + '<br><b>' + esc(longDay(b.day)) + ', ' + esc(b.time) + '</b><br>Майстер: ' + esc(b.master);
    var link = location.origin + location.pathname + '?cancel=' + encodeURIComponent(b.token);
    $('#cancelLink').value = link;
    var rs = svcOf(state.rest);
    $('#restBtn').hidden = !rs;
    if (rs) $('#restBtn').textContent = 'Записати решту: ' + rs.name;
    show('done');
  }
  $('#copy').onclick = function () {
    var el = $('#cancelLink'); el.select();
    try { (navigator.clipboard ? navigator.clipboard.writeText(el.value) : Promise.reject()).catch(function () { document.execCommand('copy'); }); } catch (e) { document.execCommand('copy'); }
    $('#copy').textContent = 'Скопійовано ✓';
  };
  $('#restBtn').onclick = function () {
    state.selected = state.rest.slice(); state.rest = [];
    state.day = null; state.time = null;
    renderStep1();
  };
  $('#again').onclick = function () { location.href = location.pathname; };

  /* ---------- Отмена по ссылке ---------- */
  function startCancel(token) {
    api.booking(token).then(function (r) {
      if (!r.ok || r.status !== 'Записано') {
        $('#cancelInfo').textContent = 'Запис не знайдено або вже скасовано.';
        $('#cancelBtn').hidden = true;
      } else if (r.past) {
        $('#cancelInfo').textContent = 'Цей запис уже минув.'; $('#cancelBtn').hidden = true;
      } else {
        $('#cancelInfo').innerHTML = esc(r.service) + '<br><b>' + esc(longDay(r.day)) + ', ' + esc(r.time) + '</b><br>Майстер: ' + esc(r.master);
      }
      show('cancelBox');
    });
    $('#cancelBtn').onclick = function () {
      var b = $('#cancelBtn'); b.disabled = true; b.textContent = 'Скасовуємо…';
      api.cancel(token).then(function (r) {
        $('#cancelInfo').textContent = r.ok ? 'Запис скасовано. Чекаємо на вас іншим разом!' : (ERR[r.error] || 'Не вдалося скасувати. Зателефонуйте нам.');
        b.hidden = true;
      });
    };
  }

  /* ---------- Кнопки навигации ---------- */
  $('#to2').onclick = renderStep2;
  $('#to4').onclick = renderStep4;
  document.querySelectorAll('.back').forEach(function (b) {
    b.addEventListener('click', function () {
      var to = b.dataset.back;
      if (to === '1') show('step1'); else if (to === '2') show('step2'); else show('step3');
    });
  });

  document.querySelectorAll('#steps li').forEach(function (li) {
    li.querySelector('button').addEventListener('click', function () {
      var n = Number(li.dataset.s);
      if (n >= state.step) return;   // вперед по кроках — лише кнопками «Далі»
      show('step' + n);
    });
  });

  /* ---------- Старт ---------- */
  if (DEMO) $('#demo-banner').hidden = false;
  var token = new URLSearchParams(location.search).get('cancel');
  if (token) { loading(true); startCancel(token); }
  else {
    api.config().then(function (c) {
      if (!c.ok) { loading(false); return fail(c.error); }
      if (!c.accepting) { loading(false); return fail('CLOSED'); }
      state.cfg = c; renderStep1();
    });
  }
})();
