'use strict';

// Генератор страницы карточки документа: просмотр и редактирование шапки.
//
// Форма собирается в идиоматике Dolibarr (fiche head, таблица border,
// dolGetButtonAction), но данные ходят через OData, а не через БД.
//
// Запись всегда идёт с If-Match по DataVersion, прочитанному при открытии
// формы: 1С отвечает 412, если документ успели изменить, и правки НЕ теряются
// молча (см. doc/odata-locking.md).

function php_string(value) {
    return `'${String(value).replace(/\\/gu, '\\\\').replace(/'/gu, "\\'")}'`;
}

// Настоящий <select> + select2 (идиома Dolibarr для небольших справочников,
// см. Form::select_produits()/selectWarehouses() в ветке, где
// PRODUIT_USE_SEARCH_TO_SELECT выключен: там ровно тот же приём). Список
// вариантов ($select_options[ref_target]) собран заранее одним запросом
// на справочник, см. gen_select_options_preamble ниже.
//
// $name_php -- PHP-выражение, вычисляющее name (может быть литералом вида
// 'field_sklad' или PHP-массивом 'line_tovary_nomenklatura[]' -- <select> не
// требует id === name, в отличие от ajax_autocompleter); $id_php -- отдельное
// PHP-выражение для id (по умолчанию совпадает с $name_php; для строк
// табличной части обязано быть уникальным на строку, иначе select2 в
// нескольких строках зацепит один и тот же элемент); $current_value_php --
// PHP-выражение с текущим GUID; $empty_option_value -- значение "пусто" для
// сентинел-опции: nil-guid для уже существующих значений (так их и отдаёт
// 1С) либо '' для новой строки табличной части, где по пустой строке решают,
// тронул ли пользователь это поле вообще (см. gen_tables_save).
function gen_select_widget({name_php, id_php = name_php, current_value_php, ref_target, empty_option_value}) {
    return [
        `print '<select class="flat minwidth200" name="' . ${name_php} . '" id="' . ${id_php} . '">';`,
        `$odatatest_current = ${current_value_php};`,
        `print '<option value="${empty_option_value}"' . ($odatatest_current === ${php_string(empty_option_value)} ? ' selected' : '') . '>—</option>';`,
        `foreach ($select_options[${php_string(ref_target)}] as $odatatest_option) {`,
        `    print '<option value="' . dol_escape_htmltag($odatatest_option->Ref_Key) . '"' . ($odatatest_option->Ref_Key === $odatatest_current ? ' selected' : '') . '>' . dol_escape_htmltag($odatatest_option->Description) . '</option>';`,
        `}`,
        `print '</select>';`,
        `print ajax_combobox(${id_php});`,
    ].join('\n            ');
}

function gen_field_input(field) {
    const name = `field_${field.slug}`;
    switch (field.kind) {
        case 'boolean':
            return `print $form->selectyesno(${php_string(name)}, $value, 1);`;
        case 'date':
            return `print $form->selectDate($value ? odatatest_parse_date($value) : -1, ${php_string(name)}, 0, 0, 1, '', 1, 0);`;
        case 'number':
            return `print '<input type="text" class="flat maxwidth100 right" name="${name}" value="'.dol_escape_htmltag($value).'">';`;
        case 'reference':
            if (field.pickerKind === 'select') {
                return gen_select_widget({
                    name_php: php_string(name),
                    current_value_php: '$value',
                    ref_target: field.ref_target,
                    empty_option_value: '00000000-0000-0000-0000-000000000000',
                });
            }
            // Запасной вариант для справочников, не прошедших порог
            // data/gen-config.json5#odata.selectMaxOptions (идиома
            // Form::select_company(): видимый текстовый инпут
            // "search_<htmlname>" + ajax_autocompleter(), который сам печатает
            // единственный hidden-инпут "<htmlname>" со значением ключа; свой
            // hidden рядом печатать нельзя -- получится дубликат id/name, и
            // виджет не находит поле по селектору).
            return [
                `print '<input type="text" class="flat minwidth300" name="search_${name}" id="search_${name}" value="'.dol_escape_htmltag(odatatest_presentation($object->{${php_string(field.navigation)}})).'" placeholder="начните вводить, минимум 2 буквы...">';`,
                `print ajax_autocompleter($value, '${name}', DOL_URL_ROOT.'/custom/odatatest/ajax/lookup.php', 'entity_set='.urlencode(${php_string(field.ref_target)}).'&htmlname=${name}', 2, 0);`,
            ].join('\n            ');
        default:
            return `print '<input type="text" class="flat minwidth300" name="${name}" value="'.dol_escape_htmltag($value).'">';`;
    }
}

