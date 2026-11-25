/**
 * Code.gs — «кухня» версии 2: запись на манікюр + админ-панель менеджера.
 * Скрипт привязан к Google Таблице («Розширення → Apps Script»).
 * Правда о занятом времени — в Google Календарях мастеров (по одному на мастера).
 * Профили мастеров и услуги менеджер правит в админ-панели на сайте; сервер записывает их в Таблицу.
 * Первый запуск: выполнить setup() (см. README.md) — в журнале появится пароль админки.
 */

var SHEET_BOOK = 'Записи';
var SHEET_ATT = 'Спроби';
var SHEET_SET = 'Налаштування';
var SHEET_MASTERS = 'Майстри';
var SHEET_SERVICES = 'Послуги';

var BOOK_HEADERS = ['Коли подано', 'Клієнт', 'Телефон', 'Пошта', 'Послуга', 'Майстер', 'Запис', 'Тривалість, хв', 'Ціна, ₴', 'Коментар', 'Статус', 'Токен', 'ID події', 'ID майстра'];
var ATT_HEADERS = ['Коли', 'Телефон', 'Клієнт', 'Слот', 'Результат'];
var MASTER_HEADERS = ['ID', 'Ім’я', 'Спеціальність', 'Робочі дні (1=пн … 7=нд)', 'Початок дня', 'Кінець дня', 'Обід з', 'Обід до', 'ID календаря (само)', 'Пошта', 'Телефон', 'Telegram', 'Фото (посилання)', 'Активний (так/ні)', 'Послуги (id через кому; пусто = усі)'];
var SERVICE_HEADERS = ['ID', 'Назва', 'Тривалість, хв', 'Ціна, ₴', 'Показувати (так/ні)', 'Категорія'];

var SETTINGS_ROWS = [
  ['Прийом записів', 'так', 'Поставте «ні», щоб закрити запис на сайті'],
  ['Назва', 'Запис до майстра', 'Заголовок на сайті'],
  ['Підзаголовок', 'Оберіть послуги, майстра та зручний час', ''],
  ['Крок записів, хв', '30', 'Сітка часу: 10:00, 10:30, 11:00 …'],
  ['Не раніше ніж через, год', '2', 'Не можна записатися «на за 5 хвилин»'],
  ['Днів уперед', '30', ''],
  ['Ліміт записів на добу', '40', 'Захист від флуду'],
  ['Пошта власника', '', 'Сюди приходять сповіщення про нові записи й скасування'],
  ['Адреса сайту', '', 'Потрібна для посилання «скасувати запис» у листі клієнту'],
  ['Зберігати дані, міс.', '12', 'Старі рядки видаляються автоматично']
];
var MASTER_ROWS = [
  ['m1', 'Марія', 'Топ-майстер', '1,2,3,4,5', '10:00', '19:00', '14:00', '15:00', '', '', '', '', '', 'так', ''],
  ['m2', 'Олена', 'Майстер манікюру', '2,3,4,5,6', '11:00', '20:00', '', '', '', '', '', '', '', 'так', '']
];
var SERVICE_ROWS = [
  ['s1', 'Манікюр класичний', '60', '450', 'так', 'Манікюр'],
  ['s2', 'Манікюр + гель-лак', '120', '700', 'так', 'Манікюр'],
  ['s3', 'Нарощування', '150', '1100', 'так', 'Манікюр'],
  ['s4', 'Педикюр', '90', '700', 'так', 'Педикюр'],
  ['s5', 'Зняття покриття', '30', '150', 'так', 'Інше']
];

/* ---------- Запуск и обслуживание ---------- */

/** Одноразово: создаёт листы, календари мастеров, пароль админки и ежедневную очистку старых данных. */
function setup() {
  var ss = ss_();
  ensureSheet_(ss, SHEET_BOOK, BOOK_HEADERS).getRange('A:N').setNumberFormat('@');
  ensureSheet_(ss, SHEET_ATT, ATT_HEADERS).getRange('A:E').setNumberFormat('@');
  fillIfNew_(ss, SHEET_SET, ['Налаштування', 'Значення', 'Пояснення'], SETTINGS_ROWS, 'B:B');
  fillIfNew_(ss, SHEET_MASTERS, MASTER_HEADERS, MASTER_ROWS, 'A:O');
  fillIfNew_(ss, SHEET_SERVICES, SERVICE_HEADERS, SERVICE_ROWS, 'A:F');
  createMasterCalendars();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'cleanupOld') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('cleanupOld').timeBased().everyDays(1).atHour(3).create();
  if (!PropertiesService.getScriptProperties().getProperty('ADMIN_HASH')) resetAdminPassword();
  else Logger.log('Пароль адмінки вже є. Щоб отримати новий — запустіть resetAdminPassword().');
  Logger.log('Готово. Листи створено, календарі майстрів готові.');
}

