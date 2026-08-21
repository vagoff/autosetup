import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDocumentsTopScript } from '../src/lib/dump-1c-configuration-metadata.js';
import { extractDocumentsFromConfigurationXml } from '../src/lib/parse-1c-configuration-metadata.js';
import { parseHeadlessDocumentsTopArguments } from '../src/lib/parse-headless-documents-top-arguments.js';

test('Designer configuration dump yields a stable document list', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject>
  <Configuration>
    <ChildObjects>
      <Document><Properties><Name>ЗаказКлиента</Name><Synonym>Заказ клиента</Synonym></Properties></Document>
      <Catalog><Properties><Name>Контрагенты</Name></Properties></Catalog>
      <Document><Properties><Name>РеализацияТоваров</Name><Synonym>Реализация товаров</Synonym></Properties></Document>
    </ChildObjects>
  </Configuration>
</MetaDataObject>`;
    assert.deepEqual(extractDocumentsFromConfigurationXml(xml), [
        { name: 'ЗаказКлиента', synonym: 'Заказ клиента' },
        { name: 'РеализацияТоваров', synonym: 'Реализация товаров' },
    ]);
});

test('Designer Configuration.xml reads document names from ChildObjects', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<MetaDataObject>
  <Configuration>
    <ChildObjects>
      <Catalog>Контрагенты</Catalog>
      <Document>ЗаказКлиента</Document>
      <Document>РеализацияТоваров</Document>
    </ChildObjects>
  </Configuration>
</MetaDataObject>`;
    assert.deepEqual(extractDocumentsFromConfigurationXml(xml), [
        { name: 'ЗаказКлиента', synonym: 'ЗаказКлиента' },
        { name: 'РеализацияТоваров', synonym: 'РеализацияТоваров' },
    ]);
});

test('Designer configuration dump rejects duplicate document names', () => {
    const xml = '<MetaDataObject><Document><Properties><Name>Заказ</Name></Properties></Document><Document><Properties><Name>Заказ</Name></Properties></Document></MetaDataObject>';
    assert.throws(() => extractDocumentsFromConfigurationXml(xml), /duplicate 1C document metadata name/u);
});

test('documents census can reuse a completed guest XML dump', () => {
    assert.deepEqual(
        parseHeadlessDocumentsTopArguments([
            '--documents-top', '10',
            '--configuration-xml', 'C:\\x\\complete\\Configuration.xml',
            '--output', 'top.json',
        ], 1000),
        { top: 10, configurationXmlPath: 'C:\\x\\complete\\Configuration.xml', outputFilename: 'top.json' },
    );
});

test('documents census identifies the document type when COM COUNT fails', () => {
    const script = buildDocumentsTopScript({ database: { directory: 'C:\\1C\\ib', userName: 'admin', password: '' } }, 'C:\\staging\\documents.json', 10);
    assert.match(script, /COUNT Document\.\$name failed/u);
    assert.match(script, /КОЛИЧЕСТВО\(\*\) КАК ResultCount/u);
    assert.match(script, /\$query\.Execute\(\)\.Unload\(\)/u);
    assert.match(script, /\$table\.Get\(0\)\.Get\(0\)/u);
    assert.match(script, /Get-Content .* -Encoding UTF8/u);
    assert.doesNotMatch(script, /\$documents = @\(/u);
    assert.match(script, /ToBase64String\(\[Text\.Encoding\]::UTF8\.GetBytes/u);
});
