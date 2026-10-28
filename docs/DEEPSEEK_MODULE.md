# DeepSeek во всём проекте

Java 21, Spring Boot 3.5.6 и Python 3.11+. Новых библиотек для API нет.
Основа: main `f51eaac2665958dc9122460ac0da2fe52756fbe8` от 28 октября 2026 года.

## Включение

В серверном `.env` задайте:

```dotenv
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=вставьте-свой-ключ
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_TIMEOUT_SECONDS=60
DEEPSEEK_MAX_TOKENS=1200
```

Перезапустите сервер: `npm run dev` или `npm start` после `npm run build:all`.
Python нужен для подробного помощника; путь задаётся в `ADVISOR_PYTHON`.
Если Java запущена вне корня проекта, задайте `ADVISOR_ROOT` — абсолютный путь
к папке с `agents/`. При обычном запуске через npm это не требуется.
Ключ только на сервере, без `VITE_` префикса. Не добавляйте `.env` в Git.
В ходе разработки настоящий ключ не настраивался и платные запросы не выполнялись.

| AI_PROVIDER | Поведение |
| --- | --- |
| `deepseek` | Все модельные пути используют DeepSeek; помощник по умолчанию `deepseek` |
| `local` | Все модельные пути используют ADVISOR_LOCAL_MODEL / ADVISOR_LOCAL_BASE_URL; помощник по умолчанию `local` при заданной модели |
| `rules` | Все модели отключены, даже при наличии ключей и локальной модели |
| Пустое значение | Прежние независимые LLM_* / ADVISOR_LOCAL_* настройки; помощник по умолчанию `rules` |

Сам по себе DEEPSEEK_API_KEY ничего не включает. При AI_PROVIDER=deepseek старые
LLM_* и ADVISOR_LOCAL_* не выбирают модель. Отсутствующий ключ и неверные лимиты
дают ошибку настройки. Импорт Python и создание клиента не отправляют запросов.

## Подключённые пути

| Операция | Реализация |
| --- | --- |
| Пожелания из текста и изменения через чат | application/Agents → DeepSeekJsonModel |
| Неоднозначное расположение | LocalPlacePlanner → StructuredModel → DeepSeekJsonModel |
| Публичный ответ отельера | Agents.extract и Spring LlmAnswerExtractor → LlmClient → DeepSeekJsonModel |
| Выбор вариантов и независимый критик | AdvisorService → PythonWorker → agents.DeepSeekClient |

ProviderSettings задаёт общий выбор для Java, agents.runtime.Settings проверяет
его в Python. Основной интерфейс использует defaultMode из `/api/advisor/config`.
Лаборатория и история различают `local`, `deepseek`, `rules` и `rules_fallback`.
Скрипты lab/demo сохраняют явно выбранный DeepSeek. Для ручного API-запуска
помощника используйте mode=deepseek; конфигурация содержит modes=[rules,deepseek].
Режим local при таком выборе не допускается. Python получает ключ только при
запуске deepseek; запуск rules идёт без ключа. Ключа нет в API-конфигурации и истории.

Однозначные ответы и распознанные правилами условия могут обходиться без модели.
География, фильтры и проверка доказательств продолжают работать кодом.
При ошибке используется предусмотренный соответствующим путём разбор по правилам.
Переключения на Ollama/другой API и автоматических повторов нет. Неуспешный,
но уже отправленный запрос может быть оплачен провайдером.

## Протокол, ограничения и данные

POST https://api.deepseek.com/chat/completions; response_format=json_object,
thinking=disabled, temperature=0, без streaming. Схема входит в инструкцию,
ответ проверяется локально. JSON mode не гарантирует схему и достоверность фактов.

Лимиты: 1200 выходных токенов, 60 секунд; допустимы 1–4096 токенов и 1–180 секунд.
Контекст — 24 000 символов (в Java UTF-16 code units), весь запрос — 64 КиБ,
HTTP-ответ — 128 КиБ, итоговый JSON — 12 КиБ. Данные не обрезаются.
Java ограничивает всю отправку и чтение через отменяемый future. Python задаёт
сетевой тайм-аут и проверяет время между read1-порциями, включая keep-alive;
DNS и уже блокирующая операция могут продлить его. Внешний лимит worker — 420 секунд.

Принимается один завершённый assistant-ответ с finish_reason=stop. Пустой или
обрезанный JSON, Markdown, tool calls, дубли ключей, неизвестные ID и нарушение
схемы отклоняются. Редиректы запрещены. В ошибках нет ключа и тела ответа API.
Java ModelSchema поддерживает object/array/string/boolean/integer/number/null,
enum, anyOf, required, additionalProperties и minItems/maxItems. Python-валидатор
поддерживает схемы advisor: object/array/string/null, строковый enum и anyOf.
Неподдерживаемая схема отклоняется до запроса. После этого остаются проверки
цитат, обязательности, принадлежности фактов и необходимых предупреждений.

В помощнике максимум два вызова; счётчики берутся из ответа API. Неизвестный
расход внутри Python-клиента — -1, в истории сопровождается предупреждением.
В Java каждый отдельный разбор делает один запрос; диалог может отдельно разбирать
расположение и остальные пожелания. Общего финансового лимита и расчёта цены нет;
Java-счётчики токенов пока не выводятся в интерфейсе.

Python отправляет ограниченную проекцию model_context с короткими ID, названиями
кандидатов и вычисленными статусами. Java отправляет текущий запрос и каталог
условий либо публичный ответ отельера для цитирования. Личные переписки
accounts/clarifications, cookie, пользователь, приватный диалог и чужой исходный
запрос не добавляются в payload. Модель не подтверждает реальные условия отеля
и не отправляет сообщения отельеру.

## Проверки

```powershell
npm run agents:test
npm test
npm run backend:test
npm run build:all
npm run lab:build
npm run demo:test
python -X utf8 -m unittest discover -s scripts/tests
```

Java-тесты используют отдельную PostgreSQL 16 и локальный HTTP-стенд, включая
настоящий запуск Python, историю и проверку доступа другого клиента. Настройки
тестов исключают унаследованный платный провайдер.
Для сборки рядом с живым сайтом: `npm run build -- --outDir .local/deepseek-dist`;
для лаборатории задайте LAB_DIST_PATH=.local/deepseek-lab-dist.

Тесты явно задают DEEPSEEK_BASE_URL=http://127.0.0.1:<порт>. Разрешены только
официальный HTTPS API (также с /v1) и HTTP loopback по числовым 127.0.0.1 / ::1.
Произвольный удалённый шлюз не допускается. Для обычной работы URL не меняйте.
Старый отдельный scripts/test-deepseek.py --ask-key --json проверяет доступ к API;
он не загружает каталог и не заменяет проверку сайта. Без сети:
`python -X utf8 scripts/test-deepseek.py --dry-run --json`.

Контракт сверён 28 октября 2026 года с официальными
[Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/),
[JSON Output](https://api-docs.deepseek.com/guides/json_mode/) и
[keep-alive](https://api-docs.deepseek.com/quick_start/rate_limit/).
Это дата чтения документации, не проверка реального API.
[Результаты и ограничения](DEEPSEEK_MODULE_QUALITY.md).