/** Для каждого мастера без календаря создаёт свой Google Календарь и записывает его id в таблицу (колонка I). */
function createMasterCalendars() {
  var sh = ss_().getSheetByName(SHEET_MASTERS);
  if (sh.getLastRow() < 2) return;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 15).getValues();
  rows.forEach(function (r, i) {
    if (!r[0] || !r[1] || r[8]) return;
    var cal = CalendarApp.createCalendar('Манікюр: ' + r[1]);
    sh.getRange(i + 2, 9).setValue(cal.getId());
    Logger.log('Календар для «%s» створено', r[1]);
  });
}

function fillIfNew_(ss, name, headers, rows, textCols) {
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name);
  sh.getRange(textCols).setNumberFormat('@');   // сначала текстовый формат, иначе «10:00» станет временем
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, headers.length);
  return sh;
}
function ensureSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Удаляет строки старше срока хранения (персональные данные). Запускается по таймеру раз в сутки. */
function cleanupOld() {
  var cfg = getSettings_(true);
  var cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - cfg.retentionMonths);
  var cutoffStr = Utilities.formatDate(cutoff, tz_(), 'yyyy-MM-dd HH:mm');
  [SHEET_BOOK, SHEET_ATT].forEach(function (name) {
    var sh = ss_().getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = vals.length - 1; i >= 0; i--) {
      var v = String(vals[i][0]);
      if (v && v < cutoffStr) sh.deleteRow(i + 2);
    }
  });
}

/** Проверка уведомлений: отправляет тестовое письмо владельцу. */
function testMail() {
  var to = getSettings_(true).ownerEmail;
  if (!to) { Logger.log('В «Налаштування» не заповнена «Пошта власника».'); return; }
  MailApp.sendEmail(to, 'Перевірка сповіщень', 'Якщо ви бачите цей лист, сповіщення про записи працюють.');
  Logger.log('Лист надіслано: ' + to + '. Залишок листів на сьогодні: ' + MailApp.getRemainingDailyQuota());
}

/* ---------- Пароль админки ---------- */

/** Создаёт НОВЫЙ случайный пароль админки и показывает его в журнале (в таблице и на сайте его нет, хранится только «отпечаток»). */
function resetAdminPassword() {
  var chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', pw = '';
  for (var i = 0; i < 12; i++) pw += chars.charAt(Math.floor(Math.random() * chars.length));
  storeAdminPassword_(pw);
  Logger.log('ПАРОЛЬ АДМІНКИ: ' + pw + '  (збережіть у менеджері паролів; щоб змінити — resetAdminPassword() ще раз)');
}
/** Свой пароль: в «Налаштування проєкту → Властивості скрипта» додайте NEW_ADMIN_PASSWORD (від 10 символів) і запустіть цю функцію. */
function setAdminPassword() {
  var props = PropertiesService.getScriptProperties(), pw = props.getProperty('NEW_ADMIN_PASSWORD');
  if (!pw || pw.length < 10) { Logger.log('Додайте властивість NEW_ADMIN_PASSWORD (мінімум 10 символів).'); return; }
  storeAdminPassword_(pw);
  props.deleteProperty('NEW_ADMIN_PASSWORD');   // открытый пароль после запуска не храним
  Logger.log('Пароль адмінки змінено.');
}
function storeAdminPassword_(pw) {
  var props = PropertiesService.getScriptProperties(), salt = Utilities.getUuid();
  props.setProperties({ ADMIN_SALT: salt, ADMIN_HASH: hashPw_(pw, salt) });
  CacheService.getScriptCache().remove('loginFails');
}
function hashPw_(pw, salt) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pw, Utilities.Charset.UTF_8));
}
function sameStr_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ---------- Вспомогательное ---------- */

