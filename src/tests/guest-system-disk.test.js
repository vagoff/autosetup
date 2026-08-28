import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReadGuestVolumesScript } from '../infrastructure/read-guest-volumes.js';

test('guest df probe reads every fixed volume and reports used and free capacity', () => {
    const source = buildReadGuestVolumesScript();
    assert.match(source, /Win32_LogicalDisk/u);
    assert.match(source, /DriveType = 3/u);
    assert.match(source, /usedBytes/u);
    assert.match(source, /freeBytes/u);
    assert.match(source, /freePercent/u);
});
