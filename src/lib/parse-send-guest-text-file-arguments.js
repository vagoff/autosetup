import path from 'node:path';

export function parseSendGuestTextFileArguments(argv) {
    if (argv.length !== 2 || argv[0] !== '--file') {
        throw new Error('usage: node src/send-guest-text-file.js --file <utf8-text-file>');
    }
    return { filePath: path.resolve(argv[1]) };
}
