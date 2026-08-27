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
            // Идиома Dolibarr для больших справочников: инпут + ajax-подсказка.
            // Списком тут обойтись нельзя -- в Номенклатуре сотни тысяч позиций.
            return [
                `print '<input type="hidden" name="${name}" id="${name}" value="'.dol_escape_htmltag($value).'">';`,
                `print '<input type="text" class="flat minwidth300" name="${name}_label" id="${name}_label" value="'.dol_escape_htmltag(odatatest_presentation($object->{${php_string(field.navigation)}})).'">';`,
                `print ajax_autocompleter($value, '${name}', DOL_URL_ROOT.'/custom/odatatest/ajax/lookup.php?entity_set='.urlencode(${php_string(field.ref_target)}), '', 2, 0);`,
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

function gen_card_page({document, entity_set, fields, select_fields, expand, read_only}) {
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

if ($ref === '') {
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

$object = odatatest_fetch_entity($entity_set, $ref, $select, $expand);
$edit_mode = ($action === 'edit' && $can_write);

llxHeader('', ${php_string(document.title)});

$head = array();
$head[0] = array($_SERVER['PHP_SELF'] . '?ref=' . urlencode($ref), ${php_string(document.title)}, 'card');
print dol_get_fiche_head($head, 'card', ${php_string(document.title)}, -1, 'generic');

$linkback = '<a href="' . $list_url . '">' . $langs->trans('BackToList') . '</a>';
print '<div class="underbanner clearboth"></div>';

if ($edit_mode) {
    print '<form method="POST" action="' . $_SERVER['PHP_SELF'] . '?ref=' . urlencode($ref) . '">';
    print '<input type="hidden" name="token" value="' . newToken() . '">';
    print '<input type="hidden" name="action" value="update">';
    // DataVersion уезжает в форму и возвращается в If-Match: только так
    // можно заметить чужую запись между чтением и сохранением.
    print '<input type="hidden" name="data_version" value="' . dol_escape_htmltag($object->DataVersion) . '">';
    print '<input type="hidden" name="document_number" value="' . dol_escape_htmltag($object->Number) . '">';
}

print '<table class="border centpercent tableforfield">';
${rows}
print '</table>';

if ($edit_mode) {
    print '<div class="center">';
    print '<input type="submit" class="button button-save" value="' . $langs->trans('Save') . '">';
    print '&nbsp;<input type="submit" class="button button-cancel" name="cancel" value="' . $langs->trans('Cancel') . '">';
    print '</div>';
    print '</form>';
}

print dol_get_fiche_end();

if (!$edit_mode) {
    print '<div class="tabsAction">';
    if ($can_write) {
        print dolGetButtonAction('', $langs->trans('Modify'), 'default', $_SERVER['PHP_SELF'] . '?ref=' . urlencode($ref) . '&action=edit', '', true);
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
