// Тесты логики. Открываются в браузере: tests/index.html (заголовок вкладки покажет PASS N или FAIL N)
let pass = 0, fail = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : (fail++, console.log('FAIL', name, '\n  получено', JSON.stringify(got), '\n  ожидалось', JSON.stringify(want)));
}

const cfg = CORE.parseSettings({});
const masters = CORE.parseMasters([
  ['m1', 'Марія', 'Топ-майстер', '1,2,3,4,5', '10:00', '19:00', '14:00', '15:00', 'cal1', 'a@x.com', '+380501112233', '@maria_nails', 'http://x/p.jpg', 'так', 's1,s2'],
  ['m2', 'Олена', '', '2,3,4,5,6', '11:00', '20:00', '', '', 'cal2', '', '', '', '', 'так', '']
]);
const now = { day: '2026-12-01', min: 8 * 60 }; // вівторок 08:00

t('мастера разобраны', masters.length, 2);
t('на сайт уходит только публичное (без календаря, почты, телефона, telegram)', CORE.publicMasters(masters), [
  { id: 'm1', name: 'Марія', role: 'Топ-майстер', photo: 'http://x/p.jpg', services: ['s1', 's2'], active: true, maxBlockMin: 240 },
  { id: 'm2', name: 'Олена', role: '', photo: '', services: [], active: true, maxBlockMin: 540 }]);

// Марія, вівторок, 60 хв: обід 14:00–15:00 пропускаем
const m1 = CORE.masterFree(masters[0], cfg, 60, '2026-12-02', [], now).map(CORE.fmt);
t('Марія не ставит запись на обед', m1.includes('14:00') || m1.includes('13:30'), false);
t('Марія с утра', m1[0], '10:00');
t('Марія последняя 18:00', m1[m1.length - 1], '18:00');

// Олена в понеділок не работает
t('выходной мастера', CORE.masterFree(masters[1], cfg, 60, '2026-12-07', [], now), []);

// Занятость: Марія занята 10:00–11:00 → 10:00 и 10:30 недоступны
const busy = { m1: [{ s: 600, e: 660 }] };
const m1b = CORE.masterFree(masters[0], cfg, 60, '2026-12-02', busy.m1, now).map(CORE.fmt);
t('занято 10:00', m1b.includes('10:00') || m1b.includes('10:30'), false);
t('11:00 свободно', m1b[0], '11:00');

// Длинная услуга не влезает в конец дня
const long = CORE.masterFree(masters[0], cfg, 150, '2026-12-02', [], now).map(CORE.fmt);
t('150 мин: последняя начинается не позже 16:30', long[long.length - 1], '16:30');

// Сегодня: «не раньше чем через 2 часа»
const nowLate = { day: '2026-12-02', min: 12 * 60 };
const today = CORE.masterFree(masters[0], cfg, 60, '2026-12-02', [], nowLate).map(CORE.fmt);
t('сегодня с 15:00 (12:00 + 2 ч, обед до 15:00)', today[0], '15:00');

// В прошлое нельзя
t('прошлое', CORE.masterFree(masters[0], cfg, 60, '2026-11-30', [], now), []);
// За горизонтом нельзя
t('за горизонтом', CORE.masterFree(masters[0], cfg, 60, '2027-03-01', [], now), []);
// Невалидная дата
t('2026-02-31', CORE.validDay('2026-02-31'), false);

// «Любой мастер»: объединение. Вівторок: Марія 10:00+, Олена 11:00+
const any = CORE.freeTimes(masters, cfg, 60, '2026-12-02', {}, now, 'any');
t('любой мастер начинает с 10:00', any[0], '10:00');
const only2 = CORE.freeTimes(masters, cfg, 60, '2026-12-02', {}, now, 'm2');
t('только Олена с 11:00', only2[0], '11:00');

// Любой мастер: если Марія занята, берём Олену
t('pickMaster любой → Марія', CORE.pickMaster(masters, cfg, 60, '2026-12-02', '11:00', {}, now, 'any'), 'm1');
t('pickMaster любой, Марія занята → Олена', CORE.pickMaster(masters, cfg, 60, '2026-12-02', '11:00', { m1: [{ s: 660, e: 720 }] }, now, 'any'), 'm2');
t('pickMaster никто', CORE.pickMaster(masters, cfg, 60, '2026-12-02', '11:00', { m1: [{ s: 660, e: 720 }], m2: [{ s: 660, e: 720 }] }, now, 'any'), '');
t('pickMaster конкретный занят', CORE.pickMaster(masters, cfg, 60, '2026-12-02', '11:00', { m1: [{ s: 660, e: 720 }] }, now, 'm1'), '');