function gen_field_view(field) {
    switch (field.kind) {
        case 'boolean':
            return `print yn($value ? 1 : 0);`;
        case 'date':
            return `print dol_print_date(odatatest_parse_date($value), 'dayhour', 'tzuser');`;
        case 'number':
            return `print price($value);`;
        case 'reference':
            return `print dol_escape_htmltag(odatatest_presentation($object->{${php_string(field.navigation)}}));`;
        default:
            return `print dol_escape_htmltag($value);`;
    }
}

// Значение из POST -> значение для OData. Числа и даты нельзя слать строкой
// как есть: 1С ждёт свой формат даты и число, а не локализованный текст.
function gen_field_post(field) {
    const name = `field_${field.slug}`;
    switch (field.kind) {
        case 'boolean':
            return `$payload[${php_string(field.name)}] = (GETPOST('${name}', 'alpha') === 'yes');`;
        case 'date':
            return `$payload[${php_string(field.name)}] = odatatest_format_date(dol_mktime(0, 0, 0, GETPOST('${name}month', 'int'), GETPOST('${name}day', 'int'), GETPOST('${name}year', 'int'), 'tzuser'));`;
        case 'number':
            return `$payload[${php_string(field.name)}] = (float) price2num(GETPOST('${name}', 'alpha'));`;
        case 'reference':
            // Пустую ссылку 1С не принимает пустой строкой: "Не вдалося
            // розібрати рядок '' як значення типу Edm.Guid". Пустое значение
            // ссылки в 1С -- это нулевой GUID.
            return `$payload[${php_string(field.name)}] = odatatest_guid_or_empty(GETPOST('${name}', 'alphanohtml'));`;
        default:
            return `$payload[${php_string(field.name)}] = GETPOST('${name}', 'alphanohtml');`;
    }
}


