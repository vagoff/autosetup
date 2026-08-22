import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
process.env.AUTOSETUP_PROFILE = 'data/profiles/win11-1c.json5';
const { assertODataConfiguration, getPublishedMetadataNames, getPublishedRights, renderODataVrd } = await import('../src/publish-1c-odata.js');
const { buildODataPublisherDiagnosticsScript } = await import('../src/read-1c-odata-publisher-diagnostics.js');

test('OData publisher maps explicit document and catalog rights to metadata types', () => {
    const names = getPublishedMetadataNames({ rights: { Заказ: ['read', 'update'] }, catalogRights: { Номенклатура: ['read'] } });
    assert.deepEqual(names, ['Документ.Заказ', 'Справочник.Номенклатура']);
});

test('OData publisher carries declared operations alongside each published type', () => {
    const rights = getPublishedRights({ rights: { Заказ: ['read', 'update'] }, catalogRights: { Номенклатура: ['read'] } });
    assert.deepEqual(rights, [
        { fullName: 'Документ.Заказ', operations: ['read', 'update'] },
        { fullName: 'Справочник.Номенклатура', operations: ['read'] },
    ]);
});

test('OData publisher rejects FullAccess and renders only standard OData in VRD', () => {
    assert.throws(() => assertODataConfiguration({ user: { roleNames: ['ПолныеПрава'] }, rights: {} }), /forbidden/u);
    const vrd = renderODataVrd({ publicationName: 'ib' }, { database: { directory: 'C:\\1C\\ib' } });
    assert.match(vrd, /<standardOdata enable="true"/u);
    assert.match(vrd, /enable="false"/u);
    assert.doesNotMatch(vrd, /<ws|<httpService/u);
});

test('OData publisher EPF calls only the standard composition API and the infobase user manager', async () => {
    const module = await readFile(new URL('../features/1c-odata-publisher/src/epf/ПубликаторOData/Forms/Форма/Ext/Form/Module.bsl', import.meta.url), 'utf8');
    assert.match(module, /УстановитьСоставСтандартногоИнтерфейсаOData/u);
    assert.match(module, /ПользователиИнформационнойБазы\.СоздатьПользователя/u);
    assert.match(module, /Пользователь\.Роли\.Очистить/u);
    assert.match(module, /Режим = "probe"/u);
    assert.match(module, /Режим = "apply"/u);
    assert.match(module, /ЗаписьJSON/u);
    assert.match(module, /ПриСозданииНаСервере/u);
    assert.match(module, /ПараметрыЗапуска = РазобратьПараметры/u);
    assert.doesNotMatch(module, /Параметры = РазобратьПараметры/u);
    assert.doesNotMatch(module, /HTTPСоединение|ВебСервис/u);
});

test('OData publisher EPF verifies declared rights against real role grants via the global AccessRight function, not just composition', async () => {
    const module = await readFile(new URL('../features/1c-odata-publisher/src/epf/ПубликаторOData/Forms/Форма/Ext/Form/Module.bsl', import.meta.url), 'utf8');
    // ПравоДоступа() -- ГЛОБАЛЬНАЯ функция платформы, не метод объекта роли
    // (первая попытка звала её как РольМетаданных.ПравоДоступа(...) и падала
    // с "метод не обнаружен" -- см. doc/1c-notes.md).
    assert.match(module, /ПравоДоступа\(Право, ОбъектМетаданных, РольМетаданных\)/u);
    assert.doesNotMatch(module, /РольМетаданных\.ПравоДоступа/u);
    assert.match(module, /is declared in rights\/catalogRights but no assigned role grants it/u);
    assert.match(module, /assigned roles also grant/u);
    assert.match(module, /"read", "Чтение"/u);
    assert.match(module, /"create", "Добавление"/u);
    assert.match(module, /"update", "Изменение"/u);
    assert.match(module, /"delete", "Удаление"/u);
});

test('OData publisher diagnostics only reads staging and logs', () => {
    const script = buildODataPublisherDiagnosticsScript({ guest: { stagingDirectory: 'C:\\staging', logDirectory: 'C:\\logs', publicationLogFilename: 'run.log' } });
    assert.match(script, /Get-ChildItem/u);
    assert.match(script, /ReadAllText/u);
    assert.doesNotMatch(script, /Remove-Item|Set-|New-Item/u);
});

test('OData publisher runs the native EPF and exposes a non-mutating probe mode', async () => {
    const script = await readFile(new URL('../src/publish-1c-odata.js', import.meta.url), 'utf8');
    assert.match(script, /run native 1C OData publisher/u);
    assert.match(script, /Mode=\$\{mode\};Manifest=/u);
    assert.match(script, /mode === 'probe'/u);
    assert.doesNotMatch(script, /V83\.COMConnector|buildOneCODataPublishScript/u);
});

test('OData publisher carries source hashes to the guest before compiling the EPF', async () => {
    const source = await readFile(new URL('../src/publish-1c-odata.js', import.meta.url), 'utf8');
    assert.match(source, /staged OData publisher file SHA-256 mismatch/u);
});
