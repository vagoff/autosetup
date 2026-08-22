import assert from 'node:assert/strict';
import test from 'node:test';
process.env.AUTOSETUP_PROFILE = 'data/profiles/win11-1c.json5';
const { buildGuestCpuTimesScript } = await import('../src/read-guest-cpu-times.js');

test('guest cumulative CPU reader uses GetSystemTimes and reports busy CPU time since boot', () => {
    const script = buildGuestCpuTimesScript();
    assert.match(script, /GetSystemTimes/u);
    assert.match(script, /busyCpuSeconds/u);
    assert.match(script, /LastBootUpTime/u);
    assert.doesNotMatch(script, /SetSystemTime|Stop-Process/u);
});