// Табличные части в стиле строк документа Dolibarr (noborder + liste_titre).
// Ссылочные колонки показываются наименованиями: GUID'ы строк разрешаются
// одним запросом на справочник, а не запросом на строку.
function gen_tables_block(tables) {
    if (tables.length === 0) {
        return '';
    }
    const blocks = tables.map((table) => {
        const heads = table.columns.map((column) => `
        print '<td class="liste_titre${column.kind === 'number' ? ' right' : ''}">' . ${php_string(column.label)} . '</td>';`).join('');
        const inputs = table.columns.map((column) => {
            const input_name = `line_${table.slug}_${column.slug}[]`;
            if (column.kind === 'reference' && column.pickerKind === 'select') {
                // <select> не требует id === name (в отличие от
                // ajax_autocompleter), поэтому имя остаётся обычным PHP-массивом
                // (единообразно с остальными колонками; на сохранении читается
                // как $posted_<slug>[$index], см. gen_tables_save), а уникален
                // на строку только id -- select2 должен цеплять конкретный
                // инстанс.
                const widget = gen_select_widget({
                    name_php: php_string(`line_${table.slug}_${column.slug}[]`),
                    id_php: `'line_${table.slug}_${column.slug}_' . $index`,
                    current_value_php: `$line->{${php_string(column.name)}}`,
                    ref_target: column.ref_target,
                    empty_option_value: '00000000-0000-0000-0000-000000000000',
                });
                return `
            print '<td>';
            ${widget}
            print '</td>';`;
            }
            if (column.kind === 'reference') {
                // Запасной вариант (см. data/gen-config.json5#odata.selectMaxOptions):
                // ссылку в строке правим выбором из справочника по наименованию,
                // ajax-подсказка та же, что и в шапке. htmlname обязан быть
                // уникальным на строку и не может быть PHP-массивом ('[]') --
                // ajax_autocompleter() печатает hidden с id === name, а
                // квадратные скобки ломают jQuery id-селектор. Поэтому имя
                // строится через $index, а не через общее имя колонки;
                // на сохранении (gen_tables_save) значение читается по тому
                // же $index, а не GETPOST(..., 'array').
                const htmlname = `'line_${table.slug}_${column.slug}_' . $index`;
                return `
            print '<td>';
            print '<input type="text" class="flat minwidth200" name="search_' . ${htmlname} . '" id="search_' . ${htmlname} . '" value="'.dol_escape_htmltag(isset($references[${php_string(column.ref_target)}][$line->{${php_string(column.name)}}]) ? $references[${php_string(column.ref_target)}][$line->{${php_string(column.name)}}] : '').'" placeholder="начните вводить, минимум 2 буквы...">';
            print ajax_autocompleter($line->{${php_string(column.name)}}, ${htmlname}, DOL_URL_ROOT.'/custom/odatatest/ajax/lookup.php', 'entity_set='.urlencode(${php_string(column.ref_target)}).'&htmlname='.(${htmlname}), 2, 0);
            print '</td>';`;
            }
            if (column.kind === 'number') {
                return `
            print '<td class="right"><input type="text" class="flat maxwidth75 right" name="${input_name}" value="'.dol_escape_htmltag($line->{${php_string(column.name)}}).'"></td>';`;
            }
            return `
            print '<td><input type="text" class="flat" name="${input_name}" value="'.dol_escape_htmltag($line->{${php_string(column.name)}}).'"></td>';`;
        }).join('');

        const new_inputs = table.columns.map((column) => {
            const input_name = `line_${table.slug}_new_${column.slug}`;
            if (column.kind === 'reference' && column.pickerKind === 'select') {
                // Сентинел пустого выбора -- ИМЕННО '' (не nil-guid): по сырому
                // значению этого поля gen_tables_save решает, тронул ли
                // пользователь новую строку вообще (иначе строка не добавится).
                // odatatest_guid_or_empty() на сохранении сама превращает ''
                // в nil-guid, как и для остальных ссылочных полей.
                const widget = gen_select_widget({
                    name_php: php_string(input_name),
                    current_value_php: `''`,
                    ref_target: column.ref_target,
                    empty_option_value: '',
                });
                return `
        print '<td>';
        ${widget}
        print '</td>';`;
            }
            if (column.kind === 'reference') {
                return `
        print '<td>';
        print '<input type="text" class="flat minwidth200" name="search_${input_name}" id="search_${input_name}" value="" placeholder="' . ${php_string('добавить: ' + column.label)} . '">';
        print ajax_autocompleter('', '${input_name}', DOL_URL_ROOT.'/custom/odatatest/ajax/lookup.php', 'entity_set='.urlencode(${php_string(column.ref_target)}).'&htmlname=${input_name}', 2, 0);
        print '</td>';`;
            }
            return `
        print '<td${column.kind === 'number' ? ' class="right"' : ''}><input type="text" class="flat maxwidth75${column.kind === 'number' ? ' right' : ''}" name="${input_name}" value=""></td>';`;
        }).join('');

        const cells = table.columns.map((column) => {
            if (column.kind === 'reference') {
                return `
            print '<td>' . dol_escape_htmltag(isset($references[${php_string(column.ref_target)}][$line->{${php_string(column.name)}}]) ? $references[${php_string(column.ref_target)}][$line->{${php_string(column.name)}}] : '') . '</td>';`;
            }
            if (column.kind === 'number') {
                return `
            print '<td class="right">' . price($line->{${php_string(column.name)}}) . '</td>';`;
            }
            if (column.kind === 'date') {
                return `
            print '<td>' . dol_print_date(odatatest_parse_date($line->{${php_string(column.name)}}), 'day', 'tzuser') . '</td>';`;
            }
            return `
            print '<td>' . dol_escape_htmltag($line->{${php_string(column.name)}}) . '</td>';`;
        }).join('');
        return `
    print '<br>';
    print load_fiche_titre(${php_string(table.title)}, '', '');
    print '<div class="div-table-responsive-no-min">';
    print '<table class="noborder centpercent">';
    print '<tr class="liste_titre">';
    print '<td class="liste_titre" width="30">#</td>';${heads}
    print '<td class="liste_titre center" width="40">' . ($edit_mode ? $langs->trans('Delete') : '') . '</td>';
    print '</tr>';
    $lines = isset($tables[${php_string(table.name)}]) ? $tables[${php_string(table.name)}] : array();
    if (!$lines) {
        print '<tr class="oddeven"><td colspan="' . ${table.columns.length + 2} . '"><span class="opacitymedium">' . $langs->trans('NoRecordFound') . '</span></td></tr>';
    }
    $index = 0;
    foreach ($lines as $line) {
        print '<tr class="oddeven">';
        print '<td>' . dol_escape_htmltag($line->LineNumber) . '</td>';
        if ($edit_mode) {
            // LineNumber уезжает скрытым полем: он адресует строку при
            // сборке новой коллекции. Между запросами он нестабилен,
            // поэтому используется только внутри одного сохранения.
            print '<input type="hidden" name="line_${table.slug}_number[]" value="' . dol_escape_htmltag($line->LineNumber) . '">';
        }
        if ($edit_mode) {${inputs}
        } else {${cells}
        }
        if ($edit_mode) {
            print '<td class="center"><input type="checkbox" name="line_${table.slug}_delete[]" value="' . (int) $index . '"></td>';
        } else {
            print '<td></td>';
        }
        print '</tr>';
        $index++;
    }
    if ($edit_mode) {
        // Пустая строка для добавления. 1С принимает новую строку с одними
        // только реквизитами формы -- остальные заполняются значениями по
        // умолчанию (проверено: Упаковка_Key приходит нулевым GUID).
        print '<tr class="oddeven">';
        print '<td><span class="opacitymedium">+</span></td>';${new_inputs}
        print '<td></td>';
        print '</tr>';
    }
    print '</table>';
    print '</div>';`;
    }).join('\n');

    // Разрешение ссылок: собираем GUID'ы по всем таблицам и спрашиваем
    // каждый справочник один раз.
    const reference_columns = tables.flatMap((table) => table.columns
        .filter((column) => column.kind === 'reference')
        .map((column) => ({table: table.name, name: column.name, ref_target: column.ref_target})));
    const resolve = reference_columns.map((column) => `
$keys = array();
foreach (isset($tables[${php_string(column.table)}]) ? $tables[${php_string(column.table)}] : array() as $line) {
    $keys[] = $line->{${php_string(column.name)}};
}
$references[${php_string(column.ref_target)}] = odatatest_resolve_references(${php_string(column.ref_target)}, $keys)
    + (isset($references[${php_string(column.ref_target)}]) ? $references[${php_string(column.ref_target)}] : array());`).join('');

    return `
$tables = odatatest_fetch_tables($entity_set, $ref, array(${tables.map((table) => php_string(table.name)).join(', ')}));
$references = array();${resolve}
${blocks}
`;
}


