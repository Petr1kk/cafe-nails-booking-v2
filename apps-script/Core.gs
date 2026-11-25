/**
 * Core.gs — «мозг» записи: чистая логика без обращений к Google.
 * Дни — строки 'YYYY-MM-DD', время — минуты от полуночи (10:00 = 600).
 * Этот же файл копируется на сайт (site/core.js) для демо-режима,
 * поэтому демо и настоящий сервер считают свободные окна одинаково.
 */
var CORE = (function () {
  var DEFAULTS = {
    accepting: true,
    stepMin: 30,          // шаг сетки окон: 10:00, 10:30, 11:00 ...
    leadHours: 2,         // не записываем «на через 5 минут»
    horizonDays: 30,      // на сколько дней вперёд открыта запись
    dailyCap: 40,         // защита от флуда: записей с сайта в сутки
    ownerEmail: '',
    siteUrl: '',          // адрес сайта, нужен для ссылки «отменить запись» в письме
    retentionMonths: 12,
    title: 'Запис на манікюр',
    subtitle: ''
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(min) { return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }
  function hm(str, fallback) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(str === undefined || str === null ? '' : str).trim());
    if (!m) return fallback;
    var v = Number(m[1]) * 60 + Number(m[2]);
    return v >= 0 && v <= 1440 ? v : fallback;
  }
  function num(v, fallback, min, max) {
    var n = Number(String(v).replace(',', '.'));
    if (!isFinite(n) || String(v).trim() === '') return fallback;
    if (min !== undefined && n < min) return min;
    if (max !== undefined && n > max) return max;
    return Math.floor(n);
  }
  function yes(v, fallback) {
    var s = String(v === undefined || v === null ? '' : v).trim().toLowerCase();
    if (s === '') return fallback;
    return ['так', 'да', 'yes', 'true', '1', 'вкл', 'увімк'].indexOf(s) >= 0;
  }
  function cleanText(s, max) {
    return String(s === undefined || s === null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  /* ---------- Настройки (из листов Google Таблицы) ---------- */

  /** map — пары «название настройки» → значение с листа «Налаштування». */
  function parseSettings(map) {
    map = map || {};
    var c = {};
    for (var k in DEFAULTS) c[k] = DEFAULTS[k];
    c.accepting = yes(map['Прийом записів'], DEFAULTS.accepting);
    c.title = cleanText(map['Назва'], 80) || DEFAULTS.title;
    c.subtitle = cleanText(map['Підзаголовок'], 160);
    c.stepMin = num(map['Крок записів, хв'], DEFAULTS.stepMin, 10, 120);
    c.leadHours = num(map['Не раніше ніж через, год'], DEFAULTS.leadHours, 0, 72);
    c.horizonDays = num(map['Днів уперед'], DEFAULTS.horizonDays, 1, 120);
    c.dailyCap = num(map['Ліміт записів на добу'], DEFAULTS.dailyCap, 1, 500);
    c.ownerEmail = String(map['Пошта власника'] || '').trim();
    c.siteUrl = String(map['Адреса сайту'] || '').trim();
    c.retentionMonths = num(map['Зберігати дані, міс.'], DEFAULTS.retentionMonths, 1, 60);
    return c;
  }

  function parseWorkdays(str, fallback) {
    var wd = String(str === undefined || str === null ? '' : str).split(/[\s,;]+/).map(Number).filter(function (n) { return n >= 1 && n <= 7; });
    return wd.length ? wd : fallback;
  }

  /**
   * rows — строки листа «Майстри»:
   * [id, ім'я, спеціальність, дні, початок, кінець, обід з, обід до, id календаря, пошта, телефон, telegram, фото, активний, послуги].
   * Возвращает ВСЕХ мастеров (в том числе отключённых, поле active) — фильтрует тот, кому нужно.
   */
  function parseMasters(rows) {
    var out = [];
    (rows || []).forEach(function (r) {
      var id = cleanText(r[0], 20), name = cleanText(r[1], 40);
      if (!/^[A-Za-z0-9_]{1,20}$/.test(id) || !name) return;
      var m = {
        id: id, name: name, role: cleanText(r[2], 60),
        workdays: parseWorkdays(r[3], [1, 2, 3, 4, 5]),
        start: hm(r[4], 600), end: hm(r[5], 1140),
        lunchStart: hm(r[6], 0), lunchEnd: hm(r[7], 0),
        calendarId: String(r[8] || '').trim(),
        email: String(r[9] || '').trim(),
        phone: String(r[10] || '').trim(),
        telegram: String(r[11] || '').trim(),
        photo: String(r[12] || '').trim(),
        active: yes(r[13], true),
        services: parseIdList(r[14])      // пусто = делает все услуги
      };
      if (m.end <= m.start) { m.start = 600; m.end = 1140; }
      out.push(m);
    });
    return out;
  }
  function parseIdList(v) {
    return String(v === undefined || v === null ? '' : v).split(/[\s,;]+/).filter(function (s) { return /^[A-Za-z0-9_]{1,20}$/.test(s); });
  }
  function activeMasters(masters) { return masters.filter(function (m) { return m.active; }); }
  /** Строка листа «Майстри» из объекта мастера (обратное действие к parseMasters). */
  function masterRow(m) {
    var h = function (v) { return v ? fmt(v) : ''; };
    return [m.id, m.name, m.role || '', m.workdays.join(','), fmt(m.start), fmt(m.end), m.lunchEnd > m.lunchStart ? fmt(m.lunchStart) : '', m.lunchEnd > m.lunchStart ? fmt(m.lunchEnd) : '',
      m.calendarId || '', m.email || '', m.phone || '', m.telegram || '', m.photo || '', m.active ? 'так' : 'ні', (m.services || []).join(',')];
  }

  /** rows — строки листа «Послуги»: [id, назва, тривалість хв, ціна, активна, категорія]. includeHidden — для админки. */
  function parseServices(rows, includeHidden) {
    var out = [];
    (rows || []).forEach(function (r) {
      var id = cleanText(r[0], 20), name = cleanText(r[1], 80);
      if (!/^[A-Za-z0-9_]{1,20}$/.test(id) || !name) return;
      var active = yes(r[4], true);
      if (!active && !includeHidden) return;
      out.push({ id: id, name: name, durationMin: num(r[2], 60, 10, 480), price: num(r[3], 0, 0, 1000000), category: cleanText(r[5], 40) || 'Інше', active: active });
    });
    return out;
  }
  function serviceRow(s) { return [s.id, s.name, String(s.durationMin), String(s.price), s.active ? 'так' : 'ні', s.category || '']; }

  /** Может ли мастер сделать ВСЕ выбранные услуги (ids — массив). */
  function masterDoes(m, ids) {
    if (!m.services || !m.services.length) return true;
    return ids.every(function (id) { return m.services.indexOf(id) >= 0; });
  }
  /** Активные мастера, которые делают все выбранные услуги. idsStr — 's1,s3'. */
  function eligibleMasters(masters, idsStr) {
    var ids = String(idsStr || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    return activeMasters(masters).filter(function (m) { return masterDoes(m, ids); });
  }
  /** Услуги, которые делает мастер (или все, если мастер «любой»/не указан). */
  function servicesFor(services, master) {
    if (!master || !master.services || !master.services.length) return services;
    return services.filter(function (s) { return master.services.indexOf(s.id) >= 0; });
  }
  /** Группы по категориям в порядке первого появления: [{name, items}]. */
  function groupByCategory(services) {
    var groups = [], idx = {};
    services.forEach(function (s) {
      var c = s.category || 'Інше';
      if (!(c in idx)) { idx[c] = groups.length; groups.push({ name: c, items: [] }); }
      groups[idx[c]].items.push(s);
    });
    return groups;
  }
  /** Поиск по названию (без учёта регистра). */
  function filterServices(services, q) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return services;
    return services.filter(function (s) { return s.name.toLowerCase().indexOf(q) >= 0; });
  }

  function normalizeTelegram(raw) {
    var s = String(raw || '').trim().replace(/^https?:\/\/t\.me\//i, '').replace(/^@/, '');
    return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(s) ? '@' + s : '';
  }

  /** Проверка профиля мастера из админки. Возвращает {ok, errors, clean}. Фото сюда не входит (его ставит только загрузка). */
  function validateMaster(p, knownServiceIds) {
    var err = {}, c = {};
    c.name = cleanText(p.name, 40);
    if (c.name.length < 2) err.name = 'Вкажіть ім’я';
    c.role = cleanText(p.role, 60);
    c.workdays = parseWorkdays(Array.isArray(p.workdays) ? p.workdays.join(',') : p.workdays, []);
    if (!c.workdays.length) err.workdays = 'Оберіть хоча б один робочий день';
    c.start = hm(p.start, -1); c.end = hm(p.end, -1);
    if (c.start < 0 || c.end < 0 || c.end <= c.start) err.hours = 'Кінець дня має бути пізніше за початок';
    var ls = String(p.lunchStart || '').trim(), le = String(p.lunchEnd || '').trim();
    if (ls || le) {
      c.lunchStart = hm(ls, -1); c.lunchEnd = hm(le, -1);
      if (c.lunchStart < 0 || c.lunchEnd <= c.lunchStart || c.lunchStart < c.start || c.lunchEnd > c.end) err.lunch = 'Обід має бути в межах робочого дня';
    } else { c.lunchStart = 0; c.lunchEnd = 0; }
    c.email = cleanText(p.email, 120).toLowerCase();
    if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email)) err.email = 'Перевірте пошту';
    var rawPhone = cleanText(p.phone, 30);
    c.phone = rawPhone ? normalizePhone(rawPhone) : '';
    if (rawPhone && !c.phone) err.phone = 'Номер у форматі +380 XX XXX XX XX';
    var rawTg = cleanText(p.telegram, 60);
    c.telegram = rawTg ? normalizeTelegram(rawTg) : '';
    if (rawTg && !c.telegram) err.telegram = 'Telegram: @username (5–32 символи)';
    c.services = parseIdList(Array.isArray(p.services) ? p.services.join(',') : p.services).filter(function (id, i, a) { return a.indexOf(id) === i; });
    if (knownServiceIds) c.services = c.services.filter(function (id) { return knownServiceIds.indexOf(id) >= 0; });
    c.active = p.active === true || p.active === 'true' || p.active === 'так';
    return { ok: Object.keys(err).length === 0, errors: err, clean: c };
  }

  /** Проверка услуги из админки. */
  function validateService(p) {
    var err = {}, c = {};
    c.name = cleanText(p.name, 80);
    if (c.name.length < 2) err.name = 'Вкажіть назву';
    var d = Number(p.durationMin);
    if (!isFinite(d) || d < 10 || d > 480) err.durationMin = 'Тривалість від 10 до 480 хв';
    c.durationMin = Math.floor(d) || 0;
    var pr = Number(p.price);
    if (!isFinite(pr) || pr < 0 || pr > 1000000) err.price = 'Ціна від 0 до 1 000 000';
    c.price = Math.floor(pr) || 0;
    c.category = cleanText(p.category, 40) || 'Інше';
    c.active = p.active === true || p.active === 'true' || p.active === 'так';
    return { ok: Object.keys(err).length === 0, errors: err, clean: c };
  }

  /**
   * Несколько услуг за один визит: 's1,s3' → одна «составная» услуга (названия через «+», время и цена складываются).
   * Возвращает {ids, name, durationMin, price} или null, если что-то не так (неизвестная услуга, больше 4).
   */
  function combineServices(list, idsStr) {
    var want = String(idsStr === undefined || idsStr === null ? '' : idsStr).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var uniq = want.filter(function (id, i) { return want.indexOf(id) === i; });
    if (!uniq.length || uniq.length > 4) return null;
    var picked = [];
    for (var i = 0; i < uniq.length; i++) {
      var s = list.filter(function (x) { return x.id === uniq[i]; })[0];
      if (!s) return null;
      picked.push(s);
    }
    return {
      ids: picked.map(function (s) { return s.id; }).join(','),
      name: picked.map(function (s) { return s.name; }).join(' + '),
      durationMin: picked.reduce(function (a, s) { return a + s.durationMin; }, 0),
      price: picked.reduce(function (a, s) { return a + s.price; }, 0)
    };
  }

  /** Что можно показывать на сайте (без календарей и почты мастеров). */
  /** Самое длинное непрерывное окно мастера в минутах (обед делит день на две части). */
  function maxBlockMin(m) {
    var whole = m.end - m.start;
    if (!(m.lunchEnd > m.lunchStart)) return whole;
    var a = Math.max(0, Math.min(m.lunchStart, m.end) - m.start);
    var b = Math.max(0, m.end - Math.max(m.lunchEnd, m.start));
    return Math.max(a, b);
  }

  /** Для сайта: только активные мастера, без календаря/почты/телефона/telegram (это внутренние данные). */
  function publicMasters(masters) {
    return activeMasters(masters).map(function (m) {
      return { id: m.id, name: m.name, role: m.role, photo: m.photo, services: m.services, active: true, maxBlockMin: maxBlockMin(m) };
    });
  }

  /* ---------- Даты ---------- */

  function isoWeekday(day) {
    var g = new Date(day + 'T00:00:00Z').getUTCDay();
    return g === 0 ? 7 : g;
  }
  function addDays(day, n) {
    var d = new Date(day + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function validDay(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) return false;
    var d = new Date(day + 'T00:00:00Z');
    return !isNaN(d.getTime()) && addDays(day, 0) === day;
  }
  /** Дни, на которые вообще открыта запись. now = {day:'YYYY-MM-DD', min:Number}. */
  function availableDays(cfg, now) {
    var out = [];
    for (var i = 0; i <= cfg.horizonDays; i++) out.push(addDays(now.day, i));
    return out;
  }

  /* ---------- Свободные окна ---------- */

  /** Свободные окна одного мастера на день. busy — [{s,e}] в минутах этого дня. Возвращает минуты начала. */
  function masterFree(m, cfg, duration, day, busy, now) {
    if (!validDay(day)) return [];
    if (day < now.day || day > addDays(now.day, cfg.horizonDays)) return [];
    if (m.workdays.indexOf(isoWeekday(day)) < 0) return [];
    busy = busy || [];
    var out = [];
    for (var s = m.start; s + duration <= m.end; s += cfg.stepMin) {
      var e = s + duration;
      if (m.lunchEnd > m.lunchStart && s < m.lunchEnd && e > m.lunchStart) continue;
      if (day === now.day && s < now.min + cfg.leadHours * 60) continue;
      if (busy.some(function (b) { return s < b.e && e > b.s; })) continue;
      out.push(s);
    }
    return out;
  }

  /**
   * Свободные окна на день: либо у выбранного мастера, либо «у любого» (объединение).
   * busyByMaster — { masterId: [{s,e}] }. Возвращает ['10:00', '10:30', ...].
   */
  function freeTimes(masters, cfg, duration, day, busyByMaster, now, masterId) {
    var set = {};
    masters.forEach(function (m) {
      if (masterId && masterId !== 'any' && m.id !== masterId) return;
      masterFree(m, cfg, duration, day, busyByMaster[m.id], now).forEach(function (s) { set[s] = true; });
    });
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; }).map(fmt);
  }

  /**
   * Ближайшие свободные окна одного мастера: [{day, time}] (до limit штук).
   * days — список дней, busyByDay — { 'YYYY-MM-DD': [{s,e}] } для этого мастера.
   */
  function nearestSlots(m, cfg, duration, days, busyByDay, now, limit) {
    var out = [];
    for (var i = 0; i < days.length && out.length < limit; i++) {
      var free = masterFree(m, cfg, duration, days[i], (busyByDay || {})[days[i]], now);
      for (var k = 0; k < free.length && out.length < limit; k++) out.push({ day: days[i], time: fmt(free[k]) });
    }
    return out;
  }

  /** Кто именно возьмёт запись: выбранный мастер или первый свободный из «любого». Возвращает id или ''. */
  function pickMaster(masters, cfg, duration, day, time, busyByMaster, now, masterId) {
    var t = hm(time, -1);
    for (var i = 0; i < masters.length; i++) {
      var m = masters[i];
      if (masterId && masterId !== 'any' && m.id !== masterId) continue;
      if (masterFree(m, cfg, duration, day, busyByMaster[m.id], now).indexOf(t) >= 0) return m.id;
    }
    return '';
  }

  /* ---------- Данные клиента ---------- */

  function normalizePhone(raw) {
    var s = String(raw || '').replace(/[\s\-().]/g, '');
    if (/^\+380\d{9}$/.test(s)) return s;
    if (/^380\d{9}$/.test(s)) return '+' + s;
    if (/^0\d{9}$/.test(s)) return '+38' + s;
    return '';
  }
  function formatPhone(p) {
    return p.replace(/^(\+380)(\d{2})(\d{3})(\d{2})(\d{2})$/, '$1 $2 $3 $4 $5');
  }
  /** Защита от формул в Google Таблице: текст, начинающийся с «=», превращаем в обычный текст. */
  function sanitizeCell(s) {
    s = String(s === undefined || s === null ? '' : s);
    return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  /** Проверка формы клиента. Возвращает {ok, errors, clean}. */
  function validateClient(p) {
    var err = {}, clean = {};
    clean.name = cleanText(p.name, 60);
    if (clean.name.length < 2 || !/[A-Za-zА-Яа-яІіЇїЄєҐґ]/.test(clean.name)) err.name = 'Вкажіть ім’я';
    clean.phone = normalizePhone(p.phone);
    if (!clean.phone) err.phone = 'Номер у форматі +380 XX XXX XX XX';
    clean.email = cleanText(p.email, 120).toLowerCase();
    if (clean.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean.email)) err.email = 'Перевірте пошту';
    clean.comment = cleanText(p.comment, 500);
    return { ok: Object.keys(err).length === 0, errors: err, clean: clean };
  }

  /**
   * Что делать с попыткой записи. activeCount — сколько у клиента уже будущих записей,
   * recentCount — попыток за сутки. 'ok' — записываем, 'limit' — просим позвонить, 'shadow' — тихо делаем вид.
   */
  function decideAttempt(activeCount, recentCount) {
    if (recentCount >= 6) return 'shadow';
    if (activeCount >= 3) return 'limit';
    return 'ok';
  }

  return {
    DEFAULTS: DEFAULTS, parseSettings: parseSettings, parseMasters: parseMasters, parseServices: parseServices,
    publicMasters: publicMasters, maxBlockMin: maxBlockMin, combineServices: combineServices, fmt: fmt, hm: hm, isoWeekday: isoWeekday, addDays: addDays, validDay: validDay,
    availableDays: availableDays, masterFree: masterFree, freeTimes: freeTimes, pickMaster: pickMaster, nearestSlots: nearestSlots,
    activeMasters: activeMasters, masterRow: masterRow, serviceRow: serviceRow, masterDoes: masterDoes, eligibleMasters: eligibleMasters,
    servicesFor: servicesFor, groupByCategory: groupByCategory, filterServices: filterServices, normalizeTelegram: normalizeTelegram,
    validateMaster: validateMaster, validateService: validateService, parseIdList: parseIdList,
    normalizePhone: normalizePhone, formatPhone: formatPhone, cleanText: cleanText, sanitizeCell: sanitizeCell,
    escapeHtml: escapeHtml, validateClient: validateClient, decideAttempt: decideAttempt
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CORE;   // для тестов в Node; в Google игнорируется
