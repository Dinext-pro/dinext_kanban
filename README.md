# Dinext Kanban

## 📖 Обзор

Dinext Kanban — приложение для Frappe Framework, которое дополняет стандартное Kanban-представление интерфейсом на Vue 3. Репозиторий называется `dinext_kanban`, а внутреннее имя устанавливаемого Frappe-приложения — `quick_kanban`.

Новый интерфейс включается конфигурацией сайта и может быть доступен всем пользователям либо заданному списку. Если конфигурацию или frontend bundle загрузить не удаётся, приложение возвращается к стандартному Kanban Frappe.

## ✨ Возможности

- Vue-интерфейс для Kanban Board любого DocType, использующего поле типа `Select`.
- Виртуализация карточек и постраничная загрузка по колонкам для больших досок.
- Начальная загрузка до 100 записей и автоматическая дозагрузка по 30 карточек при прокрутке отдельной колонки.
- Перемещение карточек мышью и через доступное с клавиатуры меню выбора колонки.
- Двухслойная валидация перемещений: фронтенд фильтрует назначения по Workflow-правам и обязательным полям (`reqd`, `mandatory_depends_on`), сервер повторяет проверки при сохранении.
- Подсветка разрешённых колонок при перетаскивании и блокировка запрещённых назначений.
- Выбор Workflow action, когда несколько переходов ведут в одну колонку.
- Оптимистичное обновление с откатом при недостаточных правах, ошибке валидации или конкурентном изменении документа.
- Проверка прав чтения и записи на уровне DocType и поля.
- Подсчёт общего количества карточек в каждой колонке с учётом текущих фильтров.
- Двойной клик по счётчику в заголовке колонки открывает ListView с фильтром этой колонки и сохранёнными фильтрами доски.
- Настройка цвета колонок и выделение значений выбранного поля.
- Расцветка карточек по полю `color` (fieldtype `Color`) в целевом DocType: цветная полоска слева и лёгкий tint фона.
- Просмотр и изменение назначенных пользователей через стандартный Assign To Dialog.
- Переход из диалога Kanban Settings к записи текущей Kanban Board.
- Явные состояния загрузки, отсутствия данных и ошибки с повторным запросом.
- Санитизация форматированного содержимого карточек через DOMPurify.
- Обновление через стандартный lifecycle списка Frappe без дополнительной realtime-подписки.
- Безопасный переход на стандартный Kanban при ошибке запуска нового интерфейса.

## 🚀 Установка

Из корня bench загрузите приложение из центрального репозитория Dinext:

```bash
bench get-app quick_kanban \
  https://dinext.gitlab.yandexcloud.net/erpnext/dinext/dinext_kanban.git
```

Установите его на нужный сайт:

```bash
bench --site <site-name> install-app quick_kanban
```

Соберите assets и очистите cache:

```bash
cd apps/dinext_kanban && yarn workspace quick_kanban build
cd ../.. && bench build --app quick_kanban
bench --site <site-name> clear-cache
```

Для Quick Kanban frontend недостаточно одной сборки Vite: Frappe отдаёт **хешированные** bundles из `quick_kanban/dist/`, поэтому после `yarn workspace quick_kanban build` обязательно запускайте `bench build --app quick_kanban` (или Frappe esbuild):

```bash
yarn workspace quick_kanban build
cd ../frappe && yarn run production --apps quick_kanban
bench --site <site-name> clear-cache
```

После обновления frontend в браузере выполните жёсткое обновление страницы Kanban (`Ctrl+Shift+R`), чтобы подтянуть новый bundle.

### Если `bench` падает с `ImportError: _check_nested_chain`

Конфликт версий `frappe-bench` и `click`. Обновите bench CLI:

```bash
pip3 install --user --upgrade 'frappe-bench>=5.31'
```

Пока `bench` недоступен, можно использовать обходные команды из корня bench:

```bash
# Очистка кэша сайта
env/bin/python -c "
import os, sys
sys.path.insert(0, 'apps/frappe')
os.chdir('sites')
import frappe
frappe.init(site='<site-name>', sites_path='.')
frappe.connect()
frappe.clear_cache()
print('cache cleared')
"

# Сборка assets Quick Kanban
cd apps/dinext_kanban && yarn workspace quick_kanban build
cd ../frappe && yarn run production --apps quick_kanban
```

## 🛠️ Использование

1. Создайте или откройте стандартный `Kanban Board` в Frappe.
2. Выберите целевой DocType и поле типа `Select`, значения которого станут колонками.
3. Добавьте поля, которые должны отображаться на карточке.
4. При необходимости задайте `Highlighted Field` и таблицу цветов для его значений.
5. Для расцветки карточек добавьте в целевой DocType поле **`color`** с типом **`Color`** и заполните его у записей (hex, например `#FF5733`). Поле подтягивается автоматически и не отображается в теле карточки.
6. Откройте Kanban-представление списка.

