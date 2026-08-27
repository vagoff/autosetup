'use strict';

// Слагификатор общего назначения: строка произвольного языка -> kebab-case
// ASCII-слаг, пригодный для имени файла и URL. Чистая функция без I/O, без
// знания о 1С и Dolibarr -- переиспользуется в любом проекте.
//
// Транслитерация -- ГОСТ-подобная практическая схема (та, что даёт читаемый
// результат для русского), а не academic-стандарт: цель -- узнаваемое имя
// файла, а не обратимость.

const CYRILLIC_MAP = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
    щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
    // украинские буквы: инфобаза украинская, они реально встречаются
    ґ: 'g', є: 'ie', і: 'i', ї: 'i',
};

// Границы слов ищем ДО транслитерации: в исходнике они выражены сменой
// регистра (ЗаказПоставщику), а после транслитерации эта информация теряется.
function split_words(text) {
    const words = [];
    let current = '';
    let prev_kind = null;
    for (const char of text) {
        const kind = /\p{Lu}/u.test(char) ? 'upper' : (/[\p{Ll}\p{N}]/u.test(char) ? 'lower' : 'other');
        if (kind === 'other') {
            if (current) words.push(current);
            current = '';
            prev_kind = null;
            continue;
        }
        // Начало нового слова: заглавная после строчной (ЗаказПоставщику) или
        // строчная после серии заглавных (HTTPServer -> http, server).
        if (kind === 'upper' && prev_kind === 'lower') {
            if (current) words.push(current);
            current = '';
        } else if (kind === 'lower' && prev_kind === 'upper' && current.length > 1) {
            words.push(current.slice(0, -1));
            current = current.slice(-1);
        }
        current += char;
        prev_kind = kind;
    }
    if (current) words.push(current);
    return words;
}

function transliterate(word) {
    let result = '';
    for (const char of word.toLowerCase()) {
        if (Object.prototype.hasOwnProperty.call(CYRILLIC_MAP, char)) {
            result += CYRILLIC_MAP[char];
        } else if (/[a-z0-9]/u.test(char)) {
            result += char;
        }
        // Всё прочее (иероглифы, эмодзи, диакритика) осознанно отбрасывается:
        // молча ASCII-фицировать произвольный юникод -- источник коллизий,
        // а они ловятся вызывающим через make_unique_slugs().
    }
    return result;
}

const default_options = {
    max_length: 64,
};

function make_slug(text, options = {}) {
    const {max_length} = {...default_options, ...options};
    if (typeof text !== 'string') throw new Error(`make_slug: expected string, got ${typeof text}`);
    const words = split_words(text).map(transliterate).filter((word) => word !== '');
    if (words.length === 0) throw new Error(`make_slug: nothing left after transliteration of ${JSON.stringify(text)}`);
    let slug = words.join('-');
    if (slug.length > max_length) {
        // Режем по границе слова, чтобы не получить обрубок вроде "postuplenie-tovar".
        slug = slug.slice(0, max_length + 1);
        const cut = slug.lastIndexOf('-');
        slug = cut > 0 ? slug.slice(0, cut) : slug.slice(0, max_length);
    }
    return slug;
}

// Коллизии не разруливаем автоматически (никаких молчаливых "-2"): имя файла
// и пункт меню должны быть стабильны между запусками генератора, а
// авто-суффикс зависит от порядка обхода. Падаем и требуем явный слаг в конфиге.
function make_unique_slugs(texts, options = {}) {
    const result = new Map();
    const seen = new Map();
    for (const text of texts) {
        const slug = make_slug(text, options);
        if (seen.has(slug)) {
            throw new Error(`make_unique_slugs: slug collision ${JSON.stringify(slug)} for ${JSON.stringify(seen.get(slug))} and ${JSON.stringify(text)}; set an explicit slug in the config`);
        }
        seen.set(slug, text);
        result.set(text, slug);
    }
    return result;
}

module.exports.make_slug = make_slug;
module.exports.make_unique_slugs = make_unique_slugs;
