# php-odata-demo — модуль Dolibarr `odatatest` поверх 1С OData

Второе демо к опубликованному стандартному OData 1С (первое — `features/odata-demo`,
страница на Node). Здесь: **генератор** модуля Dolibarr, который даёт список
документов 1С и редактор документа вместе с табличной частью.

PHP руками не пишется — только генерируется. Файлы в docroot редактировать нельзя.

## Запуск

```
features/php-odata-demo/scripts/phpinit.sh                    # composer, один раз
features/odata-demo/scripts/read-1c-odata-metadata.js         # метаданные 1С -> data/dbinfo.json
features/php-odata-demo/scripts/generate-odatatest-module.js  # генерация модуля
```

После генерации модуль нужно **выключить и включить** в админке Dolibarr:
права (`read`/`write`/`delete`) заводятся только при активации.

Предпосылки: поднят стенд (`a pm start --name qemu-win11-1c`), выполнен
`src/publish-1c-odata.js`, OData отвечает.

## Что где

```
data/gen-config.json5   единственный конфиг: список документов, колонки, поля
                        карточки, табличные части, пути, права модуля
data/dbinfo.json        машинный дамп метаданных 1С (аналог dobaerp/data/dbinfo.json)
src/idiomlib/           наши копии модулей dobaerp (см. doc/merge-back.md)
src/pages/              колонки списка и поля карточки из метаданных
src/php/                генераторы PHP: обвязка, карточка, ajax-подсказка
scripts/                оркестратор генерации и приёмочный шлюз
```

Подключение и секреты в конфиг генератора не дублируются: они берутся из
`data/1c-odata.json5` и состояния автосетапа.

## Проверки

```
node features/php-odata-demo/scripts/check-dobaerp-sql-parity.js   # выход WMS не изменился
node --test test/php-odata-demo-generation.test.js                 # манифест + php -l
node --test test/dobaerp-upstream.test.js                          # апстрим не уехал
```

Манифест обновляется осознанно: `ODATATEST_APPROVE=1 node --test test/php-odata-demo-generation.test.js`.

## Ограничения

Существенная часть работы упёрлась в платформу и конфигурацию, а не в код.
Всё измеренное и воспроизведённое — в `doc/deferred-todo.md`; коротко:

* **`If-Match` игнорируется** — документированной оптимистической блокировки нет,
  сверка версии сделана приложением и неатомарна;
* **создание документов** через OData падает на `ОбработкаЗаполнения`;
* **`ПоступлениеТоваровУслуг`** отдаёт HTTP 500 на любое чтение, поэтому в демо
  четыре документа, а не пять;
* **запись перегенерирует номер**, если не передать `Number` явно;
* `$expand` не работает для одиночной сущности, а табличная часть — наоборот,
  читается только одиночной сущностью.