Двойной клик по badge с количеством записей в заголовке колонки открывает ListView того же DocType с фильтром по значению колонки (например, `status = Open`) и текущими фильтрами доски из filter bar. Одиночный клик по счётчику ничего не делает.

Карточку можно переместить drag-and-drop или через действие `Move to`. Перед перемещением клиент запрашивает `quick_kanban.api.get_move_options` и локально проверяет обязательные поля (`reqd`, `mandatory_depends_on`) для preview целевого состояния. Запрещённые назначения не показываются в меню и не принимают drop. При нескольких Workflow actions для одной колонки открывается диалог выбора action.

Сохранение выполняется через `quick_kanban.api.move_card` с `board_name`, именем документа, целевой колонкой, `expected_modified` и опциональным `workflow_action`. Сервер повторяет проверки Workflow-прав и mandatory rules, затем либо применяет `apply_workflow`, либо вызывает полный `doc.save()` с lifecycle hooks целевого DocType.

### Расцветка карточек по полю `color`

Quick Kanban автоматически использует поле **`color`** с fieldtype **`Color`** в DocType, для которого создана доска:

- значение hex из Frappe Color применяется как **цветная полоска слева** (4px) и **лёгкий tint фона** (10%);
- поле добавляется в запрос данных доски автоматически, даже если не указано в `Fields` Kanban Board;
- hex не показывается среди полей карточки;
- пустое или невалидное значение — обычная карточка без расцветки.

Требования:

- fieldname строго **`color`**, fieldtype строго **`Color`** (поле с другим именем или типом не используется);
- у записей должно быть заполнено значение цвета;
- после изменений frontend выполните сборку (`yarn workspace quick_kanban build`, `bench build --app quick_kanban`, `clear-cache`) и обновите страницу Kanban (`Ctrl+Shift+R`).

## 📦 Технологии

- Frappe Framework 15 и Python — серверные методы, права и подключение assets.
- Vue 3 — компоненты доски.
- Vuex 4 — состояние, загрузка данных и оптимистичные операции.
- Vite — сборка frontend bundle.
- `vue-virtual-draglist` — виртуализация и drag-and-drop.
- DOMPurify — очистка форматированного HTML.
- Vitest и Vue Test Utils — модульные и компонентные тесты.
- Playwright — browser-тесты пользовательских сценариев.
- ESLint и Frappe Semgrep rules — статические проверки.

## 🔧 Конфигурация

Включите новый Kanban для всех пользователей сайта:

```bash
bench --site <site-name> set-config kanban_beta 1
```

Для поэтапного включения задайте список пользователей в `sites/<site-name>/site_config.json`:

```json
{
  "kanban_beta": 1,
  "kanban_beta_users": [
    "user@example.com",
    "manager@example.com"
  ]
}
```

Правила применения конфигурации:

- `kanban_beta = 0` или отсутствие параметра — используется стандартный Kanban Frappe;
- `kanban_beta = 1` и пустой `kanban_beta_users` — новый Kanban доступен всем;
- `kanban_beta = 1` и непустой `kanban_beta_users` — новый Kanban доступен только перечисленным пользователям.

## ✅ Требования

- Frappe Framework 15.
- Python 3.10 или новее.
- Node.js 24 и Yarn для сборки и frontend-проверок.
- Рабочий bench с Redis и MariaDB, настроенными согласно требованиям Frappe.
- Chromium для запуска browser-тестов Playwright.

## 🤝 Участие в разработке

1. Ознакомьтесь с [AGENTS.md](AGENTS.md) и центральными правилами Dinext.
2. Создавайте изменения в отдельной ветке от актуальной целевой ветки.
3. Добавляйте тесты для нового поведения и исправленных регрессий.
4. Перед review запускайте lint, unit-тесты, browser-тесты, backend-тесты и сборку.
5. Не включайте в commit временные файлы, отчёты покрытия, Playwright artifacts и `node_modules`.

Pull request автоматически проверяется frontend/backend workflow и Frappe Semgrep rules.

## Разработка и проверки

Установите frontend-зависимости из корня приложения:

```bash
yarn install --frozen-lockfile
```

Запустите frontend-проверки:

```bash
yarn workspace quick_kanban lint
yarn workspace quick_kanban test:run
yarn workspace quick_kanban test:browser
yarn workspace quick_kanban build
python3 -m compileall -q quick_kanban
```

Backend-тесты выполняются из корня bench:

```bash
bench --site <site-name> run-tests --app quick_kanban
```

Для локальной разработки frontend:

```bash
yarn dev
```

Frontend состоит из двух слоёв: `quick_kanban/public/js/kanban_view.bundle.js` расширяет стандартный `KanbanView` (в том числе добавляет служебные поля вроде `color` в запрос `reportview.get`), а Vite собирает Vue-приложение из `Quick-Kanban/src/`. Команда `yarn workspace quick_kanban build` копирует JavaScript и CSS в `quick_kanban/public/`; `bench build --app quick_kanban` собирает хешированные bundles в `quick_kanban/dist/`, которые Frappe реально отдаёт на сайт. Перед review и деплоем выполняйте обе команды и проверяйте, что изменения попали в `dist/`.

