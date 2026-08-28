import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseODataMetadata } from '../../features/odata-demo/scripts/parse-odata-metadata.js';

const xml = await readFile(new URL('./fixtures/odata-metadata.xml', import.meta.url), 'utf8');
const parsed = parseODataMetadata(xml, { documentNames: ['ЗаказПоставщику'], catalogNames: ['Организации'] });

test('resolves reference targets through associations', () => {
    const document = parsed.entities.Document_ЗаказПоставщику;
    const organization = document.fields.find((field) => field.name === 'Организация_Key');
    assert.equal(organization.ref_target, 'Catalog_Организации');
    assert.equal(organization.type, 'Edm.Guid');
});

test('turns Collection(..._RowType) properties into tables and pulls the row type in', () => {
    const document = parsed.entities.Document_ЗаказПоставщику;
    assert.deepEqual(document.tables, { Товары: { row_type: 'Document_ЗаказПоставщику_Товары' } });
    assert.deepEqual(parsed.entities.Document_ЗаказПоставщику_Товары.key, ['Ref_Key', 'LineNumber']);
    assert.equal(parsed.entities.Document_ЗаказПоставщику_Товары.kind, 'table');
    // Табличная часть не попадает в поля шапки -- иначе форма попыталась бы
    // отрисовать коллекцию как скалярный реквизит.
    assert.equal(document.fields.some((field) => field.name === 'Товары'), false);
});

test('collapses the identical duplicate EnumType that 1C emits', () => {
    assert.deepEqual(parsed.enums.AllowedLength, ['Fixed', 'Variable']);
});

test('fails on conflicting duplicate EnumType instead of silently overwriting', () => {
    const broken = xml.replace('<Member Name="Variable"/>\n\t\t\t</EnumType>\n\t\t\t<EnumType Name="AllowedLength"', '<Member Name="Other"/>\n\t\t\t</EnumType>\n\t\t\t<EnumType Name="AllowedLength"');
    assert.notEqual(broken, xml);
    assert.throws(() => parseODataMetadata(broken, { documentNames: [], catalogNames: [] }), /conflicting duplicate EnumType/u);
});

test('fails fast when a requested type is not published', () => {
    assert.throws(
        () => parseODataMetadata(xml, { documentNames: ['НетТакого'], catalogNames: [] }),
        /Document_НетТакого is not present in \$metadata/u,
    );
});

test('orders entities and enums deterministically', () => {
    assert.deepEqual(Object.keys(parsed.entities), [...Object.keys(parsed.entities)].sort());
});
