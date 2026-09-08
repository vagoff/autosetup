import { config } from '../../configure.js';
import { runGuestDebuggerScript } from './run-guest-debugger-script.js';

export async function readGuestConsoleSessionState() {
    const { maxTerminalServiceEvents } = config.diagnostics.debuggers.consoleSession;
    const output = await runGuestDebuggerScript({
        filename: 'read-console-session-state.ps1',
        argumentsList: [String(maxTerminalServiceEvents)],
        label: 'read guest console session state',
    });
    const result = JSON.parse(output);
    console.log(JSON.stringify(result, null, 2));
    return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    readGuestConsoleSessionState().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
