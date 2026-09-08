import { config } from '../../configure.js';
import { runGuestDebuggerScript } from './run-guest-debugger-script.js';

export async function readGuestAcpiShutdownEvents() {
    const settings = config.diagnostics.debuggers.powerButtonEvents;
    const output = await runGuestDebuggerScript({
        filename: 'read-acpi-shutdown-events.ps1',
        argumentsList: [String(settings.lookbackHours), String(settings.maxRecordsPerLog)],
        label: 'read guest ACPI shutdown events',
    });
    const result = JSON.parse(output);
    console.log(JSON.stringify(result, null, 2));
    return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    readGuestAcpiShutdownEvents().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
