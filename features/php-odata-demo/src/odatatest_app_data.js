'use strict';

// Состав миксинов страниц модуля `odatatest`.
//
// Всё переиспользуется из dobaerp по относительным путям (они резолвятся
// относительно interlink/mixins_linker.js). Абсолютным путём подменяется
// только то, что мы расшили у себя: link_mixins_dynamically специально
// поддерживает абсолютные пути (`def.require.startsWith('/')`).

const pth = require('path');

const OUR_IDIOMLIB = pth.join(__dirname, 'idiomlib');

const _classes_for_any = [
    {require: '../idiomlibutils/app_generic', class: 'AppGeneric', single_exports: false},
    {require: '../idiomlib/php_module', single_exports: true},
    {require: '../idiomlibutils/php_combinators', single_exports: true},
    {require: '../idiomlibutils/dol_page_base', class: 'Dol_PageBase', single_exports: false, base: true},
    {require: '../idiomlib/dol_use_params', single_exports: true},
    {require: '../idiomlib/dol_page_layout', single_exports: true},
    {require: '../idiomlib/dol_links', single_exports: true},
    {require: '../idiomlib/dol_requires', single_exports: true},
    {require: '../idiomlib/dol_set_fields', class: 'DOL_SetFields', single_exports: false},
    {require: '../idiomlib/dol_db', class: 'Dol_DB', single_exports: false},
    // В WMS у этих двух записей стоит `class:`, но это состав для СТАТИЧЕСКОГО
    // линковщика (он использует имя лишь для генерации кода). Динамический
    // линковщик по `class` делает реальную проекцию экспорта, а оба модуля
    // экспортируют миксин напрямую -- поэтому проекции здесь нет.
    {require: '../idiomlib/dol_db_ops', single_exports: true},
    {require: '../idiomlib/dol_static_parts', single_exports: true},
];

const _classes_for_table_view = [
    ..._classes_for_any,
    // Наша расшитая раскладка: та же самая, что у dobaerp, но умеющая брать
    // строки не только из SQL.
    {require: pth.join(OUR_IDIOMLIB, 'dol_table_layout'), single_exports: true},
    {require: '../idiomlib/dol_auto_labels', single_exports: true},
    {require: '../idiomlib/dol_display_value', single_exports: true},
    {require: '../idiominterp/dol_data_driven', class: 'DOL_DataDriven', single_exports: false},
];

const all_classes = {
    doc_list: _classes_for_table_view,
};

module.exports.all_classes = all_classes;
