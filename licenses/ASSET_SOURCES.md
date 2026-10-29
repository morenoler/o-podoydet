# Шрифты, иконки и условия использования материалов

Проверено 29 октября 2026 года по `package-lock.json`, установленным пакетам,
импортам приложения и собранным файлам `dist/assets`. Это учёт визуальных
зависимостей, а не исчерпывающий список лицензий всего программного стека.

Полные тексты лицензий лежат рядом. Для npm-зависимостей сохранён текст `LICENSE`
именно установленной и зафиксированной в lockfile версии, включая её copyright.
Переводы строк приведены к LF. Более новые copyright из текущих upstream-веток
не подменяют уведомления поставляемых версий. Тексты не сокращены до ссылок
или кратких пересказов.

## Что входит в приложение

| Компонент | Версия и способ поставки | Лицензия и правообладатели | Полный текст |
| --- | --- | --- | --- |
| Inter Variable | `@fontsource-variable/inter` 5.3.0; импорт в `src/main.tsx`, семь локальных WOFF2 для normal, веса 100–900. Файлы приходят из npm и включаются Vite в сборку; отдельно в Git не хранятся. | SIL Open Font License 1.1; The Inter Project Authors. Основатель и дизайнер проекта — Rasmus Andersson. В поставляемом пакете copyright 2016. | [INTER-OFL-1.1.txt](INTER-OFL-1.1.txt) |
| Lucide React | `lucide-react` 0.468.0; SVG-компоненты импортируются в интерфейс и включаются в JavaScript-сборку. | ISC; Lucide Contributors 2022. Уведомление этой версии отдельно сохраняет права Cole Bemis 2013–2022 на части из Feather (MIT). | [LUCIDE-ISC.txt](LUCIDE-ISC.txt) |
| Feather | Источник части иконок Lucide; отдельный npm-пакет Feather не установлен. Полный MIT-текст взят из официального тега Feather `v4.29.2`. Это версия текста лицензии, а не заявление, что всё содержимое Feather этой версии используется приложением. | MIT; Cole Bemis. В официальном тексте `v4.29.2`: copyright 2013–2023. Уведомление Lucide не переписано под этот диапазон. | [FEATHER-MIT.txt](FEATHER-MIT.txt) |
| Leaflet | `leaflet` 1.9.4; JavaScript и `leaflet/dist/leaflet.css` импортируются компонентами карт. CSS включает изображения элементов управления и маркера; Vite может включать их как data URL. | BSD 2-Clause; Volodymyr Agafonkin 2010–2023, CloudMade 2010–2011. Лицензия Leaflet не распространяется автоматически на картографические тайлы. | [LEAFLET-BSD-2-Clause.txt](LEAFLET-BSD-2-Clause.txt) |

Шрифт загружается с самого приложения: для Inter не требуется запрос браузера
к Google Fonts. Семь поставляемых наборов: cyrillic, cyrillic-ext, greek,
greek-ext, latin, latin-ext и vietnamese. Бинарные файлы не изменялись этим
лицензионным аудитом.

Указанные в CSS системные Arial, Trebuchet MS и generic `sans-serif` не поставляются
проектом. Их наличие зависит от устройства пользователя; проект не присваивает
им OFL и не распространяет их бинарные файлы.

## Установленные шрифты, которые текущая сборка не включает

| Пакет | Статус | Лицензия и copyright поставляемого пакета | Полный текст |
| --- | --- | --- | --- |
| `@fontsource/golos-text` 5.3.0 | Есть в `package.json` и lockfile; CSS и файлы шрифта текущим приложением не импортируются. | OFL-1.1; Copyright 2019 The Golos Text Project Authors. Upstream `AUTHORS.txt` указывает Alexandra Korolkova и Vitaly Kuzmin. | [GOLOS-TEXT-OFL-1.1.txt](GOLOS-TEXT-OFL-1.1.txt) |
| `@fontsource/nunito-sans` 5.3.0 | Есть в зависимостях. Имя Nunito Sans осталось в базовых CSS, но подключаемая позднее тема задаёт Inter; CSS пакета не импортируется и его WOFF/WOFF2 отсутствуют в проверенной сборке. | OFL-1.1; Copyright 2016 The Nunito Sans Project Authors. Upstream `AUTHORS.txt` указывает Vernon Adams, Jacques Le Bailly, Manvel Shmavonyan и Alexei Vanyashin. | [NUNITO-SANS-OFL-1.1.txt](NUNITO-SANS-OFL-1.1.txt) |

Тексты этих двух лицензий сохранены для полноты установленных зависимостей;
наличие файла лицензии не означает, что шрифт сейчас виден в интерфейсе.

## Первичные источники

