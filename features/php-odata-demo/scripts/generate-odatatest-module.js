#!/usr/bin/env node
'use strict';

// Оркестратор генерации модуля Dolibarr `odatatest`.
// Своей логики не содержит: читает конфиги, вызывает генераторы по порядку.

const afs = require('fs').promises;
const pth = require('path');
const JSON5 = require('json5');

const AUTOSETUP = '/data/wd/aibox/autosetup';
const DOBAERP = '/data/wd/aibox/dobaerp/src';
const {interpret} = require(pth.join(DOBAERP, 'idiominterp/dol_data_driven'));
const {link_mixins_dynamically} = require(pth.join(DOBAERP, 'interlink/mixins_linker'));

const DOL_SYSTEM_DATA = require(pth.join(DOBAERP, 'idiomlibutils/dol_system_data'));
const {all_classes} = require('../src/odatatest_app_data');
const {ODataTableRowSource} = require('../src/idiomlib/dol_row_source_odata');
const {build_document_list_fields} = require('../src/pages/doc_list_fields');
const {generate_module_class} = require('../src/idiomlib/dol_module');
const {gen_env_secrets_include, gen_client_include, gen_module_css, gen_module_js, gen_admin_setup_page, gen_page_access_include} = require('../src/php/runtime_lib');
const {ensure_lines} = require('/data/wd/aibox/dev-env/libs/utils/src/ensure_lines');
const {textUpdateFile} = require(pth.join(DOBAERP, 'textlib/text_update'));

const project_dir = pth.join(__dirname, '..');

async function read_json5(path) {
    return JSON5.parse(await afs.readFile(path, 'utf8'));
}

async function main() {
    const config = await read_json5(pth.join(project_dir, 'data/gen-config.json5'));
    // Модули dobaerp читают свои данные (data/dbinfo.json и прочее) по путям
    // относительно текущего каталога -- они рассчитаны на запуск из корня
    // dobaerp. Наши пути все абсолютные, так что смена каталога безопасна.
    process.chdir(config.dobaerp.root);
    const dbinfo = await read_json5(pth.join(project_dir, 'data/dbinfo.json'));
    const output_dir = pth.join(config.dobaerp.root, config.dobaerp.docrootSubdirectory, config.module.docrootSubdirectory) + pth.sep;
    await afs.mkdir(output_dir, {recursive: true});

    for (const document of config.documents) {
        const entity = dbinfo.entities['Document_' + document.name];
        if (!entity) throw new Error(`${document.name}: no metadata, re-run read-1c-odata-metadata.js`);
        const {fields, field_map, expand} = build_document_list_fields(entity, document);
        await generate_list_page({config, document, entity, fields, field_map, expand, output_dir});
    }
    const connection = await load_odata_connection();
    await generate_runtime_includes({config, connection, output_dir});
    await generate_secrets({config, connection});
    await generate_module_descriptor({config});
    console.log(`${output_dir}: ${config.documents.length} list pages, runtime, secrets, module descriptor`);
}

async function generate_list_page({config, document, entity, fields, field_map, expand, output_dir}) {
    const field_map_var = '$odatatest_fields';
    // Одного $expand мало: 1С отдаёт связанный объект, только если поле
    // явно указано и в $select (проверено на живой ИБ).
    const select_fields = [
        'Ref_Key',
        'DataVersion',
        ...document.columns,
        ...expand.map((navigation) => `${navigation}/Description`),
    ];

    const definition = {
        '': 'smart_php_page',
        refname: `${document.slug}-list`,
        page_title: document.title,
        // Обвязка (клиент OData, хелперы дат и фильтров) лежит рядом со
        // страницами и подключается по __DIR__: модуль остаётся переносимым.
        _oo: {
            page_more_requires: "require_once __DIR__ . '/odatatest.inc.php';",
        },
        _pre: [
            {
                '': 'dol_table_layout',
                _pre: [{'': 'use_fields', fields}],
                table_title: document.title,
                default_sortfield: document.defaultSort,
                row_source: (gen) => new ODataTableRowSource(gen, {
                    entity_set: entity.entity_set,
                    field_map_var,
                    select_fields,
                    expand,
                    count_total: config.odata.countTotal,
                }),
                _oo: {
                    table_init: `${field_map_var} = ${php_array(field_map)};`,
                    // Идентификатор строки таблицы Dolibarr -- ссылка документа.
                    tr_id_init: `$row_id = $obj->Ref_Key;`,
                },
            },
        ],
    };

    const gen_config = {
        output_dir,
        rights_module: config.module.rightsModule,
        global_langs: ['odatatest@odatatest', 'other'],
        db_table_prefix: '" . MAIN_DB_PREFIX . "',
        // Таблица классов и авто-переменных Dolibarr -- общая системная данность
        // dobaerp, а не что-то специфичное для WMS.
        classes: DOL_SYSTEM_DATA.classes,
        auto_vars: DOL_SYSTEM_DATA.auto_vars,
        disable_menus: false,
        allow_delete: false,
    };
    const cls = link_mixins_dynamically(all_classes.doc_list);
    // Dol_PageBase сам заводит ii/oo в this.env -- интерпретатору отдаём именно их,
    // иначе генераторы будут писать в один накопитель, а собираться будет другой.
    const instance = new cls(gen_config, {}, []);
    const {ii, oo} = instance.env;
    await interpret(definition, instance, ii, oo, gen_config, {all_classes, include_files: []});
}

