Нет, готового действительно comprehensive-примера в этих PHP-пакетах я не нашёл. У `kilylabs` вопрос про редактирование табличной части [висит без ответа с 2019 года](https://github.com/kilylabs/odata-1c/issues/5), а тесты `Dakword` создание/редактирование вообще не покрывают.

Ближайший нормальный первоисточник — [пример стандартного OData 1С](https://42clouds.com/ru-ru/manuals/interfeys-odata-primery-tipovykh-operatsiy/). Там показан `PATCH` объекта `Catalog_Магазины` вместе с табличной частью `ТорговыеЗалы`. Главное правило: при изменении табличную часть надо передавать целиком — это replace collection, а не patch отдельной строки.

Для `Dakword` полный цикл выглядел бы примерно так:

```php
use Dakword\OData1C\Client\ODataClient;

$odata = new ODataClient($base_url, $login, $password);
$stores = $odata->query('Catalog_Магазины');

/*
 * 1. Создание master вместе с detail.
 */
$created = $stores->create([
    'Description' => 'Магазин №1',

    'ТорговыеЗалы@odata.type' =>
        'Collection(StandardODATA.Catalog_Магазины_ТорговыеЗалы_RowType)',

    'ТорговыеЗалы' => [
        [
            'LineNumber' => 1,
            'Название' => 'Синий зал',
            'Площадь' => 56,
            'ДатаОткрытия' => '2026-08-22T00:00:00',
        ],
        [
            'LineNumber' => 2,
            'Название' => 'Красный зал',
            'Площадь' => 40,
            'ДатаОткрытия' => '2026-08-22T00:00:00',
        ],
    ],
]);

$id = $created->Ref_Key;

/*
 * 2. Повторное чтение master + detail.
 */
$current = $odata
    ->query('Catalog_Магазины')
    ->select(
        'Ref_Key,DataVersion,Description',
        [
            'ТорговыеЗалы' =>
                'LineNumber,Название,Площадь,ДатаОткрытия',
        ]
    )
    ->get($id);

/*
 * 3. Замена всей табличной части:
 *    первая строка изменена, вторая удалена, третья добавлена.
 */
$payload = [
    'Description' => 'Магазин №1, обновлён',

    'ТорговыеЗалы@odata.type' =>
        'Collection(StandardODATA.Catalog_Магазины_ТорговыеЗалы_RowType)',

    'ТорговыеЗалы' => [
        [
            'LineNumber' => 1,
            'Название' => 'Синий зал',
            'Площадь' => 72,
            'ДатаОткрытия' => '2026-08-22T00:00:00',
        ],
        [
            'LineNumber' => 2,
            'Название' => 'Зелёный зал',
            'Площадь' => 25,
            'ДатаОткрытия' => '2026-09-01T00:00:00',
        ],
    ],
];

/*
 * Можно вызвать $stores->update($id, $payload), но тогда нет
 * оптимистической блокировки. Через request добавляем If-Match.
 */
$odata->request(
    'PATCH',
    "Catalog_Магазины(guid'{$id}')",
    $payload,
    [
        'If-Match' => $current->DataVersion,
    ]
);
```

Для документа всё аналогично:

```php
'Товары@odata.type' =>
    'Collection(StandardODATA.Document_ЗаказКлиента_Товары_RowType)',

'Товары' => [
    [
        'LineNumber' => 1,
        'Номенклатура_Key' => $product_id,
        'Количество' => 2,
        'Цена' => 100,
        'Сумма' => 200,
    ],
],
```

И ещё поправка к моему предыдущему ответу: `Dakword/odata1c-client` фактически требует PHP 8.0+, хотя автор забыл указать это в `composer.json`. В исходниках есть `match`, union types и `str_starts_with`. Для PHP 7.4 остаётся `kilylabs`, но comprehensive master-detail поддержку поверх него придётся оформлять самим тем же способом — массив целиком в `create()`/`update()`.