function ss_() {
  var a = SpreadsheetApp.getActiveSpreadsheet();
  if (a) return a;
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('Не задано властивість скрипта SHEET_ID (id таблиці)');
  return SpreadsheetApp.openById(id);
}
function tz_() { return Session.getScriptTimeZone(); }
function txt_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm');
  return String(v === undefined || v === null ? '' : v);
}
function cellText_(v) {
  // время в ячейке иногда становится датой: возвращаем как «HH:mm»
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'HH:mm');
  return String(v === undefined || v === null ? '' : v);
}
function appendRowText_(sh, row) {
  var rg = sh.getRange(sh.getLastRow() + 1, 1, 1, row.length);
  rg.setNumberFormat('@');
  rg.setValues([row]);
}
function writeRowText_(sh, rowIndex, row) {
  var rg = sh.getRange(rowIndex, 1, 1, row.length);
  rg.setNumberFormat('@');
  rg.setValues([row]);
}
function nowStr_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm'); }
function nowLocal_() {
  var d = new Date();
  var p = Utilities.formatDate(d, tz_(), 'HH:mm').split(':');
  return { day: Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'), min: Number(p[0]) * 60 + Number(p[1]) };
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function parseDt_(day, hm) { return Utilities.parseDate(day + ' ' + hm, tz_(), 'yyyy-MM-dd HH:mm'); }

/** Читает лист целиком (без заголовка) как массив строк; ячейки-времена приводит к тексту. */
function rows_(name, cols) {
  var sh = ss_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, cols).getValues().map(function (r) { return r.map(function (v) { return v instanceof Date ? cellText_(v) : v; }); });
}
/** Номер строки (в листе) с таким id в первой колонке или 0. */
function rowOfId_(sh, id) {
  if (sh.getLastRow() < 2) return 0;
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return 0;
}

function getSettings_(fresh) {
  var cache = CacheService.getScriptCache(), raw = fresh ? null : cache.get('settings'), map;
  if (raw) { map = JSON.parse(raw); }
  else {
    map = {};
    rows_(SHEET_SET, 2).forEach(function (r) { map[String(r[0]).trim()] = String(r[1]); });
    cache.put('settings', JSON.stringify(map), 60);
  }
  return CORE.parseSettings(map);
}
function getMasters_() { return CORE.parseMasters(rows_(SHEET_MASTERS, 15)); }               // все, включая отключённых
function getServices_(includeHidden) { return CORE.parseServices(rows_(SHEET_SERVICES, 6), includeHidden); }

function calendarOf_(master) {
  var cal = master.calendarId ? CalendarApp.getCalendarById(master.calendarId) : null;
  if (!cal) throw new Error('Календар майстра «' + master.name + '» не знайдено: запустіть setup()');
  return cal;
}

/** Занятые интервалы мастера по дням: { 'YYYY-MM-DD': [{s,e}] }. Событие любой длины закрывает время. */
function busyByDay_(master, fromDay, toDay) {
  var res = {};
  var start = parseDt_(fromDay, '00:00'), end = parseDt_(CORE.addDays(toDay, 1), '00:00');
  calendarOf_(master).getEvents(start, end).forEach(function (ev) {
    var s = ev.getStartTime(), e = ev.getEndTime();
    var d = Utilities.formatDate(s, tz_(), 'yyyy-MM-dd');
    var lastDay = Utilities.formatDate(new Date(e.getTime() - 1), tz_(), 'yyyy-MM-dd');
    var guard = 0;
    while (d <= lastDay && guard++ < 40) {
      var ds = parseDt_(d, '00:00'), de = parseDt_(CORE.addDays(d, 1), '00:00');
      var cs = Math.max(s.getTime(), ds.getTime()), ce = Math.min(e.getTime(), de.getTime());
      if (ev.isAllDayEvent()) { cs = ds.getTime(); ce = de.getTime(); }
      (res[d] = res[d] || []).push({ s: Math.round((cs - ds.getTime()) / 60000), e: Math.round((ce - ds.getTime()) / 60000) });
      d = CORE.addDays(d, 1);
    }
  });
  return res;
}

/** Занятость мастеров: { masterId: { day: [{s,e}] } }. */
function allBusy_(masters, fromDay, toDay) {
  var out = {};
  masters.forEach(function (m) { out[m.id] = busyByDay_(m, fromDay, toDay); });
  return out;
}
function busyOnDay_(all, day) {
  var o = {};
  for (var id in all) o[id] = all[id][day] || [];
  return o;
}

/* ---------- Таблица: записи ---------- */

function bookSheet_() { return ss_().getSheetByName(SHEET_BOOK); }
function attSheet_() { return ss_().getSheetByName(SHEET_ATT); }
function lastRows_(sh, n) {
  var last = sh.getLastRow();
  if (last < 2) return { first: 2, rows: [] };
  var first = Math.max(2, last - n + 1);
  return { first: first, rows: sh.getRange(first, 1, last - first + 1, sh.getLastColumn()).getValues() };
}
function digits_(v) { return String(v === undefined || v === null ? '' : v).replace(/\D/g, ''); }
function activeCountFor_(phone) {
  var cur = nowStr_(), n = 0;
  lastRows_(bookSheet_(), 1000).rows.forEach(function (r) {
    if (r[10] === 'Записано' && txt_(r[6]) >= cur && digits_(r[2]) === digits_(phone)) n++;
  });
  return n;
}
function recentAttempts_(phone) {
  var since = Utilities.formatDate(new Date(Date.now() - 24 * 3600 * 1000), tz_(), 'yyyy-MM-dd HH:mm'), n = 0;
  lastRows_(attSheet_(), 1000).rows.forEach(function (r) {
    if (digits_(r[1]) === digits_(phone) && txt_(r[0]) >= since) n++;
  });
  return n;
}
function logAttempt_(c, slot, result) {
  appendRowText_(attSheet_(), [nowStr_(), c.phone, CORE.sanitizeCell(c.name), slot, result]);
}
function todaysBookings_() {
  var today = nowStr_().slice(0, 10);
  return lastRows_(bookSheet_(), 500).rows.filter(function (r) { return txt_(r[0]).slice(0, 10) === today; }).length;
}

/* ---------- Защита ---------- */

function rateLimited_() {
  var cache = CacheService.getScriptCache();
  var key = 'rl_' + Utilities.formatDate(new Date(), tz_(), 'yyyyMMddHHmm');
  var n = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(n), 120);
  return n > 40;   // не больше 40 записей в минуту на весь сайт
}

