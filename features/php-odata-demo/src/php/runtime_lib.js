'use strict';

// PHP-обвязка времени выполнения для сгенерированного модуля.
// Генерируется целиком (правка файлов в docroot запрещена), поэтому здесь
// живёт её единственный исходник.

function gen_env_secrets_include({secrets_path}) {
    // Тот же формат .env.secrets, что уже используется в custom/wms,
    // но лоадер один на модуль, а не скопированный дважды, как там.
    return `<?php

/**
 * Читает файл секретов модуля. Формат -- как у shell: KEY=value, допускаются
 * "export ", кавычки и комментарии. Файл не генерируется целиком: секреты
 * пишутся в размеченный регион, чужие строки не трогаются.
 *
 * Файл лежит ВНЕ docroot: веб-сервер этого стенда отдаёт dot-файлы наружу,
 * и custom/<module>/.env.secrets скачивается кем угодно по HTTP.
 */
function odatatest_load_secrets()
{
    static $secrets = null;
    if ($secrets !== null) {
        return $secrets;
    }
    $secrets = array();
    $path = '${secrets_path}';
    if (!is_readable($path)) {
        throw new Exception('odatatest: ' . $path . ' is missing or not readable');
    }
    foreach (file($path) as $raw_line) {
        $line = trim($raw_line);
        if ($line === '' || $line[0] === '#') {
            continue;
        }
        if (strpos($line, 'export ') === 0) {
            $line = trim(substr($line, 7));
        }
        if (!preg_match('/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/', $line, $matches)) {
            continue;
        }
        $value = trim($matches[2]);
        $quoted = strlen($value) >= 2
            && (($value[0] === '"' && substr($value, -1) === '"')
                || ($value[0] === "'" && substr($value, -1) === "'"));
        if ($quoted) {
            $value = substr($value, 1, -1);
        }
        $secrets[$matches[1]] = $value;
    }
    return $secrets;
}

function odatatest_secret($name)
{
    $secrets = odatatest_load_secrets();
    if (!isset($secrets[$name]) || $secrets[$name] === '') {
        throw new Exception('odatatest: secret ' . $name . ' is not set in .env.secrets');
    }
    return $secrets[$name];
}
`;
}