function php_array(map) {
    const items = Object.entries(map).map(([key, value]) => `'${key}' => '${value}'`);
    return `array(${items.join(', ')})`;
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}

// Дескриптор модуля Dolibarr: верхнее меню и левое меню, где документы --
// второй уровень под статическим пунктом "Документы", чтобы рядом можно было
// добавлять другие статические пункты первого уровня.
async function generate_module_descriptor({config}) {
    const submenu = {};
    for (const document of config.documents) {
        submenu[document.slug] = {title: document.title, url: `${document.slug}-list.php`};
    }
    const site_dir = pth.join(config.dobaerp.root, config.dobaerp.docrootSubdirectory);
    await generate_module_class(site_dir, {
        module_name: config.module.name,
        module_dir: config.module.docrootSubdirectory,
        numero: config.module.number,
        position: config.module.position,
        version: config.module.version,
        short_description: config.module.description,
        long_description: config.module.description,
        rights: config.module.rights,
        top_menu: {
            odatatest: {title: config.module.menuTitle, url: `${config.documents[0].slug}-list.php`},
        },
        left_menu: {
            // Первый уровень -- статический пункт-контейнер; документы висят
            // вторым уровнем, чтобы рядом можно было добавлять другие разделы.
            // url задан явно: иначе dol_module подставит documents.php, которого нет.
            documents: {title: 'Документы', url: `${config.documents[0].slug}-list.php`, submenu},
        },
    });
}

// Единственный источник правды по подключению -- конфиг автосетапа
// (data/1c-odata.json5 + состояние с паролем). Здесь ничего не дублируется:
// сменится порт, публикация или пароль -- перегенерация подхватит.
async function load_odata_connection() {
    // Путь профиля именно абсолютный: генератор работает из каталога dobaerp
    // (так требуют его модули), а config.js автосетапа резолвит профиль
    // относительно текущего каталога.
    process.env.AUTOSETUP_PROFILE = pth.join(AUTOSETUP, 'data/profiles/win11-1c.json5');
    const {config: autosetup} = await import(pth.join(AUTOSETUP, 'src/config.js'));
    const odata = autosetup.oneCOData;
    const password = (await afs.readFile(odata.passwordStatePath, 'utf8')).trim();
    return {
        base_uri: `http://127.0.0.1:${autosetup.apacheHttpd.hostPort}/${odata.publicationName}/${odata.endpointPath}/`,
        login: odata.user.name,
        password,
        server_timezone: odata.serverTimezone,
    };
}

async function generate_runtime_includes({config, connection, output_dir}) {
    await afs.writeFile(pth.join(output_dir, 'env_secrets.inc.php'), gen_env_secrets_include({
        secrets_path: pth.join(config.dobaerp.root, config.module.secretsPath),
    }));
    await afs.writeFile(pth.join(output_dir, 'page_access.inc.php'), gen_page_access_include({
        rights_module: config.module.rightsModule,
    }));
    for (const [subdir, name, text] of [
        ['css', 'odatatest.css.php', gen_module_css()],
        ['js', 'odatatest.js.php', gen_module_js()],
        ['admin', 'setup.php', gen_admin_setup_page({module_name: config.module.description, documents: config.documents})],
    ]) {
        await afs.mkdir(pth.join(output_dir, subdir), {recursive: true});
        await afs.writeFile(pth.join(output_dir, subdir, name), text);
    }
    await afs.writeFile(pth.join(output_dir, 'odatatest.inc.php'), gen_client_include({
        vendor_autoload_path: pth.join(project_dir, 'vendor/autoload.php'),
        server_timezone: connection.server_timezone,
        request_timeout_seconds: config.odata.requestTimeoutSeconds,
    }));
}

// .env.secrets не наш файл целиком: рядом могут лежать чужие секреты.
// ensure_lines заводит размеченный регион (и сам файл, если его нет),
// textUpdateFile переписывает ТОЛЬКО этот регион актуальными значениями.
async function generate_secrets({config, connection}) {
    const path = pth.join(config.dobaerp.root, config.module.secretsPath);
    await afs.mkdir(pth.dirname(path), {recursive: true});
    const signature = 'odatatest';
    const options = {comment_pfx: '# '};
    await ensure_lines(path, [
        {check_equal: `# ${signature} {{{`, append: `# ${signature} {{{\n# ${signature} }}}`},
    ], {new_file_mode: 'CREATE'});
    await textUpdateFile(path, signature, [
        `ODATA_BASE_URI=${connection.base_uri}`,
        `ODATA_LOGIN=${connection.login}`,
        `ODATA_PASSWORD=${connection.password}`,
    ].join('\n'), options);
    // php-fpm работает под своим пользователем, поэтому файл должен быть
    // читаем всем. Это приемлемо только потому, что он лежит ВНЕ docroot:
    // по HTTP его не достать. Внутри docroot такой режим был бы дырой.
    await afs.chmod(path, 0o644);
}