function mail_(to, subject, lines) {
  if (!to) return;
  try { MailApp.sendEmail({ to: to, subject: subject, body: lines.join('\n') }); } catch (e) { Logger.log('Лист не надіслано: ' + e); }
}

/* ---------- API ---------- */

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.action === 'config') return json_(apiConfig_());
    if (p.action === 'overview') return json_(apiOverview_());
    if (p.action === 'slots') return json_(apiSlots_(p));
    if (p.action === 'booking') return json_(apiBooking_(p.token));
    return json_({ ok: false, error: 'UNKNOWN_ACTION' });
  } catch (err) { Logger.log(err); return json_({ ok: false, error: 'SERVER' }); }
}

function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    if (p.action === 'book') return json_(apiBook_(p));
    if (p.action === 'cancel') return json_(apiCancel_(p.token));
    if (p.action === 'adminLogin') return json_(apiAdminLogin_(p));
    if (String(p.action).indexOf('admin') === 0) {
      if (!adminAuthed_(p.token)) return json_({ ok: false, error: 'AUTH' });   // все админ-действия — только с действующим токеном
      if (p.action === 'adminLogout') { CacheService.getScriptCache().remove('sess_' + p.token); return json_({ ok: true }); }
      if (p.action === 'adminData') return json_(apiAdminData_());
      if (p.action === 'adminSaveMaster') return json_(apiAdminSaveMaster_(p.master || {}));
      if (p.action === 'adminSaveService') return json_(apiAdminSaveService_(p.service || {}));
      if (p.action === 'adminPhoto') return json_(apiAdminPhoto_(p));
      if (p.action === 'adminCancel') return json_(apiAdminCancel_(p.bookingToken));
    }
    return json_({ ok: false, error: 'UNKNOWN_ACTION' });
  } catch (err) { Logger.log(err); return json_({ ok: false, error: 'SERVER' }); }
}