function gen_client_include({vendor_autoload_path, server_timezone, request_timeout_seconds}) {
    return `<?php

require_once __DIR__ . '/env_secrets.inc.php';
require_once '${vendor_autoload_path}';

use Dakword\\OData1C\\Client\\ODataClient;

/**
 * Клиент стандартного OData 1С. Один на запрос.
 */
function odatatest_client()
{
    static $client = null;
    if ($client === null) {
        $client = new ODataClient(
            odatatest_secret('ODATA_BASE_URI'),
            odatatest_secret('ODATA_LOGIN'),
            odatatest_secret('ODATA_PASSWORD')
        );
        $client->setTimeout(${request_timeout_seconds});
    }
    return $client;
}

/**
 * Дата 1С ("2020-05-01T00:00:00", без зоны) -> unix timestamp.
 * Зона сервера 1С задана в конфигурации автосетапа, а не угадывается:
 * иначе даты поедут ровно на смещение зоны.
 */
function odatatest_parse_date($value)
{
    if ($value === null || $value === '') {
        return null;
    }
    $date = DateTime::createFromFormat('Y-m-d\\TH:i:s', $value, new DateTimeZone('${server_timezone}'));
    if ($date === false) {
        return null;
    }
    return $date->getTimestamp();
}

/** unix timestamp -> дата в формате, который принимает 1С. */
function odatatest_format_date($timestamp)
{
    $date = new DateTime('@' . (int) $timestamp);
    $date->setTimezone(new DateTimeZone('${server_timezone}'));
    return $date->format('Y-m-d\\TH:i:s');
}

/** Экранирование строкового литерала OData: одинарная кавычка удваивается. */
function odatatest_quote($value)
{
    return "'" . str_replace("'", "''", (string) $value) . "'";
}

function odatatest_filter_substring($property, $value)
{
    return 'substringof(' . odatatest_quote($value) . ', ' . $property . ')';
}

function odatatest_filter_guid($property, $value)
{
    return $property . " eq guid'" . preg_replace('/[^0-9a-fA-F-]/', '', (string) $value) . "'";
}

function odatatest_filter_boolean($property, $value)
{
    return $property . ' eq ' . (((string) $value === '1') ? 'true' : 'false');
}

function odatatest_filter_date($property, $value, $operator)
{
    return $property . ' ' . $operator . " datetime'" . odatatest_format_date($value) . "'";
}


/**
 * Один документ по ссылке. $expand нужен там же, где и в списке: 1С отдаёт
 * связанный объект только если его поле указано и в $select.
 */
function odatatest_fetch_entity($entity_set, $ref, $select, $expand = array())
{
    // Читаем документ как КОЛЛЕКЦИЮ из одной строки, а не как одиночную
    // сущность. Причина -- ограничение платформы: на запрос вида
    // Document_X(guid'...') 1С отвечает "Опція $expand не підтримується
    // у разі запиту одиночних сутностей", а без $expand не получить
    // представления ссылочных реквизитов. Через $filter всё работает
    // и укладывается в один запрос вместо запроса на каждую ссылку.
    if (!preg_match('/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i', $ref)) {
        throw new Exception('odatatest: malformed reference ' . $ref);
    }
    $result = odatatest_fetch_list(array(
        'entity_set' => $entity_set,
        'select' => $select,
        'expand' => $expand,
        'filters' => array("Ref_Key eq guid'" . $ref . "'"),
        'sort_property' => '',
        'sort_order' => '',
        'limit' => 1,
        'offset' => 0,
        'count_total' => false,
    ));
    if (empty($result['rows'])) {
        throw new Exception('odatatest: document ' . $ref . ' not found in ' . $entity_set);
    }
    return $result['rows'][0];
}

/**
 * Запись документа с проверкой версии.
 *
 * ВАЖНО про блокировку. Заголовок If-Match эта 1С ИГНОРИРУЕТ: проверено
 * напрямую -- PATCH с заведомо неверным If-Match вернул HTTP 200 и applied
 * запись (DataVersion сменился). То есть documented-поведение
 * "412 Precondition Failed" тут не работает, и полагаться на него нельзя.
 *
 * Поэтому версия сверяется приложением: перед записью документ перечитывается
 * и его DataVersion сравнивается с тем, который ушёл в форму. Это НЕ атомарно
 * (между проверкой и PATCH остаётся окно в доли секунды), но ловит реальный
 * сценарий -- пока пользователь заполнял форму, документ изменили в 1С.
 * If-Match продолжаем слать: он безвреден и заработает, если платформа
 * начнёт его учитывать.
 *
 * Возвращает array('ok' => bool, 'conflict' => bool, 'message' => string).
 */
function odatatest_update_entity($entity_set, $ref, $data, $data_version)
{
    $current = odatatest_fetch_entity($entity_set, $ref, 'Ref_Key,DataVersion');
    if ($data_version !== '' && isset($current->DataVersion) && $current->DataVersion !== $data_version) {
        return array('ok' => false, 'conflict' => true, 'message' => 'DataVersion mismatch');
    }

    $uri = $entity_set . "(guid'" . $ref . "')";
    try {
        $response = odatatest_client()->request('PATCH', $uri, $data, array('If-Match' => $data_version));
    } catch (Exception $error) {
        return array('ok' => false, 'conflict' => false, 'message' => $error->getMessage());
    }
    if (!is_object($response)) {
        return array('ok' => false, 'conflict' => false, 'message' => 'unexpected OData response');
    }
    if ($response->isOK()) {
        return array('ok' => true, 'conflict' => false, 'message' => '');
    }
    $code = $response->getResponseCode();
    if ($code === 412) {
        return array('ok' => false, 'conflict' => true, 'message' => 'DataVersion mismatch');
    }
    $message = (string) $response->getOdataErrorMessage();
    return array('ok' => false, 'conflict' => false, 'message' => $message !== '' ? $message : ('HTTP ' . $code));
}

/**
 * Табличные части документа.
 *
 * Читается ОДИНОЧНОЙ сущностью: на коллекцию с $filter по ссылке 1С отвечает
 * "Операція не дозволена у реченні ГДЕ", как только в $select попадает
 * табличная часть. Зеркальное ограничение к $expand (тот, наоборот, работает
 * только на коллекции) -- поэтому карточка делает два запроса, а не один.
 */
function odatatest_fetch_tables($entity_set, $ref, $table_names)
{
    if (!preg_match('/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i', $ref)) {
        throw new Exception('odatatest: malformed reference ' . $ref);
    }
    $uri = $entity_set . "(guid'" . $ref . "')?" . '$select=' . implode(',', $table_names);
    $response = odatatest_client()->request('GET', $uri);
    if (!is_object($response) || !$response->isOK()) {
        $message = is_object($response) ? (string) $response->getOdataErrorMessage() : 'no response';
        throw new Exception('odatatest: cannot read tables of ' . $ref . ': ' . $message);
    }
    $entity = $response->value();
    $tables = array();
    foreach ($table_names as $name) {
        $tables[$name] = isset($entity->{$name}) ? $entity->{$name} : array();
    }
    return $tables;
}

/**
 * Представления ссылок для набора GUID: один запрос на справочник вместо
 * запроса на строку таблицы (N+1). Возвращает массив guid => наименование.
 */
function odatatest_resolve_references($entity_set, $keys)
{
    $unique = array();
    foreach ($keys as $key) {
        $key = (string) $key;
        if ($key !== '' && $key !== '00000000-0000-0000-0000-000000000000') {
            $unique[$key] = true;
        }
    }
    if (!$unique) {
        return array();
    }
    $conditions = array();
    foreach (array_keys($unique) as $key) {
        $conditions[] = "Ref_Key eq guid'" . $key . "'";
    }
    $result = odatatest_fetch_list(array(
        'entity_set' => $entity_set,
        'select' => 'Ref_Key,Description',
        'filters' => array('(' . implode(' or ', $conditions) . ')'),
        'sort_property' => '',
        'sort_order' => '',
        'limit' => 0,
        'offset' => 0,
        'count_total' => false,
    ));
    $map = array();
    foreach ($result['rows'] as $row) {
        $map[$row->Ref_Key] = $row->Description;
    }
    return $map;
}

/**
 * Запись табличной части.
 *
 * Стандартный OData не умеет менять строку по отдельности: табличная часть
 * передаётся ЦЕЛИКОМ (replace collection). Отсюда два обязательных условия:
 *
 *  1) строки перечитываются со ВСЕМИ реквизитами и правки накладываются
 *     поверх -- иначе те 30+ полей строки, которых нет на форме
 *     (упаковка, вид цены, ставка НДС...), будут стёрты;
 *  2) обязателен маркер типа коллекции @odata.type, иначе 1С не понимает,
 *     что за строки ей прислали.
 *
 * Гарантий атомарности тут нет: If-Match платформой игнорируется
 * (см. doc/deferred-todo.md), поэтому параллельная правка тех же строк
 * в 1С всё ещё может быть потеряна.
 */
function odatatest_table_payload($namespace, $entity_set, $table_name, $rows)
{
    $row_type = $entity_set . '_' . $table_name . '_RowType';
    return array(
        $table_name . '@odata.type' => 'Collection(' . $namespace . '.' . $row_type . ')',
        $table_name => $rows,
    );
}

/**
 * Накладывает правки формы на полностью прочитанную строку.
 * $edits: имя реквизита => значение. Остальные реквизиты сохраняются как есть.
 */
function odatatest_merge_line($line, $edits)
{
    $row = (array) $line;
    // Служебные поля, которые 1С отдаёт при чтении, но не принимает при записи.
    unset($row['Ref_Key']);
    foreach ($edits as $name => $value) {
        $row[$name] = $value;
    }
    return $row;
}

/**
 * Создание документа. Возвращает array('ok', 'ref', 'message').
 * Номер не передаём: при создании его назначает сама 1С.
 */
function odatatest_create_entity($entity_set, $data)
{
    try {
        $response = odatatest_client()->request('POST', $entity_set, $data);
    } catch (Exception $error) {
        return array('ok' => false, 'ref' => '', 'message' => $error->getMessage());
    }
    if (!is_object($response) || !$response->isOK()) {
        $message = is_object($response) ? (string) $response->getOdataErrorMessage() : 'no response';
        return array('ok' => false, 'ref' => '', 'message' => $message);
    }
    $entity = $response->value();
    return array('ok' => true, 'ref' => isset($entity->Ref_Key) ? $entity->Ref_Key : '', 'message' => '');
}

/**
 * Пометка удаления (и снятие). В 1С это не отдельная операция, а запись
 * реквизита DeletionMark -- то есть обычный PATCH со всеми его последствиями,
 * включая перегенерацию номера. Поэтому номер читается и передаётся обратно.
 */
function odatatest_set_deletion_mark($entity_set, $ref, $flag)
{
    $current = odatatest_fetch_entity($entity_set, $ref, 'Ref_Key,Number,DataVersion');
    return odatatest_update_entity($entity_set, $ref, array(
        'Number' => $current->Number,
        'DeletionMark' => (bool) $flag,
    ), isset($current->DataVersion) ? $current->DataVersion : '');
}

/**
 * Физическое удаление. В 1С это необратимо и, в отличие от пометки, может
 * упереться в контроль ссылочной целостности.
 */
function odatatest_delete_entity($entity_set, $ref)
{
    if (!preg_match('/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i', $ref)) {
        return array('ok' => false, 'message' => 'malformed reference');
    }
    try {
        $response = odatatest_client()->request('DELETE', $entity_set . "(guid'" . $ref . "')");
    } catch (Exception $error) {
        return array('ok' => false, 'message' => $error->getMessage());
    }
    if (is_object($response) && $response->isOK()) {
        return array('ok' => true, 'message' => '');
    }
    $message = is_object($response) ? (string) $response->getOdataErrorMessage() : 'no response';
    return array('ok' => false, 'message' => $message !== '' ? $message : 'delete failed');
}

/** Пустая ссылка в 1С -- нулевой GUID, а не пустая строка. */
function odatatest_guid_or_empty($value)
{
    $value = trim((string) $value);
    return preg_match('/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i', $value)
        ? $value
        : '00000000-0000-0000-0000-000000000000';
}

/**
 * Представление ссылочного реквизита. 1С отдаёт в поле <Имя>_Key только GUID,
 * поэтому связанный объект подтягивается через $expand одним запросом
 * (без N+1 на строку) и здесь берётся его человекочитаемое имя.
 */
function odatatest_presentation($value)
{
    if (!is_object($value)) {
        return '';
    }
    if (isset($value->Description) && $value->Description !== '') {
        return $value->Description;
    }
    if (isset($value->Presentation)) {
        return $value->Presentation;
    }
    return '';
}

/**
 * Слаг колонки Dolibarr -> имя свойства 1С.
 * Слаги нужны потому, что GETPOST('sortfield', 'aZ09comma') вырезает
 * кириллицу, а имена реквизитов 1С кириллические.
 */
function odatatest_sort_property($field_map, $sortfield)
{
    if ($sortfield === '' || !isset($field_map[$sortfield])) {
        return '';
    }
    return $field_map[$sortfield];
}

/**
 * Выборка страницы списка. Возвращает array('rows' => объекты, 'total' => int).
 * total считается через /$count тем же фильтром; на этой ИБ это доли секунды,
 * но выключается конфигом генератора для больших баз.
 */
function odatatest_fetch_list($request)
{
    $query = odatatest_client()->query($request['entity_set'])->select($request['select']);
    if (!empty($request['expand'])) {
        $query->expand(...$request['expand']);
    }
    foreach ($request['filters'] as $condition) {
        $query->where($condition);
    }
    if ($request['sort_property'] !== '') {
        $query = strtolower($request['sort_order']) === 'desc'
            ? $query->orderByDesc($request['sort_property'])
            : $query->orderBy($request['sort_property']);
    }
    if ($request['limit']) {
        $query->top((int) $request['limit'])->skip((int) $request['offset']);
    }
    $rows = $query->getValues();

    $total = count($rows) + (int) $request['offset'];
    if ($request['count_total']) {
        $counter = odatatest_client()->query($request['entity_set']);
        foreach ($request['filters'] as $condition) {
            $counter->where($condition);
        }
        $counted = $counter->count();
        if (is_string($counted) && preg_match('/^\\d+$/', trim($counted))) {
            $total = (int) trim($counted);
        }
    }
    return array('rows' => $rows, 'total' => $total);
}
`;
}

