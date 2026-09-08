import { config } from '../../configure.js';
import { runGuestDebuggerScript } from './run-guest-debugger-script.js';

export async function readGuestPowerButtonAction() {
    const output = await runGuestDebuggerScript({
        filename: 'read-power-button-action.ps1',
        label: 'read guest power button action',
    });
    const result = JSON.parse(output);
    console.log(JSON.stringify(result, null, 2));
    return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    readGuestPowerButtonAction().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