function apiConfig_() {
  var cfg = getSettings_();
  return { ok: true, accepting: cfg.accepting, title: cfg.title, subtitle: cfg.subtitle, services: getServices_(), masters: CORE.publicMasters(getMasters_()) };
}

/** Ближайшие свободные окна каждого мастера (для карточек): считаем по самой короткой услуге мастера. */
function apiOverview_() {
  var cfg = getSettings_();
  if (!cfg.accepting) return { ok: true, nearest: {} };
  var cache = CacheService.getScriptCache(), key = 'ov_' + slotsVersion_(), cached = cache.get(key);
  if (cached) return JSON.parse(cached);
  var services = getServices_(), masters = CORE.activeMasters(getMasters_()), now = nowLocal_(), days = CORE.availableDays(cfg, now), out = {};
  masters.forEach(function (m) {
    var list = CORE.servicesFor(services, m);
    if (!list.length) { out[m.id] = []; return; }
    var dur = Math.min.apply(null, list.map(function (s) { return s.durationMin; }));
    out[m.id] = CORE.nearestSlots(m, cfg, dur, days, busyByDay_(m, days[0], days[days.length - 1]), now, 3);
  });
  var res = { ok: true, nearest: out };
  cache.put(key, JSON.stringify(res), 30);
  return res;
}

/** Свободное время на все дни вперёд для пары «услуги + мастер (или любой из тех, кто их делает)». */
function apiSlots_(p) {
  var cfg = getSettings_();
  if (!cfg.accepting) return { ok: true, accepting: false, days: {} };
  var service = CORE.combineServices(getServices_(), p.service);   // можно несколько услуг сразу: 's1,s3'
  if (!service) return { ok: false, error: 'VALIDATION' };
  var masterId = String(p.master || 'any');
  var cacheKey = 'slots_' + slotsVersion_() + '_' + service.ids + '_' + masterId, cache = CacheService.getScriptCache(), cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);
  var masters = CORE.eligibleMasters(getMasters_(), service.ids);   // только активные и умеющие ВСЕ выбранные услуги
  if (masterId !== 'any' && !masters.some(function (m) { return m.id === masterId; })) return { ok: false, error: 'VALIDATION' };
  var now = nowLocal_(), days = CORE.availableDays(cfg, now);
  var all = allBusy_(masters, days[0], days[days.length - 1]), out = {};
  days.forEach(function (d) { out[d] = CORE.freeTimes(masters, cfg, service.durationMin, d, busyOnDay_(all, d), now, masterId); });
  var res = { ok: true, accepting: true, days: out };
  cache.put(cacheKey, JSON.stringify(res), 20);
  return res;
}
/** Кеш свободного времени «протухает» сам за 20 секунд; после записи/отмены/правки профиля меняем номер версии, и все старые ответы перестают подходить. */
function slotsVersion_() { return CacheService.getScriptCache().get('slotsVer') || '0'; }
function clearSlotsCache_() { CacheService.getScriptCache().put('slotsVer', String(Date.now()), 600); }

function apiBooking_(token) {
  token = String(token || '');
  if (!/^[0-9a-f-]{36}$/.test(token)) return { ok: false, error: 'NOT_FOUND' };
  var rows = lastRows_(bookSheet_(), 2000).rows;
  for (var i = rows.length - 1; i >= 0; i--) {
    if (rows[i][11] === token) {
      var when = txt_(rows[i][6]);
      return { ok: true, status: rows[i][10], day: when.slice(0, 10), time: when.slice(11, 16), service: rows[i][4], master: rows[i][5], past: when < nowStr_() };
    }
  }
  return { ok: false, error: 'NOT_FOUND' };
}

function fakeBooking_(day, time, service, masterName) {
  return { ok: true, booking: { token: Utilities.getUuid(), day: day, time: time, service: service.name, master: masterName } };
}

