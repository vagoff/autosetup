import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BasicAuth, ODataV3Client } from '@1c-odata/client';
import { config } from '../../src/config.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const password = (await readFile(config.oneCOData.passwordStatePath, 'utf8')).trim();
const baseUrl = 'http://127.0.0.1:' + config.apacheHttpd.hostPort + '/' + config.oneCOData.publicationName + '/' + config.oneCOData.endpointPath;
const client = new ODataV3Client({ baseUrl, auth: BasicAuth({ username: config.oneCOData.user.name, password }), serverTimezone: config.oneCOData.serverTimezone, shape: { dateMode: 'string' } });
const sets = Object.fromEntries(config.oneCOData.demo.documentNames.map((name) => [name, 'Document_' + name]));
// Организация -- ссылочный реквизит есть у всех трёх документов демо и уже
// опубликован через catalogRights. Показываем его как выпадающий список,
// чтобы демо реально трогало справочник, а не только текстовое поле.
const organizationSet = 'Catalog_Организации';

function reply(response, status, body, contentType = 'application/json; charset=utf-8') {
    response.writeHead(status, { 'content-type': contentType });
    response.end(typeof body === 'string' ? body : JSON.stringify(body));
}
async function body(request) {
    let text = '';
    for await (const chunk of request) text += chunk;
    return JSON.parse(text);
}
createServer(async (request, response) => {
    try {
        const url = new URL(request.url, 'http://' + request.headers.host);
        if (request.method === 'GET' && url.pathname === '/') return reply(response, 200, await readFile(path.join(directory, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
        if (request.method === 'GET' && url.pathname === '/api/organizations') {
            const { value } = await client.query(organizationSet).select('Ref_Key', 'Description').top(50).get();
            return reply(response, 200, value);
        }
        if (request.method === 'GET' && url.pathname === '/api/documents') {
            const documents = await Promise.all(Object.entries(sets).map(async ([name, set]) => {
                const { value } = await client.query(set).top(10).get();
                return {
                    name,
                    rows: value.map(({ Ref_Key, Number, Date, Комментарий, Организация_Key }) => (
                        { Ref_Key, Number, Date, Комментарий: Комментарий ?? '', Организация_Key: Организация_Key ?? '' }
                    )),
                };
            }));
            return reply(response, 200, documents);
        }
        const match = /^\/api\/documents\/([^/]+)\/([0-9a-f-]+)$/u.exec(url.pathname);
        const name = match && decodeURIComponent(match[1]);
        if (request.method === 'PATCH' && match && sets[name]) {
            const { Комментарий, Организация_Key } = await body(request);
            if (typeof Комментарий !== 'string') return reply(response, 400, { error: 'Комментарий must be a string' });
            if (typeof Организация_Key !== 'string' || Организация_Key === '') return reply(response, 400, { error: 'Организация_Key must be a non-empty string' });
            await client.entity(sets[name], match[2]).patch({ Комментарий, Организация_Key });
            return reply(response, 204, '');
        }
        return reply(response, 404, { error: 'not found' });
    } catch (error) { return reply(response, error.status ?? 500, { error: error.message }); }
// Порт переопределим переменной окружения -- нужно регрессионному тесту,
// чтобы не драться за порт с демо-сервером, который мог уже запустить человек.
}).listen(Number(process.env.ODATA_DEMO_PORT) || config.oneCOData.demo.port, config.oneCOData.demo.host, function () { console.log('OData demo: http://127.0.0.1:' + this.address().port); });
