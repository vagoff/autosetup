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

module.exports.build_document_card_fields = build_document_card_fields;