function apiBook_(p) {
  var cfg = getSettings_(true);
  if (!cfg.accepting) return { ok: false, error: 'CLOSED' };
  var v = CORE.validateClient(p);
  if (!v.ok) return { ok: false, error: 'VALIDATION', fields: v.errors };
  var c = v.clean, day = String(p.day || ''), time = String(p.time || ''), service = CORE.combineServices(getServices_(), p.service);
  if (!service || !CORE.validDay(day) || !/^\d{2}:\d{2}$/.test(time)) return { ok: false, error: 'TAKEN' };
  if (p.website) return fakeBooking_(day, time, service, '');                // скрытое поле: так заполняют только боты
  if (!(Number(p.elapsedMs) >= 3000)) return fakeBooking_(day, time, service, '');   // форма заполнена быстрее 3 секунд
  if (rateLimited_()) return { ok: false, error: 'BUSY' };

  var lock = LockService.getScriptLock();    // «замок»: пока обрабатывается одна запись, вторая ждёт
  if (!lock.tryLock(20000)) return { ok: false, error: 'BUSY' };
  try {
    var slotLabel = day + ' ' + time, decision = CORE.decideAttempt(activeCountFor_(c.phone), recentAttempts_(c.phone));
    if (decision === 'shadow') { logAttempt_(c, slotLabel, 'Тихий режим'); return fakeBooking_(day, time, service, ''); }
    if (decision === 'limit') { logAttempt_(c, slotLabel, 'Забагато записів'); return { ok: false, error: 'LIMIT' }; }
    if (todaysBookings_() >= cfg.dailyCap) { logAttempt_(c, slotLabel, 'Ліміт на добу'); return { ok: false, error: 'CAP' }; }

    // самое важное: время ЗАНОВО проверяем по календарям, без кеша; мастер — только активный и умеющий все услуги
    var masters = CORE.eligibleMasters(getMasters_(), service.ids), now = nowLocal_();
    var all = allBusy_(masters, day, day);
    var masterId = CORE.pickMaster(masters, cfg, service.durationMin, day, time, busyOnDay_(all, day), now, String(p.master || 'any'));
    if (!masterId) { logAttempt_(c, slotLabel, 'Час зайнятий'); return { ok: false, error: 'TAKEN' }; }
    var master = masters.filter(function (m) { return m.id === masterId; })[0];

    var start = parseDt_(day, time), end = new Date(start.getTime() + service.durationMin * 60000);
    var desc = ['Послуга: ' + service.name + ' (' + service.price + ' ₴)', 'Клієнт: ' + c.name, 'Телефон: ' + CORE.formatPhone(c.phone)];
    if (c.email) desc.push('Пошта: ' + c.email);
    if (c.comment) desc.push('Коментар: ' + c.comment);

    // Є пошта майстра → додаємо його гостем події: Google сам надішле запрошення і подія з'явиться в його календарі.
    // Якщо запрошення не вдалося — створюємо подію без гостя і шлемо звичайний лист.
    var cal = calendarOf_(master), ev, invited = false, title = service.name + ' · ' + c.name;
    if (master.email) {
      try { ev = cal.createEvent(title, start, end, { description: desc.join('\n'), guests: master.email, sendInvites: true }); invited = true; }
      catch (e) { Logger.log('Запрошення не вдалося: ' + e); }
    }
    if (!ev) ev = cal.createEvent(title, start, end, { description: desc.join('\n') });

    var token = Utilities.getUuid();
    appendRowText_(bookSheet_(), [nowStr_(), CORE.sanitizeCell(c.name), c.phone, CORE.sanitizeCell(c.email), service.name, master.name, slotLabel, String(service.durationMin), String(service.price), CORE.sanitizeCell(c.comment), 'Записано', token, ev.getId(), master.id]);
    logAttempt_(c, slotLabel, 'Записано');
    clearSlotsCache_();

    var cancelUrl = cfg.siteUrl ? cfg.siteUrl.replace(/\/?$/, '/') + '?cancel=' + token : '';
    mail_(cfg.ownerEmail, 'Новий запис: ' + c.name + ', ' + slotLabel, ['Майстер: ' + master.name].concat(desc));
    if (master.email && !invited) mail_(master.email, 'Новий запис: ' + slotLabel, desc);
    mail_(c.email, 'Ви записані: ' + slotLabel, ['Дякуємо, ' + c.name + '!', service.name + ', майстер ' + master.name + ', ' + slotLabel + '.'].concat(cancelUrl ? ['', 'Скасувати запис: ' + cancelUrl] : []));
    return { ok: true, booking: { token: token, day: day, time: time, service: service.name, master: master.name } };
  } finally { lock.releaseLock(); }
}

