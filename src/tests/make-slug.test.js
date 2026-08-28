import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

// Генератор PHP пишется в стиле dobaerp (CommonJS), тесты проекта -- ESM.
const require = createRequire(import.meta.url);
const { make_slug, make_unique_slugs } = require('../../features/php-odata-demo/src/slug/make_slug.js');

test('splits camel case before transliteration', () => {
    assert.equal(make_slug('ЗаказПоставщику'), 'zakaz-postavschiku');
    assert.equal(make_slug('МаршрутныйЛистПроизводства'), 'marshrutnyy-list-proizvodstva');
    assert.equal(make_slug('ДоступностьРабочихЦентров'), 'dostupnost-rabochih-tsentrov');
});

test('handles latin, digits, separators and acronyms', () => {
    assert.equal(make_slug('HTTPServer'), 'http-server');
    assert.equal(make_slug('Заказ клиента 2'), 'zakaz-klienta-2');
    assert.equal(make_slug('Товары_КонтактнаяИнформация'), 'tovary-kontaktnaya-informatsiya');
});

test('truncates on a word boundary', () => {
    assert.equal(make_slug('ПоступлениеТоваровУслуг', { max_length: 12 }), 'postuplenie');
});

test('fails fast instead of inventing a slug', () => {
    assert.throws(() => make_slug('文書'), /nothing left after transliteration/u);
    assert.throws(() => make_slug(42), /expected string/u);
});

test('reports collisions instead of silently suffixing', () => {
    const slugs = make_unique_slugs(['ЗаказПоставщику', 'ВыпускПродукции']);
    assert.equal(slugs.get('ВыпускПродукции'), 'vypusk-produktsii');
    assert.throws(() => make_unique_slugs(['Заказ Клиента', 'ЗаказКлиента']), /slug collision/u);
});
