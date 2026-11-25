/**
 * Демо-«сервер» прямо в браузере: тот же мозг (core.js), но вместо Google Календаря и Таблицы
 * всё лежит в localStorage этого браузера. Нужен, чтобы портфолио (сайт + админка) работало без Google.
 * Пароль демо-админки: demo
 */
window.DEMO_API = (function () {
  var KEY = 'nails2_demo';
  var cfg = CORE.parseSettings({ 'Назва': 'Запис до майстра', 'Підзаголовок': 'Оберіть майстра, послуги та зручний час' });

  // Начальные данные — в том же виде, что строки Google Таблицы
  var SEED = {
    masters: [
      ['m1', 'Марія', 'Топ-майстер', '1,2,3,4,5', '10:00', '19:00', '14:00', '15:00', 'demo-cal', 'maria@example.com', '+380501112233', '@maria_nails', '', 'так', 's1,s2,s3,s6,s5'],
      ['m2', 'Олена', 'Майстер манікюру й педикюру', '2,3,4,5,6', '11:00', '20:00', '', '', 'demo-cal', '', '', '', '', 'так', ''],
      ['m3', 'Ірина', 'Майстер педикюру', '1,3,5,6', '09:00', '17:00', '13:00', '14:00', 'demo-cal', 'iryna@example.com', '', '', '', 'так', 's4,s7,s5'],
      ['m4', 'Софія', 'Стажист (у відпустці)', '1,2,3', '10:00', '18:00', '', '', 'demo-cal', '', '', '', '', 'ні', 's1']
    ],
    services: [
      ['s1', 'Манікюр класичний', '60', '450', 'так', 'Манікюр'],
      ['s2', 'Манікюр + гель-лак', '120', '700', 'так', 'Манікюр'],
      ['s3', 'Нарощування', '150', '1100', 'так', 'Манікюр'],
      ['s6', 'Дизайн (1 палець)', '15', '40', 'так', 'Манікюр'],
      ['s4', 'Педикюр', '90', '700', 'так', 'Педикюр'],
      ['s7', 'Педикюр + гель-лак', '120', '900', 'так', 'Педикюр'],
      ['s5', 'Зняття покриття', '30', '150', 'так', 'Інше']
    ],
    bookings: [],
    outbox: []
  };

  function load() {
    try { var d = JSON.parse(localStorage.getItem(KEY)); if (d && d.masters && d.services) return d; } catch (e) { /* пусто или испорчено */ }
    return JSON.parse(JSON.stringify(SEED));
  }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* нет места/запрещено */ } }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function nowLocal() {
    var d = new Date();
    return { day: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()), min: d.getHours() * 60 + d.getMinutes() };
  }
  function stamp() { var d = new Date(); return nowLocal().day + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function hash(str) { var h = 7; for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return h; }
  function later(v) { return new Promise(function (res) { setTimeout(function () { res(v); }, 200); }); }

  /** «Чужие» записи, чтобы календарь выглядел живым: 1–3 занятых блока на мастера в день. */
  function fakeBusy(masterId, day) {
    var h = hash(masterId + day), out = [], n = 1 + (h % 3);
    for (var k = 0; k < n; k++) {
      var s = 600 + ((h >> (k * 4 + 3)) % 16) * 30, len = (k % 2 ? 90 : 60);
      out.push({ s: s, e: s + len });
    }
    return out;
  }
  function busyFor(d, masterId, day) {
    var out = fakeBusy(masterId, day);
    d.bookings.forEach(function (b) { if (b.status === 'Записано' && b.master === masterId && b.day === day) out.push({ s: CORE.hm(b.time, 0), e: CORE.hm(b.time, 0) + b.durationMin }); });
    return out;
  }
  function busyOnDay(d, masters, day) { var o = {}; masters.forEach(function (m) { o[m.id] = busyFor(d, m.id, day); }); return o; }
  function getMasters(d) { return CORE.parseMasters(d.masters); }
  function getServices(d, all) { return CORE.parseServices(d.services, all); }
  function find(rows, id) { for (var i = 0; i < rows.length; i++) if (rows[i][0] === id) return i; return -1; }
  function newId(p) { return p + Date.now().toString(36); }

  var admin = {
    login: function (password) { return later(password === 'demo' ? { ok: true, token: 'demo-token' } : { ok: false, error: 'BAD_PASSWORD' }); },
    logout: function () { return later({ ok: true }); },
    data: function () {
      var d = load(), now = nowLocal().day;
      var bookings = d.bookings.filter(function (b) { return b.day >= now; }).sort(function (a, b) { return (a.day + a.time) < (b.day + b.time) ? -1 : 1; }).map(function (b) {
        return { token: b.token, when: b.day + ' ' + b.time, client: b.client, phone: b.phone, email: b.email, service: b.service, master: b.masterName, comment: b.comment || '', status: b.status };
      });
      return later({ ok: true, demo: true, masters: getMasters(d), services: getServices(d, true), bookings: bookings, outbox: d.outbox.slice(-30).reverse() });
    },
    saveMaster: function (p) {
      var d = load(), v = CORE.validateMaster(p, getServices(d, true).map(function (s) { return s.id; }));
      if (!v.ok) return later({ ok: false, error: 'VALIDATION', fields: v.errors });
      var i = p.id ? find(d.masters, p.id) : -1;
      if (p.id && i < 0) return later({ ok: false, error: 'NOT_FOUND' });
      var old = i >= 0 ? getMasters(d)[i] : null;
      var m = Object.assign({ id: p.id || newId('m'), calendarId: 'demo-cal', photo: old ? old.photo : '' }, v.clean);
      if (old && old.email !== m.email) {
        // как на настоящем сервере: почту поменяли → будущие записи мастера «переподписываются»
        var future = d.bookings.filter(function (b) { return b.master === m.id && b.status === 'Записано'; }).length;
        if (old.email) d.outbox.push({ at: stamp(), to: old.email, text: 'Мастера прибрано з ' + future + ' майбутніх подій календаря (розсилку вимкнено)' });
        if (m.email) d.outbox.push({ at: stamp(), to: m.email, text: 'Мастера додано в ' + future + ' майбутніх подій календаря (запрошення)' });
      }
      if (!old && m.email) d.outbox.push({ at: stamp(), to: m.email, text: 'Нового мастера підключено до сповіщень' });
      var row = CORE.masterRow(m);
      if (i >= 0) d.masters[i] = row; else d.masters.push(row);
      save(d);
      return later({ ok: true, id: m.id });
    },
    saveService: function (p) {
      var d = load(), v = CORE.validateService(p);
      if (!v.ok) return later({ ok: false, error: 'VALIDATION', fields: v.errors });
      var i = p.id ? find(d.services, p.id) : -1;
      if (p.id && i < 0) return later({ ok: false, error: 'NOT_FOUND' });
      var row = CORE.serviceRow(Object.assign({ id: p.id || newId('s') }, v.clean));
      if (i >= 0) d.services[i] = row; else d.services.push(row);
      save(d);
      return later({ ok: true, id: row[0] });
    },
    photo: function (masterId, dataUrl, remove) {
      var d = load(), i = find(d.masters, masterId);
      if (i < 0) return later({ ok: false, error: 'NOT_FOUND' });
      if (!remove && !/^data:image\/(jpeg|png|webp);base64,/.test(String(dataUrl || ''))) return later({ ok: false, error: 'BAD_IMAGE' });
      d.masters[i][12] = remove ? '' : dataUrl;
      save(d);
      return later({ ok: true, photo: d.masters[i][12] });
    },
    cancel: function (token) {
      var d = load(), b = d.bookings.filter(function (x) { return x.token === token && x.status === 'Записано'; })[0];
      if (!b) return later({ ok: false, error: 'NOT_FOUND' });
      b.status = 'Скасовано';
      if (b.email) d.outbox.push({ at: stamp(), to: b.email, text: 'Ваш запис скасовано: ' + b.day + ' ' + b.time });
      save(d);
      return later({ ok: true });
    },
    reset: function () { try { localStorage.removeItem(KEY); } catch (e) { /* ничего */ } return later({ ok: true }); }
  };

  return {
    admin: admin,
    config: function () {
      var d = load();
      return later({ ok: true, accepting: true, title: cfg.title, subtitle: cfg.subtitle, services: getServices(d), masters: CORE.publicMasters(getMasters(d)) });
    },
    overview: function () {
      var d = load(), now = nowLocal(), days = CORE.availableDays(cfg, now), services = getServices(d), out = {};
      CORE.activeMasters(getMasters(d)).forEach(function (m) {
        var list = CORE.servicesFor(services, m);
        if (!list.length) { out[m.id] = []; return; }
        var dur = Math.min.apply(null, list.map(function (s) { return s.durationMin; })), busy = {};
        days.forEach(function (day) { busy[day] = busyFor(d, m.id, day); });
        out[m.id] = CORE.nearestSlots(m, cfg, dur, days, busy, now, 3);
      });
      return later({ ok: true, nearest: out });
    },
    slots: function (serviceId, masterId) {
      var d = load(), sv = CORE.combineServices(getServices(d), serviceId), now = nowLocal(), out = {};
      if (!sv) return later({ ok: false, error: 'VALIDATION' });
      var masters = CORE.eligibleMasters(getMasters(d), sv.ids);
      if (masterId !== 'any' && !masters.some(function (m) { return m.id === masterId; })) return later({ ok: false, error: 'VALIDATION' });
      CORE.availableDays(cfg, now).forEach(function (day) {
        out[day] = CORE.freeTimes(masters, cfg, sv.durationMin, day, busyOnDay(d, masters, day), now, masterId);
      });
      return later({ ok: true, accepting: true, days: out });
    },
    book: function (p) {
      var v = CORE.validateClient(p);
      if (!v.ok) return later({ ok: false, error: 'VALIDATION', fields: v.errors });
      var d = load(), sv = CORE.combineServices(getServices(d), p.service), now = nowLocal();
      if (!sv || !CORE.validDay(p.day)) return later({ ok: false, error: 'TAKEN' });
      var masters = CORE.eligibleMasters(getMasters(d), sv.ids);
      var id = CORE.pickMaster(masters, cfg, sv.durationMin, p.day, p.time, busyOnDay(d, masters, p.day), now, p.master || 'any');
      if (!id) return later({ ok: false, error: 'TAKEN' });
      var m = masters.filter(function (x) { return x.id === id; })[0];
      var token = 'demo-' + Math.random().toString(16).slice(2) + Date.now().toString(16), c = v.clean;
      d.bookings.push({ token: token, master: id, masterName: m.name, day: p.day, time: p.time, durationMin: sv.durationMin, service: sv.name, status: 'Записано', client: c.name, phone: c.phone, email: c.email, comment: c.comment });
      // как на настоящем сервере: есть почта мастера → запрошення в календар; є пошта клієнта → лист-підтвердження
      if (m.email) d.outbox.push({ at: stamp(), to: m.email, text: 'Запрошення в календар: ' + sv.name + ', ' + p.day + ' ' + p.time });
      if (c.email) d.outbox.push({ at: stamp(), to: c.email, text: 'Ви записані: ' + p.day + ' ' + p.time });
      save(d);
      return later({ ok: true, booking: { token: token, day: p.day, time: p.time, service: sv.name, master: m.name } });
    },
    booking: function (token) {
      var b = load().bookings.filter(function (x) { return x.token === token; })[0];
      if (!b) return later({ ok: false, error: 'NOT_FOUND' });
      return later({ ok: true, status: b.status, day: b.day, time: b.time, service: b.service, master: b.masterName });
    },
    cancel: function (token) { return admin.cancel(token); }
  };
})();
