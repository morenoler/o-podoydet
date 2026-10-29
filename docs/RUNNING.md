# Запуск и проверки

## Docker: приложение, данные и сервис вида из окна

Из корня репозитория:

```sh
docker compose up --build --wait
```

Откройте http://127.0.0.1:8080. Для показа выбран один подробный район Хэундэ: `DATA_PATH=/app/data/verified-hotels.json`. Обычный локальный запуск без `DATA_PATH` по-прежнему загружает Пусан и Сочи. Compose собирает клиент на Node.js 24, сервер на JDK 21 / Maven, запускает PostgreSQL 16 / PostGIS и Python-сервис вида из окна. Образы приложения и сервиса работают от непривилегированного пользователя. PostgreSQL и приложение опубликованы только на loopback; сервис вида доступен приложению по внутренней сети.

Первый build требует сети для образов, npm/Maven и системных пакетов. После получения образов обычный поиск, правила и геометрические расчёты работают по сохранённым данным без API-ключей. Картографические тайлы в браузере требуют сети; они не являются источником новых фактов для поиска.

`docker compose up --wait` использует health checks базы, приложения и сервиса. `docker compose logs app window-view` показывает ошибки запуска. Запуск `docker compose config --quiet` проверяет структуру конфигурации, но не заменяет сборку и запуск контейнеров.

## Показ диалога отельера

```sh
docker compose --profile jury up --build --wait
```

Откройте http://127.0.0.1:8081/jury-demo.html. Шаги описаны в [JURY_DEMO.md](JURY_DEMO.md). Это отдельный экземпляр приложения с `LAB_MODE=true`, `ACCOUNT_MODE=false`, каталогом `data/demo/spring-host-dialog.json` и схемой PostgreSQL `host_dialog_demo`. Основной сайт использует схему `public`. Симулятор не отвечает за реальные отели.

Проверка сценария через настоящий HTTP API:

```sh
docker compose --profile jury --profile checks run --rm jury-check
```

Команда запрашивает поиск, получает синтетический ответ, повторяет поиск и проверяет метки учебных доказательств. На новой схеме ожидается `before: 0`, `after: 1`; при повторе `before: 1`, `after: 1`, `repeatRun: true`. Существующие ответы и история сохраняются. Для чистого повторного показа используйте новое имя проекта Compose и свободные порты, например в PowerShell:

```powershell
$env:APP_PORT = '8090'
$env:JURY_PORT = '8091'
$env:POSTGRES_PORT = '55433'
docker compose -p opodoydet-rehearsal --profile jury up --build --wait
```

Это создаёт отдельные тома, без удаления прежних. По завершении: `docker compose -p opodoydet-rehearsal --profile jury down`. Обычная остановка `docker compose --profile jury down` также сохраняет базу и фотографии; не добавляйте `-v`, если данные нужны.

## Локальная разработка

Нужны Node.js 24+, JDK 21, Maven 3.9+, Python 3.11+ и PostgreSQL 16. Docker нужен только для автоматического запуска PostgreSQL, если не задан собственный `DATABASE_URL`.

```sh
npm ci
npm run dev
```

`npm run dev` запускает Spring на 8080 и Vite на 3000. Сборка и запуск готового клиента:

```sh
npm run build:all
npm start
```

Параметры окружения передаются запускающими Node-скриптами из `.env`; образец в [.env.example](../.env.example). Для прямого `java -jar` задайте переменные процесса явно. JDK 21 и Maven можно установить через `JAVA_HOME` / `MAVEN_HOME` либо положить в `.local/tools/jdk-21*` и `.local/tools/apache-maven-*`.

Сервис вида запускается отдельно:

```sh
cd services/window-view
python -X utf8 -m window_view serve
```

Локальная лаборатория подбора (`npm run lab:build`, `npm run lab:start`) остаётся отдельным сценарием на 8081. Она отличается от полностью синтетического диалога для жюри. Не запускайте их одновременно на одном порту. Учебные кабинеты на 8082 и публичные демонстрационные пароли: [DEMO.md](DEMO.md). Они теперь загружаются напрямую из JSON в PostgreSQL; SQLite остаётся только в тестах совместимости и опциональном профиле `legacy-import`.

## Проверки

Из корня, после установки зависимостей:

```sh
npm test
npm run backend:test
npm run agents:test
npm run demo:test
npm run build:all
npm run lab:build
python -X utf8 -m unittest discover -s scripts/tests
```

Java- и интеграционные Python-проверки требуют настоящий PostgreSQL: Testcontainers с Docker либо `TEST_DATABASE_URL`, `TEST_DATABASE_USER`, `TEST_DATABASE_PASSWORD`. Проверки создают изолированные временные схемы. Недоступный Docker не означает успешный прогон.

Из `services/window-view`:

```sh
python -X utf8 -m unittest discover -s tests -v
python -X utf8 verify_busan.py --workers 4
```

Расширенная проверка делает 288 запросов для 96 объектов. Она проверяет согласованность вычислений, а не истинность вида из реального окна. Результаты тестов, полнота источников и обследование на месте учитываются отдельно.
