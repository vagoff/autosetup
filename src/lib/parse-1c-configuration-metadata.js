import { XMLParser } from 'fast-xml-parser';

function asArray(value) {
    return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function readString(value, path) {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`1C configuration metadata has no ${path}`);
    return value;
}

function documentFromNode(node) {
    if (typeof node === 'string') {
        const name = readString(node, 'Configuration.ChildObjects.Document');
        if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name)) throw new Error(`invalid 1C document metadata name: ${name}`);
        return { name, synonym: name };
    }
    const properties = node?.Properties;
    const name = readString(properties?.Name, 'Document.Properties.Name');
    const synonym = typeof properties?.Synonym === 'string' ? properties.Synonym : name;
    if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name)) throw new Error(`invalid 1C document metadata name: ${name}`);
    return { name, synonym };
}

function walk(value, documents) {
    if (Array.isArray(value)) {
        for (const item of value) walk(item, documents);
        return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        if (key === 'Document') {
            for (const node of asArray(child)) documents.push(documentFromNode(node));
            continue;
        }
        walk(child, documents);
    }
}

// /DumpConfigToFiles сохраняет XML-дерево конфигурации. Парсер намеренно
// принимает только единственный корневой MetaDataObject и сортирует результат:
// один и тот же снимок всегда даёт один и тот же список для последующих COUNT.
export function extractDocumentsFromConfigurationXml(xml) {
    const parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: true }).parse(xml);
    if (parsed?.MetaDataObject === undefined) throw new Error('1C configuration metadata root MetaDataObject is missing');
    const documents = [];
    // Реальный Configuration.xml от /DumpConfigToFiles содержит в
    // ChildObjects имена объектов, а не их развёрнутые Properties. Полные
    // XML-файлы документов лежат в соседних каталогах и для COUNT не нужны.
    const childObjects = parsed.MetaDataObject?.Configuration?.ChildObjects;
    if (childObjects?.Document !== undefined) {
        for (const node of asArray(childObjects.Document)) documents.push(documentFromNode(node));
    } else {
        // Поддерживаем развёрнутый снимок для тестовых и старых выгрузок.
        walk(parsed.MetaDataObject, documents);
    }
    const unique = new Map();
    for (const document of documents) {
        if (unique.has(document.name)) throw new Error(`duplicate 1C document metadata name: ${document.name}`);
        unique.set(document.name, document);
    }
    return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name, 'ru'));
}
