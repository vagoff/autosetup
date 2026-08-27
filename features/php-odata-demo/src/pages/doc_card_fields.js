'use strict';

const {make_slug} = require('../slug/make_slug');

// Поля карточки документа из метаданных 1С.
//
// Системные поля (Ref_Key, DataVersion, Posted, DeletionMark) редактировать
// нельзя: Ref_Key и DataVersion -- служебные, а Posted/DeletionMark меняются
// не записью реквизита, а проведением и пометкой удаления (см. deferred-todo.md).
const NOT_EDITABLE = new Set(['Ref_Key', 'DataVersion', 'Number', 'Date', 'Posted', 'DeletionMark']);

const KIND_BY_TYPE = {
    'Edm.Boolean': 'boolean',
    'Edm.DateTime': 'date',
    'Edm.Double': 'number',
    'Edm.Decimal': 'number',
    'Edm.Int32': 'number',
    'Edm.Int64': 'number',
};

function build_document_card_fields(entity, document) {
    const by_name = new Map(entity.fields.map((field) => [field.name, field]));
    const names = document.cardFields ?? document.columns;
    const fields = [];
    const expand = [];

    for (const name of names) {
        const meta = by_name.get(name);
        if (!meta) throw new Error(`${document.name}: no field ${name} in dbinfo.json`);
        const navigation = name.replace(/_Key$/u, '');
        const kind = meta.ref_target ? 'reference' : (KIND_BY_TYPE[meta.type] ?? 'string');
        if (meta.ref_target) expand.push(navigation);
        fields.push({
            name,
            slug: make_slug(navigation).replace(/-/gu, '_'),
            label: navigation,
            kind,
            navigation,
            ref_target: meta.ref_target ?? '',
            // Read-only документ не редактируется целиком -- это задаётся на
            // уровне страницы, здесь только пофайловое ограничение.
            editable: !NOT_EDITABLE.has(name),
        });
    }
    return {fields, expand};
}

// Колонки табличных частей из метаданных строки (сущность *_RowType).
function build_document_table_columns(dbinfo, entity, document) {
    const tables = [];
    for (const [name, table_config] of Object.entries(document.tables ?? {})) {
        const meta = entity.tables[name];
        if (!meta) throw new Error(`${document.name}: no tabular section ${name} in dbinfo.json`);
        const row_entity = dbinfo.entities[meta.row_type];
        if (!row_entity) throw new Error(`${document.name}: no row type ${meta.row_type} in dbinfo.json`);
        const by_name = new Map(row_entity.fields.map((field) => [field.name, field]));
        const columns = table_config.columns.map((column_name) => {
            const field = by_name.get(column_name);
            if (!field) throw new Error(`${document.name}.${name}: no column ${column_name}`);
            return {
                name: column_name,
                slug: make_slug(column_name.replace(/_Key$/u, '')).replace(/-/gu, '_'),
                label: column_name.replace(/_Key$/u, ''),
                kind: field.ref_target ? 'reference' : (KIND_BY_TYPE[field.type] ?? 'string'),
                ref_target: field.ref_target ?? '',
            };
        });
        tables.push({
            name,
            slug: make_slug(name).replace(/-/gu, '_'),
            title: table_config.title ?? name,
            row_type: meta.row_type,
            columns,
        });
    }
    return tables;
}

module.exports.build_document_card_fields = build_document_card_fields;
module.exports.build_document_table_columns = build_document_table_columns;
