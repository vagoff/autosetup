// Command line entry point for run-vm.js: turns `--profile <name>` into the profile
// src/config.js will pick up. Everything a human or an agent starts (including the
// process-manager service, see scripts/services.def) goes through here, not through
// run-vm.js directly.
//
// [!] VIOLATION, temporary bridge, remove together with the env var itself: config.js
// [!] resolves its profile from process.env.AUTOSETUP_PROFILE at *import* time, so the
// [!] only way to pass a choice into it without touching it is to write that variable
// [!] before it is imported. Passing an argument through the process environment is a
// [!] global variable by another name; the honest fix is config.js becoming a function
// [!] load_config({profile_path}) whose value is passed down to its consumers. Until
// [!] then: this file is the ONLY place in the whole system allowed to write
// [!] AUTOSETUP_PROFILE, and adding a second such variable is not an option.
//
// [!] JSONCFG violation: these paths are constants here, exactly as they are in
// [!] config.js -- they belong in data/vars.json5, which config.js itself cannot read
// [!] before it knows the profile. Fixed by the same refactoring as above.
//
// [!] The import below is dynamic on purpose and MUST stay inside main(): static ESM
// [!] imports are evaluated before any statement of this module's body, so a static
// [!] `import` of run-vm.js would run config.js -- and read the variable -- before the
// [!] line that sets it. run-vm.js has no export and starts the VM as a side effect of
// [!] being imported ([!] unwrapped main, see its own tail), so importing it IS running it.
import {readdirSync} from 'node:fs';
import path from 'node:path';
import cli from '/data/wd/aibox/dev-env/libs/json-args/src/cli_main.js';

const PROFILES_DIR = '/data/wd/aibox/autosetup/data/profiles'; // [!] JSONCFG violation
const RUN_VM = '/data/wd/aibox/autosetup/src/run-vm.js'; // [!] JSONCFG violation
const PROFILE_SUFFIX = '.json5'; // [!] JSONCFG violation

function available_profiles() {
    return readdirSync(PROFILES_DIR).filter((f) => f.endsWith(PROFILE_SUFFIX)).map((f) => f.slice(0, -PROFILE_SUFFIX.length)).sort();
}

// Resolved here, in the process that has a command line and a user to complain to -- not
// inside config.js in a service whose stderr one first has to go find.
function resolve_profile_path(name) {
    const known = available_profiles();
    if (!known.includes(name)) {
        throw new Error(`--profile ${name}: no such profile in ${PROFILES_DIR} (have: ${known.join(', ') || 'none'})`);
    }
    return path.join(PROFILES_DIR, name + PROFILE_SUFFIX);
}

function make_cli_options_schema(t) {
    return t.record({
        profile: t.optional(t.describe(t.string1, `which VM to run: a file name (without ${PROFILE_SUFFIX}) from ${PROFILES_DIR}; omitted, the single profile there is used and ambiguity is an error`)),
    });
}

async function main(options) {
    if (options.profile !== undefined) {
        process.env.AUTOSETUP_PROFILE = resolve_profile_path(options.profile); // [!] VIOLATION, see the header
    }
    await import(RUN_VM);
}

export {main};

if (import.meta.url === `file://${process.argv[1]}`) {
    await cli.cli_main(main, make_cli_options_schema, process.argv, {
        description: 'run the Windows VM described by a data/profiles/<name>.json5 profile',
    });
}