// Сборка табличных частей для записи. Строки перечитываются целиком и правки
// накладываются поверх: OData заменяет коллекцию целиком, поэтому всё, что
// не отправлено, будет потеряно.
function gen_tables_save(tables, namespace) {
    if (tables.length === 0) {
        return '';
    }
    return tables.map((table) => {
        const edits = table.columns.map((column) => {
            if (column.kind === 'reference' && column.pickerKind === 'autocomplete') {
                // Запасной вариант (см. data/gen-config.json5#odata.selectMaxOptions):
                // эта колонка не идёт через $posted_<slug>[$index] -- её
                // htmlname на форме не PHP-массив (см. gen_tables_block), а
                // уникальное на строку имя вида 'line_<table>_<col>_<index>'.
                // Значение поэтому читается поштучно, тем же $index, которым
                // и так уже перебираются строки.
                const field_name = `'line_${table.slug}_${column.slug}_' . $index`;
                return `
                ${php_string(column.name)} => GETPOSTISSET(${field_name}) ? odatatest_guid_or_empty(GETPOST(${field_name}, 'alphanohtml')) : $line->{${php_string(column.name)}},`;
            }
            // И обычные колонки, и ссылочные с <select> (htmlname -- обычный
            // PHP-массив, см. gen_tables_block) читаются одинаково.
            const post = column.kind === 'number'
                ? `(float) price2num($posted_${column.slug}[$index])`
                : (column.kind === 'reference' ? `odatatest_guid_or_empty($posted_${column.slug}[$index])` : `$posted_${column.slug}[$index]`);
            return `
                ${php_string(column.name)} => isset($posted_${column.slug}[$index]) ? ${post} : $line->{${php_string(column.name)}},`;
        }).join('');
        const new_values = table.columns.map((column) => {
            const post = `GETPOST('line_${table.slug}_new_${column.slug}', 'alphanohtml')`;
            const value = column.kind === 'number'
                ? `(float) price2num(${post})`
                : (column.kind === 'reference' ? `odatatest_guid_or_empty(${post})` : post);
            return `${php_string(column.name)} => ${value}`;
        }).join(', ');

        const new_raw = table.columns
            .map((column) => `GETPOST('line_${table.slug}_new_${column.slug}', 'alphanohtml')`)
            .join(', ');

        // Ссылочные колонки с запасным (autocomplete) виджетом читаются
        // поштучно внутри цикла (см. edits выше), общий массив для них не
        // собирается. У select-виджета htmlname -- обычный PHP-массив,
        // как и у нессылочных колонок.
        const posted = table.columns
            .filter((column) => !(column.kind === 'reference' && column.pickerKind === 'autocomplete'))
            .map((column) => `
        $posted_${column.slug} = GETPOST('line_${table.slug}_${column.slug}', 'array');`).join('');

        return `
    // --- табличная часть ${table.name}
    $current = odatatest_fetch_tables($entity_set, $ref, array(${php_string(table.name)}));
    $deleted = GETPOST('line_${table.slug}_delete', 'array');${posted}
    $rows = array();
    $index = 0;
    $line_number = 0;
    foreach ($current[${php_string(table.name)}] as $line) {
        if (in_array((string) $index, $deleted, true)) {
            $index++;
            continue;
        }
        $line_number++;
        $edits = array(
            'LineNumber' => $line_number,${edits}
        );
        $rows[] = odatatest_merge_line($line, $edits);
        $index++;
    }
    // Новая строка добавляется, только если в ней что-то заполнено:
    // пустая форма не должна плодить мусорные строки.
    $new_values = array(${new_values});
    // Решение "добавлять ли строку" принимается по СЫРЫМ значениям формы:
    // после преобразования пустое число становится 0.0, и пустая строка
    // формы выглядела бы заполненной.
    $new_raw = array(${new_raw});
    $has_new = false;
    foreach ($new_raw as $new_value) {
        if (trim((string) $new_value) !== '') {
            $has_new = true;
        }
    }
    if ($has_new) {
        $rows[] = array('LineNumber' => $line_number + 1) + $new_values;
    }

    $payload = $payload + odatatest_table_payload(${php_string(namespace)}, $entity_set, ${php_string(table.name)}, $rows);`;
    }).join('\n');
}