/** Отмена записи. who: 'client' (по ссылке) или 'admin' (из панели). */
function cancelBooking_(token, who) {
  token = String(token || '');
  if (!/^[0-9a-f-]{36}$/.test(token)) return { ok: false, error: 'NOT_FOUND' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'BUSY' };
  try {
    var sh = bookSheet_(), got = lastRows_(sh, 2000), masters = getMasters_();
    for (var i = got.rows.length - 1; i >= 0; i--) {
      var r = got.rows[i];
      if (r[11] !== token) continue;
      if (r[10] !== 'Записано') return { ok: false, error: 'NOT_FOUND' };
      var m = masters.filter(function (x) { return x.id === String(r[13]); })[0];
      try { if (m) { var ev = calendarOf_(m).getEventById(String(r[12])); if (ev) ev.deleteEvent(); } } catch (e) { Logger.log('Не вдалося видалити подію: ' + e); }
      sh.getRange(got.first + i, 11).setValue('Скасовано');
      clearSlotsCache_();
      var cfg = getSettings_();
      if (who === 'admin') mail_(String(r[3]), 'Ваш запис скасовано: ' + txt_(r[6]), ['Вибачте, ми змушені скасувати запис (' + r[4] + ', ' + r[5] + ', ' + txt_(r[6]) + ').', 'Зателефонуйте нам, щоб обрати інший час.']);
      else mail_(cfg.ownerEmail, 'Скасування запису: ' + r[1] + ', ' + txt_(r[6]), ['Клієнт сам скасував запис (' + r[4] + ', ' + r[5] + '). Подію видалено з календаря.']);
      return { ok: true };
    }
    return { ok: false, error: 'NOT_FOUND' };
  } finally { lock.releaseLock(); }
}
function apiCancel_(token) { return cancelBooking_(token, 'client'); }
function apiAdminCancel_(token) { return cancelBooking_(token, 'admin'); }

/* ---------- Админка ---------- */

function apiAdminLogin_(p) {
  var cache = CacheService.getScriptCache(), props = PropertiesService.getScriptProperties();
  var fails = Number(cache.get('loginFails') || 0);
  if (fails >= 5) return { ok: false, error: 'LOCKED' };          // защита от подбора пароля: 5 неудач — пауза 15 минут
  var hash = props.getProperty('ADMIN_HASH'), salt = props.getProperty('ADMIN_SALT');
  if (!hash) return { ok: false, error: 'NO_PASSWORD' };
  if (!sameStr_(hashPw_(String(p.password || ''), salt), hash)) {
    cache.put('loginFails', String(fails + 1), 900);
    Utilities.sleep(700);
    return { ok: false, error: 'BAD_PASSWORD' };
  }
  cache.remove('loginFails');
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  cache.put('sess_' + token, '1', 21600);                           // сессия живёт 6 часов (максимум кеша Google)
  return { ok: true, token: token };
}
function adminAuthed_(token) {
  token = String(token || '');
  return /^[0-9a-f]{64}$/.test(token) && CacheService.getScriptCache().get('sess_' + token) === '1';
}

function apiAdminData_() {
  var now = nowStr_().slice(0, 10), masters = getMasters_();
  var bookings = lastRows_(bookSheet_(), 500).rows.map(function (r) {
    return { token: String(r[11]), when: txt_(r[6]), client: String(r[1]), phone: String(r[2]), email: String(r[3]), service: String(r[4]), master: String(r[5]), comment: String(r[9]), status: String(r[10]) };
  }).filter(function (b) { return b.when.slice(0, 10) >= now; }).sort(function (a, b) { return a.when < b.when ? -1 : 1; });
  return { ok: true, masters: masters.map(function (m) { return Object.assign({}, m, { hasCalendar: !!m.calendarId, calendarId: undefined }); }), services: getServices_(true), bookings: bookings };
}

function newId_(prefix) { return prefix + Date.now().toString(36); }