// Телефон и данные
t('телефон 0XX', CORE.normalizePhone('050 123 45 67'), '+380501234567');
t('телефон +380', CORE.normalizePhone('+380501234567'), '+380501234567');
t('телефон плохой', CORE.normalizePhone('12345'), '');
t('формула в таблице', CORE.sanitizeCell('=1+1'), "'=1+1");
const v = CORE.validateClient({ name: 'А', phone: '1', email: 'bad' });
t('валидация ловит ошибки', Object.keys(v.errors).sort(), ['email', 'name', 'phone']);
t('валидация ок, почта необязательна', CORE.validateClient({ name: 'Анна', phone: '0501234567' }).ok, true);

// Защита от злоупотреблений
t('ok', CORE.decideAttempt(0, 0), 'ok');
t('3 активные → limit', CORE.decideAttempt(3, 1), 'limit');
t('много попыток → shadow', CORE.decideAttempt(0, 6), 'shadow');

// Услуги: неактивные не показываем
t('услуги', CORE.parseServices([['s1', 'Манікюр', '60', '450', 'так'], ['s2', 'Старе', '30', '100', 'ні']]).map(s => s.id), ['s1']);

// Несколько услуг за визит
const sv = CORE.parseServices([['s1', 'Манікюр', '60', '450', 'так'], ['s2', 'Гель-лак', '60', '250', 'так'], ['s3', 'Педикюр', '90', '700', 'так']]);
const combo = CORE.combineServices(sv, 's1,s3');
t('две услуги: время складывается', combo.durationMin, 150);
t('две услуги: цена складывается', combo.price, 1150);
t('две услуги: название', combo.name, 'Манікюр + Педикюр');
t('неизвестная услуга', CORE.combineServices(sv, 's1,zzz'), null);
t('пустой выбор', CORE.combineServices(sv, ''), null);
t('повторы убираются', CORE.combineServices(sv, 's1,s1').durationMin, 60);
t('больше 4 нельзя', CORE.combineServices(sv, 's1,s2,s3,s1x,s9'), null);

// --- самое длинное окно мастера (для предупреждения «слишком много услуг») ---
t('maxBlockMin: обед делит день', CORE.maxBlockMin({ start: 600, end: 1140, lunchStart: 840, lunchEnd: 900 }), 240);
t('maxBlockMin: без обеда весь день', CORE.maxBlockMin({ start: 660, end: 1200, lunchStart: 0, lunchEnd: 0 }), 540);
t('publicMasters отдаёт maxBlockMin', CORE.publicMasters(masters).map(function (m) { return m.maxBlockMin; }), [240, 540]);


// --- v2: профиль мастера, услуги по категориям, админка ---
t('профиль: роль, телефон, telegram, фото', [masters[0].role, masters[0].phone, masters[0].telegram, masters[0].photo], ['Топ-майстер', '+380501112233', '@maria_nails', 'http://x/p.jpg']);
t('публичные мастера годятся для eligibleMasters', CORE.eligibleMasters(CORE.publicMasters(masters), 's3').map(m => m.id), ['m2']);
t('услуги мастера разобраны', masters[0].services, ['s1', 's2']);
t('пустой список услуг = все', masters[1].services, []);
const offRows = [['m9', 'Ія', '', '1', '10:00', '18:00', '', '', 'c', '', '', '', '', 'ні', '']];
t('отключённый мастер читается, но не публичный', [CORE.parseMasters(offRows)[0].active, CORE.publicMasters(CORE.parseMasters(offRows)).length], [false, 0]);
t('отключённый не попадает в eligible', CORE.eligibleMasters(masters.concat(CORE.parseMasters(offRows)), 's1').map(m => m.id), ['m1', 'm2']);
t('Марія не делает s3 → eligible только Олена', CORE.eligibleMasters(masters, 's1,s3').map(m => m.id), ['m2']);
t('Марія делает s1+s2', CORE.masterDoes(masters[0], ['s1', 's2']), true);
t('masterRow ↔ parseMasters (круг)', CORE.parseMasters([CORE.masterRow(masters[0])])[0], masters[0]);
t('masterRow: обед пустой, если нет', CORE.masterRow(masters[1]).slice(6, 8), ['', '']);

