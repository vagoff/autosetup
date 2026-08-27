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
