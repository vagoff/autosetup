import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const projectRoot = path.resolve(import.meta.dirname, '../../..');
const port = 8099; // отдельный от data/1c-odata.json5#demo.port, чтобы не драться за него с человеком.
const env = { ...process.env, AUTOSETUP_PROFILE: 'data/profiles/win11-1c.json5', ODATA_DEMO_PORT: String(port) };

async function withDemoServer(run) {
    const child = spawn(process.execPath, ['features/odata-demo/server.js'], { cwd: projectRoot, env, stdio: ['ignore', 'pipe', 'inherit'] });
    try {
        await new Promise((resolve, reject) => {
            let stdout = '';
            child.stdout.on('data', (chunk) => {
                stdout += chunk;
                if (stdout.includes('OData demo:')) resolve();
            });
            child.once('exit', (code) => reject(new Error(`odata-demo server exited early with code ${code}`)));
        });
        return await run(`http://127.0.0.1:${port}`);
    } finally {
        child.kill();
    }
}

test('live odata-demo server lists documents and organizations, and edits a document including a catalog reference', {
    skip: process.env.AUTOSETUP_LIVE_TESTS !== '1',
    timeout: 30_000,
}, async () => {
    await withDemoServer(async (baseUrl) => {
        const organizations = await fetch(`${baseUrl}/api/organizations`).then((r) => r.json());
        assert.ok(Array.isArray(organizations) && organizations.length > 0);
        assert.ok(organizations[0].Ref_Key && organizations[0].Description !== undefined);

        const documents = await fetch(`${baseUrl}/api/documents`).then((r) => r.json());
        assert.ok(Array.isArray(documents) && documents.length === 3);
        const group = documents.find((g) => g.name === 'ЗаказПоставщику');
        assert.ok(group && group.rows.length > 0, 'ЗаказПоставщику group must have rows');
        const row = group.rows[0];
        assert.ok(row.Ref_Key && row.Организация_Key, 'row must carry a reference key, not just plain fields');

        // Регрессия: имя документа в пути percent-encoded (кириллица), сервер
        // обязан decodeURIComponent его перед сверкой с известными типами --
        // раньше это давало 404 на любой PATCH из настоящей демо-страницы.
        const otherOrganization = organizations.find((o) => o.Ref_Key !== row.Организация_Key) ?? organizations[0];
        const marker = `autosetup odata-demo live test ${new Date().toISOString()}`;
        const patchResponse = await fetch(`${baseUrl}/api/documents/${encodeURIComponent('ЗаказПоставщику')}/${row.Ref_Key}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ Комментарий: marker, Организация_Key: otherOrganization.Ref_Key }),
        });
        assert.equal(patchResponse.status, 204);

        const after = await fetch(`${baseUrl}/api/documents`).then((r) => r.json());
        const updatedRow = after.find((g) => g.name === 'ЗаказПоставщику').rows.find((r) => r.Ref_Key === row.Ref_Key);
        assert.equal(updatedRow.Комментарий, marker);
        assert.equal(updatedRow.Организация_Key, otherOrganization.Ref_Key);
    });
});
