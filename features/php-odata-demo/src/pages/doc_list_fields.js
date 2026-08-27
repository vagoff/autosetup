'use strict';

const {make_slug} = require('../slug/make_slug');

// Построение колонок списка документов для dol_table_layout из метаданных 1С.
//
// Ключ колонки в Dolibarr (`sql_dot_name`) -- ASCII-слаг, а не имя реквизита:
// он уезжает в URL как `sortfield` и проходит через GETPOST(..., 'aZ09comma'),
// который вырезал бы кириллицу. Имя свойства 1С хранится рядом и попадает
// в PHP-карту полей.

const SYSTEM_LABELS = {
    Number: 'Номер',
    Date: 'Дата',
    Posted: 'Проведён',
    DeletionMark: 'Пометка удаления',
};

function php_property(name) {
    // Имена реквизитов кириллические, поэтому только фигурная форма доступа.
    return `$obj->{'${name}'}`;
}

function field_label(name, entity) {
    if (SYSTEM_LABELS[name]) return SYSTEM_LABELS[name];
    // Синонимов в $metadata нет (см. doc/auto-doc-edit.md), поэтому заголовок --
    // это имя реквизита без служебного суффикса ссылки.
    return name.replace(/_Key$/u, '');
}

function build_document_list_fields(entity, document) {
    const by_name = new Map(entity.fields.map((field) => [field.name, field]));
    const fields = {};
    const field_map = {};
    const expand = [];

    for (const [position, name] of document.columns.entries()) {
        const meta = by_name.get(name);
        if (!meta) throw new Error(`${document.name}: no field ${name} in dbinfo.json`);
        const slug = make_slug(name.replace(/_Key$/u, ''));
        field_map[slug] = name;

        const label = field_label(name, entity);
        const search_param = 'search_' + slug.replace(/-/gu, '_');
        const common = {
            label,
            sql_dot_name: slug,
            sortable: true,
            arrayfield: `array('label'=>'${label}', 'checked'=>1, 'enabled'=>1, 'visible'=>-1, 'position'=>${(position + 1) * 10})`,
        };

        if (meta.ref_target) {
            // Ссылка: связанный объект подтягиваем через $expand и показываем
            // его наименование; фильтруем по GUID самого реквизита.
            const navigation = name.replace(/_Key$/u, '');
            expand.push(navigation);
            fields[slug] = {
                ...common,
                td_class: 'tdoverflowmax200',
                td_block: `dol_escape_htmltag(odatatest_presentation($obj->{'${navigation}'}))`,
                ti_class: 'liste_titre left',
                ti_expr: `'<input class="flat maxwidth100" type="text" name="${search_param}" value="'.dol_escape_htmltag($${search_param}).'">'`,
                search: {param: search_param, odata_property: name, odata_type: 'guid'},
            };
            continue;
        }
        if (meta.type === 'Edm.DateTime') {
            fields[slug] = {
                ...common,
                td_class: 'nowraponall',
                td_block: `dol_print_date(odatatest_parse_date(${php_property(name)}), 'dayhour', 'tzuser')`,
                ti_class: 'liste_titre center',
                ti_expr: `''`,
            };
            continue;
        }
        if (meta.type === 'Edm.Boolean') {
            fields[slug] = {
                ...common,
                td_class: 'center',
                td_block: `(${php_property(name)} ? yn(1) : yn(0))`,
                ti_class: 'liste_titre center',
                ti_expr: `'<input class="flat" type="text" size="1" name="${search_param}" value="'.dol_escape_htmltag($${search_param}).'">'`,
                search: {param: search_param, odata_property: name, odata_type: 'boolean'},
            };
            continue;
        }
        if (meta.type === 'Edm.Double' || meta.type === 'Edm.Decimal' || meta.type === 'Edm.Int64' || meta.type === 'Edm.Int32') {
            fields[slug] = {
                ...common,
                td_class: 'right',
                td_block: `price(${php_property(name)})`,
                ti_class: 'liste_titre right',
                ti_expr: `''`,
            };
            continue;
        }
        fields[slug] = {
            ...common,
            td_class: 'tdoverflowmax200',
            td_title: `dol_escape_htmltag(${php_property(name)})`,
            td_block: `dol_escape_htmltag(${php_property(name)})`,
            ti_class: 'liste_titre left',
            ti_expr: `'<input class="flat maxwidth100" type="text" name="${search_param}" value="'.dol_escape_htmltag($${search_param}).'">'`,
            search: {param: search_param, odata_property: name, odata_type: 'string'},
        };
    }

    // Ref_Key нужен для ссылки на карточку, но колонкой не показывается.
    field_map.ref_key = 'Ref_Key';
    return {fields, field_map, expand};
}

module.exports.build_document_list_fields = build_document_list_fields;
