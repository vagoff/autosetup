import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeQmpTextKeys } from '../src/lib/encode-qmp-text-keys.js';

test('QMP text encoder maps Russian query text to physical keys', () => {
    assert.deepEqual(encodeQmpTextKeys('ВЫБРАТЬ\n'), [
        [{ type: 'qcode', data: 'shift' }, { type: 'qcode', data: 'd' }],
        [{ type: 'qcode', data: 'shift' }, { type: 'qcode', data: 's' }],
        [{ type: 'qcode', data: 'shift' }, { type: 'qcode', data: 'comma' }],
        [{ type: 'qcode', data: 'shift' }, { type: 'qcode', data: 'h' }],
        [{ type: 'qcode', data: 'shift' }, { type: 'qcode', data: 'f' }],
        [{ type: 'qcode', data: 'shift' }, { type: 'qcode', data: 'n' }],
        [{ type: 'qcode', data: 'shift' }, { type: 'qcode', data: 'm' }],
        [{ type: 'qcode', data: 'ret' }],
    ]);
});

test('QMP text encoder supports query punctuation and rejects unsupported characters', () => {
    assert.deepEqual(encodeQmpTextKeys('(*)'), [
        [{ type: 'qcode', data: 'shift' }, { type: 'qcode', data: '9' }],
        [{ type: 'qcode', data: 'shift' }, { type: 'qcode', data: '8' }],
        [{ type: 'qcode', data: 'shift' }, { type: 'qcode', data: '0' }],
    ]);
    assert.throws(() => encodeQmpTextKeys('€'), /cannot type/u);
});