## Локализация

Все пользовательские строки приложения оборачиваются в `_()` (Python) или `__()` (JavaScript) и сопровождаются русскими переводами в [`quick_kanban/translations/ru.csv`](quick_kanban/translations/ru.csv).

При добавлении новых строк:

1. Оберните текст в `_()` / `__()`.
2. Добавьте пару `"English","Русский",""` в `ru.csv`.
3. После изменения переводов выполните на сайте:

```bash
bench --site <site-name> migrate
bench --site <site-name> clear-cache
```

При необходимости синхронизируйте переводы через `bench update-translations` согласно процессу вашего bench.

## 📄 Документация

- [AGENTS.md](AGENTS.md) — navigation stub к общим инструкциям, skills и rules Dinext.
- [`../dinext-docs/catalog.md`](../dinext-docs/catalog.md) — центральный каталог пользовательской документации.
- [`../dinext-docs/docs/бизнес-функции/задачи/Задачи.md`](../dinext-docs/docs/бизнес-функции/задачи/Задачи.md) — пользовательская документация по задачам и Kanban.
- [`quick_kanban/api.py`](quick_kanban/api.py) — серверные методы подсчёта и перемещения карточек.
- [`Quick-Kanban/src/`](Quick-Kanban/src/) — исходный код Vue-интерфейса.

После каждого commit локальный `post-commit` hook формирует предложение для документации в `../dinext-docs/doc-proposals/inbox/`. Повторная установка hook:

```bash
python3 ../dinext-docs/scripts/install_doc_intake_hooks.py \
  --docs-root ../dinext-docs \
  --app-root . \
  --apply
```

## ❤️ Благодарности

Приложение основано на открытом проекте [tridz-dev/quick_kanban](https://github.com/tridz-dev/quick_kanban). Развитие и интеграция в продукт Dinext ведутся в репозитории `dinext_kanban`.

## 🗂️ Структура репозитория

```text
dinext_kanban/
├── .github/workflows/          # CI: quality gates, Semgrep и release workflow
├── Quick-Kanban/
│   ├── e2e/                    # Playwright-сценарии и автономная browser fixture
│   ├── src/
│   │   ├── components/         # Vue-компоненты доски, колонок и карточек
│   │   ├── test/               # Общая настройка Vitest и тесты интеграционных scripts
│   │   ├── utils/              # Store, преобразование данных, меню и цвета
│   │   ├── App.vue             # Корневой Vue-компонент
│   │   ├── main.js             # Mount/unmount Vue-приложения
│   │   └── style.css           # Стили нового Kanban
│   ├── package.json            # Frontend-зависимости и команды
│   ├── playwright.config.js    # Конфигурация browser-тестов
│   └── vite.config.js          # Сборка и unit-тесты
├── quick_kanban/
│   ├── public/
│   │   ├── css/                # Собранные и подключаемые стили
│   │   └── js/                 # Bootstrap, KanbanView override и Vue bundle
│   ├── tests/                  # Backend-тесты Frappe
│   ├── api.py                  # Permission-aware API доски
│   ├── get_beta_users.py       # Чтение feature flags из site config
│   └── hooks.py                # Метаданные Frappe и подключение assets
├── AGENTS.md                   # Указатель на central dinext-docs
├── package.json                # Корневой Yarn workspace
├── pyproject.toml              # Python package metadata
├── yarn.lock                   # Зафиксированные frontend-зависимости
└── license.txt                 # Лицензия MIT
```

## 🔗 Поток данных

```mermaid
flowchart LR
    User[Пользователь открывает Kanban] --> Native[Frappe KanbanView]
    Native --> Config[get_kanban_config]
    Config --> Decision{kanban_beta разрешён?}
    Decision -->|Нет или ошибка| Standard[Стандартный Kanban Frappe]
    Decision -->|Да| Bundle[Загрузка Vue bundle]
    Bundle --> Store[Vuex store]
    Store --> Board[Vue-компоненты доски]
    Store --> ListAPI[frappe.desk.reportview.get]
    Store --> Totals[get_column_totals]
    User --> ListNav[Двойной клик по счётчику колонки]
    ListNav --> ListView[ListView с фильтром колонки]
    User --> Move[Перемещение карточки]
    Move --> Optimistic[Оптимистичное обновление Vuex]
    Optimistic --> MoveAPI[move_card]
    MoveAPI -->|Успех| Saved[Документ сохранён]
    MoveAPI -->|Ошибка или конфликт| Rollback[Позиция восстановлена]
```

## Лицензия

Проект распространяется по лицензии MIT. Полный текст находится в [license.txt](license.txt).
