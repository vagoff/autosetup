import path from 'node:path';

export function parseHeadlessDocumentsTopArguments(argv, maxTop) {
    if (argv[0] !== '--documents-top') throw new Error('usage: node src/run-1c-headless-documents-top.js --documents-top <N> [--configuration-xml guest-file] [--output file.json]');
    const top = Number(argv[1]);
    if (!Number.isSafeInteger(top) || top < 1 || top > maxTop) throw new Error(`--documents-top must be an integer between 1 and ${maxTop}`);
    let outputFilename = '1c-headless-documents-top.json';
    let configurationXmlPath = null;
    for (let index = 2; index < argv.length; index += 2) {
        if (index + 1 >= argv.length) throw new Error(`${argv[index]} requires a value`);
        if (argv[index] === '--output') outputFilename = argv[index + 1];
        else if (argv[index] === '--configuration-xml') configurationXmlPath = argv[index + 1];
        else throw new Error(`unknown headless documents-top argument: ${argv[index]}`);
    }
    if (path.basename(outputFilename) !== outputFilename) throw new Error('--output must be a filename, not a path');
    if (configurationXmlPath !== null && !path.win32.isAbsolute(configurationXmlPath)) throw new Error('--configuration-xml must be an absolute guest path');
    return { top, outputFilename, configurationXmlPath };
}
