import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../configure.js';
import { countTopDocumentsFromDesignerMetadata, countTopDocumentsFromExistingDesignerMetadata } from '../infrastructure/dump-1c-configuration-metadata.js';
import { parseHeadlessDocumentsTopArguments } from '../infrastructure/parse-headless-documents-top-arguments.js';
import { assertOneCPlatformInstalled } from '../infrastructure/read-1c-platform-state.js';
import { withGuestSession, withGuestStaging } from '../infrastructure/with-guest-session.js';

export async function runOneCHeadlessDocumentsTop(argv = process.argv.slice(2)) {
    const { oneC, oneCConfiguration, oneCHeadlessQuery, paths } = config;
    const args = parseHeadlessDocumentsTopArguments(argv, oneCHeadlessQuery.maxDocumentsTop);
    const result = await withGuestSession(async (session) => {
        await assertOneCPlatformInstalled(session.ssh, oneC);
        return withGuestStaging(session, {
            stagingRoot: oneCHeadlessQuery.guest.stagingDirectory,
            files: [],
        }, (remoteDirectory) => (args.configurationXmlPath
            ? countTopDocumentsFromExistingDesignerMetadata({
                ssh: session.ssh,
                oneCConfiguration,
                oneCHeadlessQuery,
                remoteDirectory,
                remoteConfigurationXmlPath: args.configurationXmlPath,
                top: args.top,
            })
            : countTopDocumentsFromDesignerMetadata({
                ssh: session.ssh,
                oneC,
                oneCConfiguration,
                oneCHeadlessQuery,
                remoteDirectory,
                top: args.top,
            })));
    });
    const outputPath = path.join(paths.outputDir, args.outputFilename);
    await mkdir(paths.outputDir, { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(result, null, 2));
    console.log(`1C headless documents top: ${outputPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) runOneCHeadlessDocumentsTop().catch((error) => { console.error(error.message); process.exit(1); });
