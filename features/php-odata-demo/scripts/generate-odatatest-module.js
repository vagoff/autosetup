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
// Источник строк на 1С OData и раскладка модуля -- теперь оба из dobaerp:
// расшивка от SQL влита туда, локальных копий больше нет (doc/merge-back.md).
const {ODataTableRowSource} = require(pth.join(DOBAERP, 'idiomlib/dol_row_source_odata'));
const {build_document_list_fields} = require('../src/pages/doc_list_fields');
const {build_document_card_fields, build_document_table_columns} = require('../src/pages/doc_card_fields');
const {gen_card_page} = require('../src/php/card_page');
const {generate_module_descriptor} = require(pth.join(DOBAERP, 'idiomlib/dol_module'));
const {gen_env_secrets_include, gen_client_include, gen_module_css, gen_module_js, gen_admin_setup_page, gen_page_access_include, gen_lookup_ajax} = require('../src/php/runtime_lib');
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
    // Корень вывода переопределяется переменной окружения -- это нужно
    // регрессионному тесту, чтобы генерировать во временный каталог и не
    // трогать рабочий сайт.
    const output_root = process.env.ODATATEST_OUTPUT_ROOT
        ? pth.resolve(process.env.ODATATEST_OUTPUT_ROOT)
        : pth.join(config.dobaerp.root, config.dobaerp.docrootSubdirectory);
    const output_dir = pth.join(output_root, config.module.docrootSubdirectory) + pth.sep;
    await afs.mkdir(output_dir, {recursive: true});

    const connection = await load_odata_connection();
    config.catalogEntitySets = connection.catalog_entity_sets;

    // Поля/таблицы карточек всех документов собираются заранее (чистая
    // функция от dbinfo.json, сети не требует), чтобы до генерации страниц
    // узнать полный список задействованных справочников и спросить у 1С
    // $count по каждому РОВНО ОДИН раз -- даже если один справочник
    // встречается и в шапке одного документа, и в таблице другого.
    const card_data = new Map();
    const ref_targets = new Set();
    for (const document of config.documents) {
        const entity = dbinfo.entities['Document_' + document.name];
        if (!entity) throw new Error(`${document.name}: no metadata, re-run read-1c-odata-metadata.js`);
        const {fields, expand} = build_document_card_fields(entity, document);
        const tables = build_document_table_columns(dbinfo, entity, document);
        for (const field of fields) if (field.kind === 'reference') ref_targets.add(field.ref_target);
        for (const table of tables) for (const column of table.columns) if (column.kind === 'reference') ref_targets.add(column.ref_target);
        card_data.set(document.name, {entity, fields, expand, tables});
    }
    const picker_kinds = await build_picker_kinds(connection, ref_targets, config.odata.selectMaxOptions);
    for (const {fields, tables} of card_data.values()) {
        for (const field of fields) if (field.kind === 'reference') field.pickerKind = picker_kinds.get(field.ref_target);
        for (const table of tables) for (const column of table.columns) if (column.kind === 'reference') column.pickerKind = picker_kinds.get(column.ref_target);
    }

    for (const document of config.documents) {
        const {entity, fields: card_fields, expand: card_expand, tables} = card_data.get(document.name);
        const {fields, field_map, expand} = build_document_list_fields(entity, document);
        await generate_list_page({config, document, entity, fields, field_map, expand, output_dir});
        await generate_card_page({document, entity, card_fields, card_expand, tables, namespace: dbinfo.namespace, output_dir});
    }
    await generate_runtime_includes({config, connection, output_dir, output_root});
    await generate_secrets({config, connection, output_root});
    await generate_odatatest_module_descriptor({config, output_root});
    console.log(`${output_dir}: ${config.documents.length} list pages, runtime, secrets, module descriptor`);
}

// Спрашивает у 1С $count по каждому уникальному справочнику ровно один раз
// и решает, какой виджет ему подходит: select.md-обсуждение -- в
// data/gen-config.json5#odata.selectMaxOptions.
async function build_picker_kinds(connection, ref_targets, max_options) {
    const kinds = new Map();
    for (const ref_target of ref_targets) {
        const count = await fetch_entity_set_count(connection, ref_target);
        kinds.set(ref_target, count <= max_options ? 'select' : 'autocomplete');
        console.log(`${ref_target}: $count=${count} -> ${kinds.get(ref_target)}`);
    }
    return kinds;
}

