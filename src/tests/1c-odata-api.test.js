import assert from 'node:assert/strict';
import test from 'node:test';
process.env.AUTOSETUP_PROFILE = 'data/profiles/win11-1c.json5';
const { buildOneCODataApiProbeScript } = await import('../src/probe-1c-odata-api.js');

test('OData API probe is read-only and checks the platform APIs used by the publisher', () => {
    const script = buildOneCODataApiProbeScript({
        database: { directory: 'C:\\1C\\ib\\production-copy', userName: 'Администратор', password: '' },
    });
    assert.match(script, /УстановитьСоставСтандартногоИнтерфейсаOData/u);
    assert.match(script, /ПользователиИнформационнойБазы/u);
    assert.match(script, /ПолучитьПользователей/u);
    assert.match(script, /Метаданные/u);
    assert.match(script, /\$documents/u);
    assert.doesNotMatch(script, /СоздатьПользователя|\.Записать\(|УстановитьПароль/u);
});