- Feather: [официальная MIT-лицензия v4.29.2](https://github.com/feathericons/feather/blob/v4.29.2/LICENSE),
  [проект](https://feathericons.com/).
- Lucide: [лицензия поставляемой версии 0.468.0](https://github.com/lucide-icons/lucide/blob/0.468.0/LICENSE),
  [текущая страница лицензии и перечень наследуемых Feather-иконок](https://lucide.dev/license).
  Текущая страница относится к развивающемуся проекту; текст из пакета 0.468.0
  сохранён отдельно без обновления года или правообладателей.
- Inter: [сайт Rasmus Andersson](https://rsms.me/inter/),
  [лицензия исходного проекта](https://github.com/rsms/inter/blob/master/LICENSE.txt),
  [пакет Fontsource](https://fontsource.org/fonts/inter).
  В `node_modules/@fontsource-variable/inter/metadata.json` указан источник Google Fonts.
  [Текущий OFL Google Fonts](https://github.com/google/fonts/blob/main/ofl/inter/OFL.txt)
  содержит другой год copyright; это не причина менять notice установленного пакета.
- Golos Text: [исходный проект и OFL](https://github.com/googlefonts/golos-text),
  [авторы](https://github.com/googlefonts/golos-text/blob/main/AUTHORS.txt),
  [OFL Google Fonts](https://github.com/google/fonts/blob/main/ofl/golostext/OFL.txt).
- Nunito Sans: [исходный проект и OFL](https://github.com/googlefonts/NunitoSans),
  [авторы](https://github.com/googlefonts/NunitoSans/blob/main/AUTHORS.txt),
  [OFL Google Fonts](https://github.com/google/fonts/blob/main/ofl/nunitosans/OFL.txt).
  Исторический адрес `Fonthausen/NunitoSans` в copyright сохранён как часть notice.
- Leaflet: [BSD 2-Clause для 1.9.4](https://github.com/Leaflet/Leaflet/blob/v1.9.4/LICENSE).
- SIL: [официальный английский текст OFL 1.1](https://openfontlicense.org/open-font-license-official-text/).

## Другие изображения и границы аудита

В каталоге `public/images/globe` находятся три сохранённых NASA-текстуры.
Их URL, даты, SHA-256 и индивидуальные Credits сохранены в
[`provenance.json`](../public/images/globe/provenance.json). Условия задаёт
[NASA Images and Media Usage Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/),
включая атрибуцию и отсутствие подразумеваемой поддержки NASA. Эти материалы
не объявляются MIT, ISC или OFL. Исторические мозаики не показывают текущую
погоду или текущую освещённость Земли.

Для четырёх фотографий `public/images/hotels` сохранены ссылки на страницы
источников в [`hotelPhotos.ts`](../src/shared/lib/hotelPhotos.ts). Сам факт
публикации фотографии на сайте отеля или туристической компании не является
свободной лицензией. Подтверждение прав на повторное распространение этих
четырёх фотографий в репозитории не найдено; им не назначается выдуманная
MIT/Creative Commons-лицензия.

| Файл | Сохранённая страница источника | Найденный лицензионный документ |
| --- | --- | --- |
| `public/images/hotels/shilla-stay-haeundae-exterior.jpg` | [Regent Holidays: Shilla Stay Haeundae](https://www.regent-holidays.co.uk/holiday/south-korea/shilla-stay-haeundae/) | В репозитории не найден |
| `public/images/hotels/shilla-stay-haeundae-room.jpg` | [Regent Holidays: Shilla Stay Haeundae](https://www.regent-holidays.co.uk/holiday/south-korea/shilla-stay-haeundae/) | В репозитории не найден |
| `public/images/hotels/toyoko-inn-haeundae-2.jpg` | [Toyoko Inn: объект 00256](https://www.toyoko-inn.com/eng/search/detail/00256/) | В репозитории не найден |
| `public/images/hotels/grand-josun-busan.jpg` | [Grand Josun Busan: facilities](https://gjb.josunhotel.com/facilities/subMain.do) | В репозитории не найден |

Четыре PNG в `public/images/design` относятся к переданным материалам интерфейса
FigCraft. В репозитории нет отдельного полного лицензионного текста или
проверяемого сведения об авторстве этих PNG: `assistant-orb.png`,
`figcraft-beach.png`, `figcraft-breakfast.png`, `figcraft-stroller.png`.
Их отдельные URL первоисточников в репозитории не указаны. Дата аудита в начале
документа не означает дату создания, публикации или получения этих материалов.
Встроенные контуры мест в
`src/features/places/placePresentation.tsx` также не содержат ссылки на внешний
набор иконок. Этот аудит не приписывает им авторство Cole Bemis или Lucide и
не подменяет неизвестное происхождение лицензией соседней зависимости.

Данные OpenStreetMap и внешние картографические тайлы имеют собственные условия
и атрибуцию. Лицензия библиотеки Leaflet не даёт прав на любые изображения карт.
Скриншоты приложения в `docs/` могут включать материалы перечисленных источников;
они также не получают автоматически единую лицензию MIT.

## Некоммерческий статус и распространение

Некоммерческий учебный статус проекта описывает его назначение. Он не изменяет
лицензии третьих лиц и не заменяет разрешение на фотографии или другие материалы.
MIT, ISC, BSD-2-Clause и OFL-1.1 содержат собственные условия; OFL, в частности,
не разрешает продавать шрифт отдельно и требует сохранять notice и лицензию
при поставке с программой. Упоминание авторов не означает их поддержку проекта.

При распространении самостоятельной сборки сайта или контейнера полные тексты
из этого каталога должны сопровождать поставляемые шрифты и иконки. Ссылка на
Credits не должна быть единственной заменой лицензионных текстов в такой поставке.