module.exports.gen_env_secrets_include = gen_env_secrets_include;
module.exports.gen_client_include = gen_client_include;

// Дескриптор Dolibarr всегда объявляет css/js модуля и страницу настроек.
// Файлы генерируем, иначе браузер ловит 404 на каждой странице модуля,
// а кнопка "Настроить" в админке ведёт в никуда.
function gen_module_css() {
    return `<?php
// Отдаётся Dolibarr как css модуля. Своих стилей нет: страницы намеренно
// выглядят как штатные списки Dolibarr.
header('Content-type: text/css');
`;
}

function gen_module_js() {
    return `<?php
// Отдаётся Dolibarr как js модуля. Своего кода нет: списки работают на
// штатных механизмах Dolibarr.
header('Content-type: application/javascript');
`;
}

function gen_admin_setup_page({module_name, documents}) {
    const rows = documents.map((document) => `        array('${document.title}', '${document.name}', ${document.readOnly ? "'read'" : "'read/update'"}, '${document.slug}-list.php'),`).join('\n');
    return `<?php

// Страница настроек модуля. Намеренно только для чтения: подключение и состав
// документов задаются генератором (features/php-odata-demo), а не руками в
// админке -- иначе конфиг разъедется с тем, из чего собран модуль.

$res = 0;
foreach (array('../../../main.inc.php', '../../../../main.inc.php') as $candidate) {
    if (file_exists(__DIR__ . '/' . $candidate)) {
        $res = @include __DIR__ . '/' . $candidate;
        break;
    }
}
if (!$res) {
    die('Include of main fails');
}
require_once DOL_DOCUMENT_ROOT . '/core/lib/admin.lib.php';
require_once __DIR__ . '/../odatatest.inc.php';

if (!$user->admin) {
    accessforbidden();
}

$langs->loadLangs(array('admin'));

llxHeader('', '${module_name}');
print load_fiche_titre('${module_name}', '', 'title_setup');

$documents = array(
${rows}
);

// Проверка связи с 1С делается здесь же: без неё "настройки" не отвечают
// на единственный практический вопрос -- работает ли вообще подключение.
$status = '';
try {
    $probe = odatatest_fetch_list(array(
        'entity_set' => 'Catalog_Организации',
        'select' => 'Ref_Key',
        'filters' => array(),
        'sort_property' => '',
        'sort_order' => '',
        'limit' => 1,
        'offset' => 0,
        'count_total' => false,
    ));
    $status = '<span class="badge badge-status4 badge-status">' . $langs->trans('Online') . '</span>';
} catch (Exception $error) {
    $status = '<span class="badge badge-status8 badge-status">' . dol_escape_htmltag($error->getMessage()) . '</span>';
}

print '<table class="noborder centpercent">';
print '<tr class="liste_titre"><td>' . $langs->trans('Parameter') . '</td><td>' . $langs->trans('Value') . '</td></tr>';
print '<tr class="oddeven"><td>OData</td><td>' . dol_escape_htmltag(odatatest_secret('ODATA_BASE_URI')) . '</td></tr>';
print '<tr class="oddeven"><td>' . $langs->trans('User') . '</td><td>' . dol_escape_htmltag(odatatest_secret('ODATA_LOGIN')) . '</td></tr>';
print '<tr class="oddeven"><td>' . $langs->trans('Status') . '</td><td>' . $status . '</td></tr>';
print '</table>';

print '<br>';
print '<table class="noborder centpercent">';
print '<tr class="liste_titre"><td>Документ</td><td>Тип 1С</td><td>Права</td><td>Список</td></tr>';
foreach ($documents as $document) {
    print '<tr class="oddeven">';
    print '<td>' . dol_escape_htmltag($document[0]) . '</td>';
    print '<td>' . dol_escape_htmltag($document[1]) . '</td>';
    print '<td>' . dol_escape_htmltag($document[2]) . '</td>';
    print '<td><a href="' . DOL_URL_ROOT . '/custom/odatatest/' . $document[3] . '">' . $document[3] . '</a></td>';
    print '</tr>';
}
print '</table>';

llxFooter();
$db->close();
`;
}