const svAll = CORE.parseServices([['s1', 'Манікюр', '60', '450', 'так', 'Манікюр'], ['s2', 'Гель', '60', '250', 'так', 'Манікюр'], ['s3', 'Педикюр', '90', '700', 'так', 'Педикюр'], ['s4', 'Старе', '30', '1', 'ні', 'Педикюр']]);
t('скрытая услуга не показывается', svAll.map(s => s.id), ['s1', 's2', 's3']);
t('скрытая услуга видна в админке', CORE.parseServices([['s4', 'Старе', '30', '1', 'ні', 'X']], true)[0].active, false);
t('категория по умолчанию', CORE.parseServices([['s5', 'Щось', '30', '1', 'так', '']])[0].category, 'Інше');
t('услуги по категориям', CORE.groupByCategory(svAll).map(g => g.name + ':' + g.items.length), ['Манікюр:2', 'Педикюр:1']);
t('услуги мастера (Марія: s1,s2)', CORE.servicesFor(svAll, masters[0]).map(s => s.id), ['s1', 's2']);
t('услуги «любого» = все', CORE.servicesFor(svAll, null).length, 3);
t('serviceRow ↔ parseServices (круг)', CORE.parseServices([CORE.serviceRow(svAll[1])], true)[0], svAll[1]);

t('telegram: без @', CORE.normalizeTelegram('maria_nails'), '@maria_nails');
t('telegram: ссылка t.me', CORE.normalizeTelegram('https://t.me/maria_nails'), '@maria_nails');
t('telegram: слишком короткий', CORE.normalizeTelegram('ab'), '');

const goodM = { name: ' Ніна ', role: 'Педикюр', workdays: [1, 2], start: '10:00', end: '18:00', lunchStart: '13:00', lunchEnd: '14:00', email: 'NINA@mail.com', phone: '050 111 22 33', telegram: 'nina_pedi', services: ['s1', 'zzz'], active: true };
const vm = CORE.validateMaster(goodM, ['s1', 's2']);
t('профиль мастера валиден', vm.ok, true);
t('профиль: почта в нижний регистр, телефон +380, telegram с @, лишняя услуга убрана', [vm.clean.email, vm.clean.phone, vm.clean.telegram, vm.clean.services], ['nina@mail.com', '+380501112233', '@nina_pedi', ['s1']]);
t('профиль: ошибки', Object.keys(CORE.validateMaster({ name: 'А', workdays: [], start: '18:00', end: '10:00', email: 'bad', phone: '12', telegram: 'a' }).errors).sort(), ['email', 'hours', 'name', 'phone', 'telegram', 'workdays']);
t('профиль: обед вне рабочего дня', Object.keys(CORE.validateMaster(Object.assign({}, goodM, { lunchStart: '09:00', lunchEnd: '10:00' })).errors), ['lunch']);
t('профиль: без почты — это нормально (рассылка выключена)', CORE.validateMaster(Object.assign({}, goodM, { email: '' })).clean.email, '');
t('услуга валидна', CORE.validateService({ name: 'Френч', durationMin: 90, price: 800, category: 'Манікюр', active: true }).ok, true);
t('услуга: ошибки', Object.keys(CORE.validateService({ name: '', durationMin: 5, price: -1 }).errors).sort(), ['durationMin', 'name', 'price']);

// ближайшие свободные окна (для карточек мастеров)
const ns = CORE.nearestSlots(masters[0], cfg, 60, ['2026-12-01', '2026-12-02', '2026-12-03'], { '2026-12-01': [{ s: 0, e: 1440 }] }, now, 3);
t('ближайшие окна: занятый день пропускается', ns, [{ day: '2026-12-02', time: '10:00' }, { day: '2026-12-02', time: '10:30' }, { day: '2026-12-02', time: '11:00' }]);
t('ближайшие окна: нет свободных', CORE.nearestSlots(masters[1], cfg, 60, ['2026-12-07'], {}, now, 3), []);

document.title = fail ? 'FAIL ' + fail : 'PASS ' + pass;
document.body.textContent = (fail ? 'FAILED ' + fail : 'ALL OK') + ' — pass ' + pass + (window.__log || []).join(' | ');

