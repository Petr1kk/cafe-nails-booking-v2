# Запись на маникюр — версия 2 (с админкой)

ID: portfolio-nail-salon-v2
Статус: в работе
Что это: версия 2 записи на маникюр: поток «услуги → мастер → время → данные» (светлый стиль) + админ-панель менеджера на сайте (мастера, услуги, записи, фото на Google Диск, приглашения мастеру в календарь). Вход в админку по паролю, сервер выдаёт токен на 6 ч.
С кем: один
Папка на ПК: C:\Users\User\Desktop\1477888\projects\portfolio\nail-salon-v2
Пароли: Bitwarden → portfolio (пароль админки владелец сменил сам, его никуда не записывать)

## Ссылки
- GitHub: https://github.com/Petr1kk/cafe-nails-booking-v2
- Сайт / прод: https://petr1kk.github.io/cafe-nails-booking-v2/
- Тестовая версия: демо-режим при пустом `API_URL` в `docs\config.js`

## Ресурсы
| Тип | Название | Адрес / URL / IP | Аккаунт (почта/логин) | Где пароль | Цена/мес | Продлить до |
|-----|----------|------------------|-----------------------|------------|----------|-------------|
| репозиторий | cafe-nails-booking-v2 (публичный) | https://github.com/Petr1kk/cafe-nails-booking-v2 | Petr1kk | Bitwarden → portfolio | 0 | |
| хостинг | GitHub Pages | https://petr1kk.github.io/cafe-nails-booking-v2/ | Petr1kk | | 0 | |
| API | Google Apps Script (веб-приложение, версия 1) | адрес в `docs\config.js`; id проекта — в `CLAUDE.md` | Google владельца | Bitwarden → portfolio | 0 | |
| база | Google Таблица | id — в `CLAUDE.md` | Google владельца | | 0 | |
| другое | Google Календари мастеров (2 шт.), Google Диск (фото) | | Google владельца | | 0 | |

## Как запустить
- Локально: в папке проекта `python -m http.server` → `/docs/` (сайт, админка `admin.html`), `/tests/` (`PASS 68`; поиск услуг убран 26.11).
- Правка кода: сначала `apps-script\`, после `Core.gs` скопировать в `docs\core.js`, прогнать тесты, вставить в Apps Script и выпустить новую версию развёртывания.
- Подробно и открытые вопросы (3 жалобы владельца): `CLAUDE.md`, `..\HANDOFF.md`.

## Журнал
| Дата | Что изменилось |
|------|----------------|
| 2026-11-25 | Подключён Google, `API_URL` запушен (31a1867). [синхр. 26.11 — внесено в таблицу через коннектор] |
| 2026-11-26 | Создан паспорт. Папка `02-nails-booking-v2` переименована в `nail-salon-v2`; `portfolio-sketches` → `sketches\portfolio\nail-salon-v2`, `design-variants` → `_archive`. Коммит `816cf66` не запушен. [синхр. 26.11 — внесено в таблицу через коннектор] |