async function fetch_entity_set_count(connection, entity_set) {
    const url = `${connection.base_uri}${encodeURIComponent(entity_set)}/$count`;
    const auth = Buffer.from(`${connection.login}:${connection.password}`).toString('base64');
    const response = await fetch(url, {headers: {Authorization: `Basic ${auth}`}});
    if (!response.ok) throw new Error(`${entity_set}: $count HTTP ${response.status}`);
    const text = (await response.text()).trim();
    if (!/^\d+$/u.test(text)) throw new Error(`${entity_set}: $count вернул не число: ${JSON.stringify(text)}`);
    return Number(text);
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
                    set_new_card_button: document.readOnly
                        ? ''
                        : `$newcardbutton .= dolGetButtonTitle($langs->trans('New'), '', 'fa fa-plus-circle', DOL_URL_ROOT.'/custom/odatatest/${document.slug}-card.php?action=create', '', $user->hasRight('odatatest', 'write') ? 1 : 0);`,
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
// Карточка документа: просмотр и редактирование шапки.
async function generate_card_page({document, entity, card_fields, card_expand, tables, namespace, output_dir}) {
    const select = ['Ref_Key', 'DataVersion', ...card_fields.map((field) => field.name), ...card_expand.map((name) => `${name}/Description`)];
    const text = gen_card_page({
        document,
        entity_set: entity.entity_set,
        fields: card_fields,
        select_fields: [...new Set(select)],
        expand: card_expand,
        read_only: Boolean(document.readOnly),
        tables,
        namespace,
    });
    await afs.writeFile(pth.join(output_dir, `${document.slug}-card.php`), text);
}

async function generate_odatatest_module_descriptor({config, output_root}) {
    const submenu = {};
    for (const document of config.documents) {
        submenu[document.slug] = {title: document.title, url: `${document.slug}-list.php`};
    }
    // module_dir больше не передаём: dol_module выводит каталог из
    // module_name (нижний регистр), а не принимает его отдельно -- уже
    // совпадает с config.module.docrootSubdirectory ('custom/odatatest').
    await generate_module_descriptor(output_root, {
        module_name: config.module.name,
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
    // (так требуют его модули), а configure.js автосетапа резолвит профиль
    // относительно текущего каталога.
    process.env.AUTOSETUP_PROFILE = pth.join(AUTOSETUP, 'data/profiles/win11-1c.json5');
    const {config: autosetup} = await import(pth.join(AUTOSETUP, 'src/configure.js'));
    const odata = autosetup.oneCOData;
    const password = (await afs.readFile(odata.passwordStatePath, 'utf8')).trim();
    return {
        base_uri: `http://127.0.0.1:${autosetup.apacheHttpd.hostPort}/${odata.publicationName}/${odata.endpointPath}/`,
        login: odata.user.name,
        password,
        server_timezone: odata.serverTimezone,
        catalog_entity_sets: Object.keys(odata.catalogRights).map((name) => 'Catalog_' + name),
    };
}

async function generate_runtime_includes({config, connection, output_dir, output_root}) {
    await afs.writeFile(pth.join(output_dir, 'env_secrets.inc.php'), gen_env_secrets_include({
        secrets_path: process.env.ODATATEST_OUTPUT_ROOT
            ? pth.join(output_root, 'secrets', pth.basename(config.module.secretsPath))
            : pth.join(config.dobaerp.root, config.module.secretsPath),
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
    await afs.mkdir(pth.join(output_dir, 'ajax'), {recursive: true});
    await afs.writeFile(pth.join(output_dir, 'ajax/lookup.php'), gen_lookup_ajax({
        // Белый список ровно из catalogRights автосетапа: подсказка не должна
        // уметь читать произвольный тип 1С.
        allowed_entity_sets: config.catalogEntitySets,
    }));
    await afs.writeFile(pth.join(output_dir, 'odatatest.inc.php'), gen_client_include({
        vendor_autoload_path: pth.join(project_dir, 'vendor/autoload.php'),
        server_timezone: connection.server_timezone,
        request_timeout_seconds: config.odata.requestTimeoutSeconds,
    }));
}

// .env.secrets не наш файл целиком: рядом могут лежать чужие секреты.
// ensure_lines заводит размеченный регион (и сам файл, если его нет),
// textUpdateFile переписывает ТОЛЬКО этот регион актуальными значениями.
async function generate_secrets({config, connection, output_root}) {
    // Секреты кладём рядом с выводом, но ВНЕ docroot. В тестовом прогоне это
    // временный каталог, в рабочем -- output/secrets модуля dobaerp.
    const path = process.env.ODATATEST_OUTPUT_ROOT
        ? pth.join(output_root, 'secrets', pth.basename(config.module.secretsPath))
        : pth.join(config.dobaerp.root, config.module.secretsPath);
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