// Собирает варианты для всех select-виджетов страницы ОДИН раз на справочник
// (даже если один и тот же справочник встречается и в шапке, и в таблице).
// Только для $edit_mode -- в режиме просмотра выбор не нужен вообще.
function gen_select_options_preamble(fields, tables) {
    const ref_targets = new Set();
    for (const field of fields) {
        if (field.kind === 'reference' && field.pickerKind === 'select') ref_targets.add(field.ref_target);
    }
    for (const table of tables) {
        for (const column of table.columns) {
            if (column.kind === 'reference' && column.pickerKind === 'select') ref_targets.add(column.ref_target);
        }
    }
    if (ref_targets.size === 0) return '';
    const fetches = [...ref_targets].map((ref_target) => `    $select_options[${php_string(ref_target)}] = odatatest_select_options(${php_string(ref_target)});`).join('\n');
    return `
$select_options = array();
if ($edit_mode) {
${fetches}
}
`;
}

function gen_card_page({document, entity_set, fields, select_fields, expand, read_only, tables, namespace}) {
    const editable = fields.filter((field) => field.editable);
    const rows = fields.map((field) => `
    print '<tr><td class="titlefield">' . ${php_string(field.label)} . '</td><td>';
    $value = $object->{${php_string(field.name)}} ?? '';
    if ($edit_mode && ${field.editable ? 'true' : 'false'}) {
        ${gen_field_input(field)}
    } else {
        ${gen_field_view(field)}
    }
    print '</td></tr>';`).join('\n');

    return `<?php

// СГЕНЕРИРОВАНО features/php-odata-demo. Не редактировать.

// Включает select2 для <select> ссылочных полей (ajax_combobox() в
// core/lib/ajax.lib.php иначе ничего не печатает: на этом стенде глобальная
// конфигурация MAIN_USE_JQUERY_MULTISELECT не выставлена). Обязано стоять до
// подключения main.inc.php -- решение принимается при выводе <head>.
define('REQUIRE_JQUERY_MULTISELECT', 'select2');

$res = 0;
foreach (array('../../main.inc.php', '../../../main.inc.php') as $candidate) {
    if (file_exists(__DIR__ . '/' . $candidate)) {
        $res = @include __DIR__ . '/' . $candidate;
        break;
    }
}
if (!$res) {
    die('Include of main fails');
}
require_once DOL_DOCUMENT_ROOT . '/core/lib/ajax.lib.php';
require_once __DIR__ . '/odatatest.inc.php';
include __DIR__ . '/page_access.inc.php';

$langs->loadLangs(array('other'));
$form = new Form($db);

$ref = GETPOST('ref', 'alphanohtml');
$action = GETPOST('action', 'aZ09');
$entity_set = ${php_string(entity_set)};
$list_url = DOL_URL_ROOT . '/custom/odatatest/${document.slug}-list.php';
// Право на изменение -- это И право Dolibarr, И право, объявленное для типа
// в data/1c-odata.json5: у документа только на чтение форма остаётся смотровой.
$can_write = ${read_only ? 'false' : "\$user->hasRight('odatatest', 'write')"};

$create_mode = (($action === 'create' || $action === 'add') && $can_write);

if ($ref === '' && !$create_mode) {
    header('Location: ' . $list_url);
    exit;
}

$select = ${php_string(select_fields.join(','))};
$expand = array(${expand.map((name) => php_string(name)).join(', ')});

if ($action === 'update' && $can_write) {
    if (!GETPOST('cancel', 'alpha')) {
        $payload = array();
        // Номер передаётся всегда, хотя он не редактируется. Иначе 1С при
        // записи перегенерирует его и документ теряет префикс
        // (ТП00-000001 -> 0000-000001) -- проверено на живой ИБ,
        // см. doc/deferred-todo.md.
        $payload['Number'] = GETPOST('document_number', 'alphanohtml');
${editable.map((field) => '        ' + gen_field_post(field)).join('\n')}
${gen_tables_save(tables, namespace)}
        $result = odatatest_update_entity($entity_set, $ref, $payload, GETPOST('data_version', 'alphanohtml'));
        if ($result['ok']) {
            setEventMessages('Документ записан в 1С', null, 'mesgs');
        } elseif ($result['conflict']) {
            // 412: документ изменили в 1С или в другом окне после того, как мы
            // его прочитали. Ничего не записано -- показываем свежие данные.
            setEventMessages('Документ был изменён другим сеансом. Данные перечитаны, повторите правку.', null, 'warnings');
        } else {
            setEventMessages($result['message'], null, 'errors');
        }
    }
    $action = '';
}

if ($action === 'add' && $can_write) {
    if (!GETPOST('cancel', 'alpha')) {
        $payload = array();
${editable.map((field) => '        ' + gen_field_post(field)).join('\n')}
        $result = odatatest_create_entity($entity_set, $payload);
        if ($result['ok']) {
            setEventMessages('Документ создан в 1С', null, 'mesgs');
            header('Location: ' . $_SERVER['PHP_SELF'] . '?ref=' . urlencode($result['ref']));
            exit;
        }
        setEventMessages($result['message'], null, 'errors');
        $action = 'create';
    } else {
        header('Location: ' . $list_url);
        exit;
    }
}

if ($action === 'markdelete' && $can_write) {
    $result = odatatest_set_deletion_mark($entity_set, $ref, true);
    setEventMessages($result['ok'] ? 'Пометка удаления установлена' : $result['message'], null, $result['ok'] ? 'mesgs' : 'errors');
    $action = '';
}

if ($action === 'unmarkdelete' && $can_write) {
    $result = odatatest_set_deletion_mark($entity_set, $ref, false);
    setEventMessages($result['ok'] ? 'Пометка удаления снята' : $result['message'], null, $result['ok'] ? 'mesgs' : 'errors');
    $action = '';
}

if ($action === 'confirm_delete' && $user->hasRight('odatatest', 'delete') && $can_write) {
    // Физическое удаление -- отдельная команда, не то же самое, что пометка.
    $result = odatatest_delete_entity($entity_set, $ref);
    if ($result['ok']) {
        setEventMessages('Документ удалён физически', null, 'mesgs');
        header('Location: ' . $list_url);
        exit;
    }
    setEventMessages($result['message'], null, 'errors');
    $action = '';
}

// В режиме создания читать нечего: форма заполняется значениями по умолчанию.
$object = $create_mode ? new stdClass() : odatatest_fetch_entity($entity_set, $ref, $select, $expand);
$edit_mode = (($action === 'edit') && $can_write) || $create_mode;
${gen_select_options_preamble(fields, tables)}
llxHeader('', ${php_string(document.title)});

$head = array();
$head[0] = array($_SERVER['PHP_SELF'] . '?ref=' . urlencode($ref), ${php_string(document.title)}, 'card');
print dol_get_fiche_head($head, 'card', ${php_string(document.title)}, -1, 'generic');

$linkback = '<a href="' . $list_url . '">' . $langs->trans('BackToList') . '</a>';
print '<div class="underbanner clearboth"></div>';

if ($action === 'delete') {
    // Физическое удаление необратимо -- спрашиваем штатным диалогом Dolibarr.
    print $form->formconfirm(
        $_SERVER['PHP_SELF'] . '?ref=' . urlencode($ref),
        'Физическое удаление документа',
        'Документ будет удалён из 1С безвозвратно. Обычно вместо этого ставят пометку удаления. Продолжить?',
        'confirm_delete',
        '',
        0,
        1
    );
}

if ($edit_mode) {
    print '<form method="POST" action="' . $_SERVER['PHP_SELF'] . ($create_mode ? '' : ('?ref=' . urlencode($ref))) . '">';
    print '<input type="hidden" name="token" value="' . newToken() . '">';
    print '<input type="hidden" name="action" value="' . ($create_mode ? 'add' : 'update') . '">';
    // DataVersion уезжает в форму и возвращается в If-Match: только так
    // можно заметить чужую запись между чтением и сохранением.
    if (!$create_mode) {
        print '<input type="hidden" name="data_version" value="' . dol_escape_htmltag($object->DataVersion) . '">';
        print '<input type="hidden" name="document_number" value="' . dol_escape_htmltag($object->Number) . '">';
    }
}

print '<table class="border centpercent tableforfield">';
${rows}
print '</table>';

if (!$create_mode) {
${gen_tables_block(tables)}
}

if ($edit_mode) {
    print '<div class="center">';
    print '<input type="submit" class="button button-save" value="' . $langs->trans('Save') . '">';
    print '&nbsp;<input type="submit" class="button button-cancel" name="cancel" value="' . $langs->trans('Cancel') . '">';
    print '</div>';
    print '</form>';
}

print dol_get_fiche_end();

if (!$edit_mode && !$create_mode) {
    print '<div class="tabsAction">';
    if ($can_write) {
        print dolGetButtonAction('', $langs->trans('Modify'), 'default', $_SERVER['PHP_SELF'] . '?ref=' . urlencode($ref) . '&action=edit', '', true);
        if (empty($object->DeletionMark)) {
            print dolGetButtonAction('', 'Пометить на удаление', 'delete', $_SERVER['PHP_SELF'] . '?ref=' . urlencode($ref) . '&action=markdelete&token=' . newToken(), '', true);
        } else {
            print dolGetButtonAction('', 'Снять пометку удаления', 'default', $_SERVER['PHP_SELF'] . '?ref=' . urlencode($ref) . '&action=unmarkdelete&token=' . newToken(), '', true);
        }
        if ($user->hasRight('odatatest', 'delete')) {
            print dolGetButtonAction('', 'Удалить физически', 'delete', $_SERVER['PHP_SELF'] . '?ref=' . urlencode($ref) . '&action=delete', '', true);
        }
    } else {
        print dolGetButtonAction('Только чтение: у типа документа нет права на изменение', $langs->trans('Modify'), 'default', '#', '', false);
    }
    print '</div>';
    print '<br>' . $linkback;
}

llxFooter();
$db->close();
`;
}

module.exports.gen_card_page = gen_card_page;
