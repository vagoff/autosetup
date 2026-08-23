Да, PHP-аналоги есть. Но полного эквивалента современного `hacker-cb/1c-odata` я не нашёл.

Лучший функциональный кандидат — [Dakword/odata1c-client](https://github.com/Dakword/odata1c-client):

* специально для стандартного OData-интерфейса 1С;
* читает список объектов и `$metadata`;
* fluent query builder: `select`, `expand`, `where/orWhere`, `orderby`, `top/skip`;
* функции OData V3: `guid`, `datetime`, `cast`, `substring`, `startswith` и т. п.;
* CRUD;
* пометка/снятие пометки удаления;
* проведение/отмена проведения;
* поддерживает составные ключи регистров;
* зависит только от Guzzle `^7.5`, следовательно работает на PHP 7.4.

Пример:

```bash
composer require dakword/odata1c-client
```

```php
use Dakword\OData1C\Client\ODataClient;

$odata = new ODataClient(
    'https://host/base/odata/standard.odata/',
    'user',
    'password'
);

$orders = $odata
    ->query('Document_ЗаказКлиента')
    ->where('DeletionMark', false)
    ->orderBy('Date', 'desc')
    ->take(50)
    ->getValues();
```

Но проект маленький: всего несколько коммитов, 3 звезды, нормальных релизов нет. Последнее обновление — январь 2025. То есть функционально приятный, организационно хрупкий.

Более проверенный вариант — [kilylabs/odata-1c](https://github.com/kilylabs/odata-1c):

```bash
composer require kilylabs/odata-1c
```

У него около 42 тысяч установок и 77 звёзд. Есть фильтры, `expand`, CRUD, проведение и отмена проведения. Но последняя версия вышла в 2022 году, API проще и практически отсутствует работа с метаданными. [Packagist](https://packagist.org/packages/kilylabs/odata-1c).

Ещё есть [mihpa/odata-1c-php](https://github.com/mihpa/odata-1c-php): `select`, `expand`, `filter`, сортировка, пагинация, CRUD и проведение документов. Однако это совсем малораспространённый пакет — около 70 установок, поэтому смысла выбирать его вместо двух вышеназванных почти нет. [Packagist](https://packagist.org/packages/mihpa/odata-1c-php).

Итого: для Dolibarr я бы взял `Dakword/odata1c-client`, прогнал на твоих реальных запросах и зафиксировал конкретный commit в `composer.lock`. Если нужна более консервативная и простая зависимость — `kilylabs/odata-1c`.

Чего ни один из них не заменяет из [`hacker-cb/1c-odata`](https://github.com/hacker-cb/1c-odata): codegen из `$metadata`, типизацию схемы, автоматическую обработку `DateTime`/`Int64`/`ValueStorage`, write-validation, развитую иерархию ошибок, retry/hooks и специальные фасады виртуальных таблиц регистров. То есть для обычного Dolibarr ↔ 1С CRUD аналог есть; 1:1 PHP-порта всего пакета — нет.