function apiAdminSaveMaster_(p) {
  var services = getServices_(true).map(function (s) { return s.id; });
  var v = CORE.validateMaster(p, services);
  if (!v.ok) return { ok: false, error: 'VALIDATION', fields: v.errors };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'BUSY' };
  try {
    var sh = ss_().getSheetByName(SHEET_MASTERS), id = String(p.id || ''), row = id ? rowOfId_(sh, id) : 0;
    if (id && !row) return { ok: false, error: 'NOT_FOUND' };
    var old = row ? CORE.parseMasters([sh.getRange(row, 1, 1, 15).getValues()[0].map(function (x) { return x instanceof Date ? cellText_(x) : x; })])[0] : null;
    var m = Object.assign({ id: id || newId_('m'), calendarId: old ? old.calendarId : '', photo: old ? old.photo : '' }, v.clean);
    if (!m.calendarId) m.calendarId = CalendarApp.createCalendar('Манікюр: ' + m.name).getId();   // новому мастеру — свой календарь
    var oldEmail = old ? old.email : '';
    // Почта изменилась → подписываем/отписываем мастера от будущих записей этого календаря.
    if (oldEmail !== m.email) syncGuests_(m, oldEmail, m.email);
    var data = CORE.masterRow(m);
    if (row) writeRowText_(sh, row, data); else appendRowText_(sh, data);
    clearSlotsCache_();
    return { ok: true, id: m.id };
  } finally { lock.releaseLock(); }
}

/** Будущие события календаря мастера: убрать старую почту из гостей, добавить новую. */
function syncGuests_(master, oldEmail, newEmail) {
  var res = { removed: 0, added: 0 };
  try {
    var from = new Date(), to = new Date(from.getTime() + 180 * 24 * 3600 * 1000);
    calendarOf_(master).getEvents(from, to).forEach(function (ev) {
      try { if (oldEmail) { ev.removeGuest(oldEmail); res.removed++; } } catch (e) { Logger.log('removeGuest: ' + e); }
      try { if (newEmail) { ev.addGuest(newEmail); res.added++; } } catch (e) { Logger.log('addGuest: ' + e); }
    });
  } catch (e) { Logger.log('syncGuests_: ' + e); }
  return res;
}

function apiAdminSaveService_(p) {
  var v = CORE.validateService(p);
  if (!v.ok) return { ok: false, error: 'VALIDATION', fields: v.errors };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'BUSY' };
  try {
    var sh = ss_().getSheetByName(SHEET_SERVICES), id = String(p.id || ''), row = id ? rowOfId_(sh, id) : 0;
    if (id && !row) return { ok: false, error: 'NOT_FOUND' };
    var s = Object.assign({ id: id || newId_('s') }, v.clean), data = CORE.serviceRow(s);
    if (row) writeRowText_(sh, row, data); else appendRowText_(sh, data);
    clearSlotsCache_();
    return { ok: true, id: s.id };
  } finally { lock.releaseLock(); }
}

/** Фото мастера: браузер уже уменьшил картинку до ~600 px; сохраняем в Google Диск (папка «Фото майстрів») и пишем ссылку в профиль. */
function apiAdminPhoto_(p) {
  var id = String(p.masterId || '');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'BUSY' };
  try {
    var sh = ss_().getSheetByName(SHEET_MASTERS), row = rowOfId_(sh, id);
    if (!row) return { ok: false, error: 'NOT_FOUND' };
    var cell = sh.getRange(row, 13), oldUrl = String(cell.getValue() || '');
    var url = '';
    if (!p.remove) {
      var m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+\/=]+)$/.exec(String(p.dataUrl || ''));
      if (!m || String(p.dataUrl).length > 900000) return { ok: false, error: 'BAD_IMAGE' };
      var ext = m[1] === 'image/png' ? 'png' : m[1] === 'image/webp' ? 'webp' : 'jpg';
      var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], 'master_' + id + '_' + Date.now() + '.' + ext);
      var file = photoFolder_().createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      url = 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w600';
    }
    var oldId = (/[?&]id=([\w-]+)/.exec(oldUrl) || [])[1];
    if (oldId) { try { DriveApp.getFileById(oldId).setTrashed(true); } catch (e) { Logger.log('Старе фото: ' + e); } }
    cell.setNumberFormat('@').setValue(url);
    return { ok: true, photo: url };
  } finally { lock.releaseLock(); }
}
function photoFolder_() {
  var props = PropertiesService.getScriptProperties(), fid = props.getProperty('PHOTO_FOLDER');
  if (fid) { try { return DriveApp.getFolderById(fid); } catch (e) { /* папку удалили — создадим заново */ } }
  var f = DriveApp.createFolder('Фото майстрів');
  props.setProperty('PHOTO_FOLDER', f.getId());
  return f;
}
