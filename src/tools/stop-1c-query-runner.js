import { config } from '../configure.js';
import { buildReadOneCQueryRunnerScript, buildStopOneCQueryRunnerScript } from '../infrastructure/build-stop-1c-query-runner-script.js';
import { executeGuestPowerShell } from '../infrastructure/execute-guest-powershell.js';
import { withGuestSession } from '../infrastructure/with-guest-session.js';

export async function stopOneCQueryRunner() {
    const output = await withGuestSession(({ ssh }) => executeGuestPowerShell(
        ssh,
        buildStopOneCQueryRunnerScript(
            config.oneCQueryRunner.guest.stagingDirectory,
            config.oneCQueryRunner.stopTimeoutSeconds,
        ),
        'stop 1C query runner',
    ));
    // CIM can retain a process record briefly in the same PowerShell session
    // after Stop-Process. Reconnect before asserting the postcondition.
    const checkOutput = await withGuestSession(({ ssh }) => executeGuestPowerShell(
        ssh,
        buildReadOneCQueryRunnerScript(config.oneCQueryRunner.guest.stagingDirectory),
        'check stopped 1C query runner',
    ));
    const state = JSON.parse(checkOutput);
    if (state.processIds.length !== 0) throw new Error(`1C query runner process is still running: ${state.processIds.join(',')}`);
    console.log(JSON.stringify({ ...JSON.parse(output), remainingProcessIds: state.processIds }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
    stopOneCQueryRunner().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
