import assert from 'node:assert/strict';
import test from 'node:test';
import { renderAutounattendXml } from '../infrastructure/render-autounattend-xml.js';

test('autologon count is rendered from the declared config', () => {
    const xml = renderAutounattendXml({
        unattend: {
            enableAutoLogon: true,
            autoLogonCount: 37,
            adminUsername: 'admin',
            adminPassword: 'secret',
            firstLogonCommands: [],
        },
        windowsUpdate: { disable: false },
    });
    assert.match(xml, /<LogonCount>37<\/LogonCount>/u);
});