module.exports.gen_module_css = gen_module_css;
module.exports.gen_module_js = gen_module_js;
module.exports.gen_admin_setup_page = gen_admin_setup_page;

// Проверка доступа к странице модуля. Dolibarr-идиома -- restrictedArea():
// она разом учитывает включённость модуля, права пользователя и entity.
function gen_page_access_include({rights_module}) {
    return `<?php

$result = restrictedArea($user, '${rights_module}', '', '', '', '', '', 0);
`;
}

module.exports.gen_page_access_include = gen_page_access_include;

// Ajax-подсказка для ссылочных реквизитов. Формат ответа -- тот, что ждёт
// ajax_autocompleter() из core/lib/ajax.lib.php: [{key, value, label}].
// Справочник приходит параметром, но проверяется по белому списку: иначе
// страница превратилась бы в произвольный прокси к 1С.
function gen_lookup_ajax({allowed_entity_sets}) {
    return `<?php

$res = 0;
foreach (array('../../../main.inc.php', '../../../../main.inc.php') as $candidate) {
    if (file_exists(__DIR__ . '/' . $candidate)) {
        $res = @include __DIR__ . '/' . $candidate;
        break;
    }
}
if (!$res) {
    die('Include of main fails');
}
require_once __DIR__ . '/../odatatest.inc.php';

if (!$user->hasRight('odatatest', 'read')) {
    httponly_accessforbidden('Not allowed', 403);
}

$allowed = array(${allowed_entity_sets.map((name) => `'${name}'`).join(', ')});
$entity_set = GETPOST('entity_set', 'alphanohtml');
if (!in_array($entity_set, $allowed, true)) {
    httponly_accessforbidden('Unknown entity set', 403);
}

$search = GETPOST('search_' . GETPOST('htmlname', 'aZ09'), 'alphanohtml');
if ($search === '') {
    $search = GETPOST('search', 'alphanohtml');
}

$filters = array();
if ($search !== '') {
    $filters[] = odatatest_filter_substring('Description', $search);
}

$result = odatatest_fetch_list(array(
    'entity_set' => $entity_set,
    'select' => 'Ref_Key,Description',
    'filters' => $filters,
    'sort_property' => 'Description',
    'sort_order' => 'asc',
    'limit' => 20,
    'offset' => 0,
    'count_total' => false,
));

$rows = array();
foreach ($result['rows'] as $row) {
    $rows[] = array(
        'key' => $row->Ref_Key,
        'value' => $row->Description,
        'label' => $row->Description,
    );
}

header('Content-Type: application/json; charset=UTF-8');
print json_encode($rows);
`;
}

module.exports.gen_lookup_ajax = gen_lookup_ajax;
