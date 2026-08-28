#!/usr/bin/env node
// Читает $metadata опубликованного стандартного OData 1С и складывает
// нормализованный дамп в features/php-odata-demo/data/dbinfo.json --
// вход для генератора модуля Dolibarr. Запускается человеком вручную,
// когда меняется конфигурация 1С или состав публикуемых типов.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../../src/configure.js';
import { parseODataMetadata } from './parse-odata-metadata.js';

const password = (await readFile(config.oneCOData.passwordStatePath, 'utf8')).trim();
const baseUrl = `http://127.0.0.1:${config.apacheHttpd.hostPort}/${config.oneCOData.publicationName}/${config.oneCOData.endpointPath}`;
const authorization = 'Basic ' + Buffer.from(`${config.oneCOData.user.name}:${password}`).toString('base64');

const response = await fetch(`${baseUrl}/$metadata`, { headers: { authorization } });
if (!response.ok) throw new Error(`GET $metadata: HTTP ${response.status} ${response.statusText}`);

// Состав дампа = состав прав из data/1c-odata.json5: единый источник правды,
// отдельного списка документов у генератора метаданных нет.
const dbinfo = parseODataMetadata(await response.text(), {
    documentNames: Object.keys(config.oneCOData.rights),
    catalogNames: Object.keys(config.oneCOData.catalogRights),
});

const outputPath = config.oneCOData.metadata.dumpPath;
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(dbinfo, null, 4) + '\n');
console.log(`${outputPath}: ${Object.keys(dbinfo.entities).length} entities, ${Object.keys(dbinfo.enums).length} enums`);
