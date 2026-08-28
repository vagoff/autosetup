import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import JSON5 from 'json5';
import { loadDotenv } from './lib/load-dotenv.js';

// Единственный источник правды — человекоредактируемые файлы с
// комментариями в data/:
//  - vars.json5   — голые пути и номера TCP-портов;
//  - base.json5   — ядро: как ставить и настраивать VM, не зависит от
//                    выбора фич;
//  - profiles/*.json5 — какая это VM (vmName) и какой набор опциональных
//                    фич у неё включён, по порядку;
//  - features/*.json5 — параметры и guest-скрипты одной опциональной
//                    фичи (openssh/winrm/serial-agent/...), одна фича —
//                    один файл.
// Этот модуль только парсит, резолвит и сливает всё это в один
// config-объект прежней плоской формы — никаких собственных констант
// тут быть не должно.
const DATA_DIR = '/data/wd/aibox/autosetup/data';
loadDotenv(path.join(DATA_DIR, '..', '.env'));
const vars = JSON5.parse(readFileSync(path.join(DATA_DIR, 'vars.json5'), 'utf8'));
const base = JSON5.parse(readFileSync(path.join(DATA_DIR, 'base.json5'), 'utf8'));
const oneC = JSON5.parse(readFileSync(path.join(DATA_DIR, '1c-platform.json5'), 'utf8'));
const oneCConfiguration = JSON5.parse(readFileSync(path.join(DATA_DIR, '1c-configuration.json5'), 'utf8'));
const oneCOData = JSON5.parse(readFileSync(path.join(DATA_DIR, '1c-odata.json5'), 'utf8'));
const oneCQueryRunner = JSON5.parse(readFileSync(path.join(DATA_DIR, '1c-query-runner.json5'), 'utf8'));
const oneCHeadlessQuery = JSON5.parse(readFileSync(path.join(DATA_DIR, '1c-headless-query.json5'), 'utf8'));
const oneCTechsysUpdate = JSON5.parse(readFileSync(path.join(DATA_DIR, '1c-techsys-update.json5'), 'utf8'));
const apacheHttpd = JSON5.parse(readFileSync(path.join(DATA_DIR, 'apache-httpd.json5'), 'utf8'));

// vars.qemu и base.qemu описывают непересекающиеся подмножества полей
// одного и того же логического qemu{} — при случайном дублировании ключа
// падаем сразу (fail-fast), а не молча даём одному файлу перезаписать
// другой в неопределённом порядке.
for (const key of Object.keys(vars.qemu)) {
    if (key in base.qemu) {
        throw new Error(`data/vars.json5 и data/base.json5 оба определяют qemu.${key}`);
    }
}

const raw = {
    ...base,
    projectRoot: vars.projectRoot,
    network: vars.network,
    qemu: { ...base.qemu, ...vars.qemu },
};

const { projectRoot } = raw;

function resolveGuestPortForward(name, owner) {
    const portForward = raw.qemu.guestPortForwards.find((forward) => forward.name === name);
    if (!portForward) throw new Error(`${owner}=${name}: соответствующий элемент qemu.guestPortForwards не найден`);
    // hostAddress обязателен и не имеет default: адрес прослушивания — это
    // решение о доступности гостя снаружи, оно должно быть видно в конфиге
    // глазами, а не унаследовано молча из network.loopbackHost.
    if (!portForward.hostAddress) throw new Error(`qemu.guestPortForwards[${name}]: hostAddress обязателен и должен быть задан явно`);
    return portForward;
}

// Профиль — явный выбор человека/агента, какую VM и с каким набором фич
// собираем. Пока в data/profiles/ лежит один файл — выбирать нечего,
// используем его; как только появится второй — дальше без явного
// AUTOSETUP_PROFILE не поедем (fail-fast на неоднозначность, а не
// "первый попавшийся"/угадывание).
function resolveActiveProfilePath() {
    const profilesDir = path.join(DATA_DIR, 'profiles');
    const envPath = process.env.AUTOSETUP_PROFILE;
    if (envPath) {
        const resolved = path.resolve(envPath);
        if (!existsSync(resolved)) throw new Error(`AUTOSETUP_PROFILE=${envPath}: файл не найден`);
        return resolved;
    }
    const candidates = readdirSync(profilesDir).filter((f) => f.endsWith('.json5'));
    if (candidates.length === 0) throw new Error(`нет ни одного профиля в ${profilesDir}`);
    if (candidates.length > 1) {
        throw new Error(
            `в ${profilesDir} несколько профилей (${candidates.join(', ')}) — укажи явно через переменную окружения AUTOSETUP_PROFILE=data/profiles/<имя>.json5`
        );
    }
    return path.join(profilesDir, candidates[0]);
}

const profilePath = resolveActiveProfilePath();
const profile = JSON5.parse(readFileSync(profilePath, 'utf8'));
const { vmName } = profile;

const seenFeatureIds = new Set();
for (const id of profile.features) {
    if (seenFeatureIds.has(id)) throw new Error(`${profilePath}: фича "${id}" перечислена в features дважды`);
    seenFeatureIds.add(id);
}

const rawFeaturesById = {};
for (const id of profile.features) {
    const featurePath = path.join(DATA_DIR, 'features', `${id}.json5`);
    if (!existsSync(featurePath)) throw new Error(`${profilePath}: фича "${id}" — нет файла ${featurePath}`);
    rawFeaturesById[id] = JSON5.parse(readFileSync(featurePath, 'utf8'));
}

const paths = {
    dataDir: DATA_DIR,
    dbDir: path.join(projectRoot, 'db'),
    cacheDir: path.join(projectRoot, 'cache'),
    vmDbDir: path.join(projectRoot, 'db', vmName),
    vmCacheDir: path.join(projectRoot, 'cache', vmName),
    isoDir: path.join(projectRoot, 'cache', 'iso'),
    vendorDir: path.join(projectRoot, 'vendor'),
    featuresDir: path.join(projectRoot, 'features'),
    outputDir: path.join(projectRoot, 'output'),
    // .ps1-исходники FirstLogonCommands (см. src/infrastructure/build-first-logon-commands.js).
    guestScriptsDir: path.join(projectRoot, 'src', 'infrastructure', 'guest-scripts'),
};

const apachePortForward = resolveGuestPortForward('apache-http', 'data/apache-httpd.json5');
if (apacheHttpd.listenPort !== apachePortForward.guestPort) {
    throw new Error(
        `data/apache-httpd.json5 listenPort=${apacheHttpd.listenPort} does not match apache-http guestPort=${apachePortForward.guestPort} in data/vars.json5`
    );
}

// Наблюдаемый факт "этот диск уже пережил один успешный install Windows",
// не конфиг — в db/, потому что обязан пережить перезапуск процесса/хоста
// (в отличие от cache/), и жить ровно столько же, сколько сам диск (см.
// src/verbs/mark-windows-install-complete.js, src/infrastructure/resolve-boot-from-installer.js,
// src/verbs/destroy-windows-install-complete-marker.js).
paths.installCompleteMarkerPath = path.join(paths.vmDbDir, 'install-complete.marker');

// Один деривер на фичу: превращает "сырой" data/features/<id>.json5 в то,
// что дальше потребляют src/verbs, src/tools, src/services (добавляет вычисленные пути и
// разрешённые из vars.json5 порты). Добавление новой фичи — это добавить
// сюда одну запись, а не трогать чужие: та же логика, что уже была для
// openSsh/winRm, просто явно поимённо привязана к id фичи вместо
// позиционных аргументов.
const FEATURE_DERIVERS = {
    openssh: (feature) => {
        const portForward = resolveGuestPortForward(feature.guestPortForwardName, 'features/openssh.json5: guestPortForwardName');
        return {
            ...feature,
            archivePath: path.join(paths.cacheDir, 'openssh', feature.archiveFilename),
            clientPrivateKeyPath: path.join(paths.vmDbDir, feature.clientPrivateKeyFilename),
            clientPublicKeyPath: path.join(paths.vmDbDir, feature.clientPublicKeyFilename),
            knownHostsPath: path.join(paths.vmCacheDir, feature.check.knownHostsFilename),
            port: portForward.guestPort,
            hostPort: portForward.hostPort,
            hostAddress: portForward.hostAddress,
        };
    },
    winrm: (feature) => {
        const portForward = resolveGuestPortForward(feature.guestPortForwardName, 'features/winrm.json5: guestPortForwardName');
        return { ...feature, port: portForward.guestPort, hostPort: portForward.hostPort, hostAddress: portForward.hostAddress };
    },
    rdp: (feature) => {
        const portForward = resolveGuestPortForward(feature.guestPortForwardName, 'features/rdp.json5: guestPortForwardName');
        return { ...feature, port: portForward.guestPort, hostPort: portForward.hostPort, hostAddress: portForward.hostAddress };
    },
    'serial-agent': (feature) => ({ ...feature }),
};

// config-ключ, под которым деривированные данные фичи видны потребителям
// (config.openSsh/config.winRm/config.rdp/config.serialAgent) — имена
// исторические (camelCase, а не kebab-case id файла), меняются с
// одобрения по всему дереву src/ (verbs/tools/services/features), а не молча.
const FEATURE_EXPORT_KEYS = { openssh: 'openSsh', winrm: 'winRm', rdp: 'rdp', 'serial-agent': 'serialAgent' };

const derivedFeaturesById = {};
for (const id of profile.features) {
    const derive = FEATURE_DERIVERS[id];
    if (!derive) throw new Error(`${profilePath}: фича "${id}" — нет деривера в FEATURE_DERIVERS (src/configure.js)`);
    derivedFeaturesById[id] = derive(rawFeaturesById[id]);
}

// Упорядоченный (по профилю) список фич с их деривированным конфигом и
// именами guest-скриптов — единственное, что нужно
// build-first-logon-commands.js, чтобы собрать USB-образ без знания
// заранее о конкретных фичах (openssh/winrm/...).
const guestFeatures = profile.features.map((id) => ({
    id,
    config: derivedFeaturesById[id],
    guestScripts: {
        firstLogon: rawFeaturesById[id].guestScripts?.firstLogon ?? [],
        supporting: rawFeaturesById[id].guestScripts?.supporting ?? [],
    },
}));

const namedFeatureConfigs = {};
for (const [id, featureConfig] of Object.entries(derivedFeaturesById)) {
    namedFeatureConfigs[FEATURE_EXPORT_KEYS[id]] = featureConfig;
}

export const config = {
    paths,
    network: raw.network,
    windowsIso: raw.windowsIso,
    diagnostics: raw.diagnostics,
    windowsUpdate: raw.windowsUpdate,
    guestScriptStagingDirectory: raw.guestScriptStagingDirectory,
    oneC: {
        ...oneC,
        sourceDirectory: path.join(projectRoot, oneC.sourceDirectory),
        clientExecutablePath: path.win32.join(oneC.installationDirectory, oneC.clientExecutableRelativePath),
        thinClientExecutablePath: path.win32.join(oneC.installationDirectory, oneC.thinClientExecutableRelativePath),
        comConnectorPath: path.win32.join(oneC.installationDirectory, oneC.comConnectorRelativePath),
    },
    oneCConfiguration: {
        ...oneCConfiguration,
        sourceDirectory: path.join(projectRoot, oneCConfiguration.sourceDirectory),
    },
    oneCOData: {
        ...oneCOData,
        passwordStatePath: path.join(paths.vmDbDir, oneCOData.user.passwordStateFilename),
        metadata: {
            ...oneCOData.metadata,
            dumpPath: path.join(projectRoot, oneCOData.metadata.dumpPath),
        },
        publisher: {
            ...oneCOData.publisher,
            sourceDirectory: path.join(projectRoot, oneCOData.publisher.sourceDirectory),
        },
    },
    oneCQueryRunner: {
        ...oneCQueryRunner,
        sourceDirectory: path.join(projectRoot, oneCQueryRunner.sourceDirectory),
    },
    oneCHeadlessQuery,
    oneCTechsysUpdate: {
        ...oneCTechsysUpdate,
        sourceDirectory: path.join(projectRoot, oneCTechsysUpdate.sourceDirectory),
        targetPath: path.join(oneC.installationDirectory, 'bin', oneCTechsysUpdate.filename),
        backupPath: path.join(oneC.installationDirectory, 'bin', oneCTechsysUpdate.backupFilename),
    },
    apacheHttpd: {
        ...apacheHttpd,
        sourceDirectory: path.join(paths.vendorDir, apacheHttpd.vendorSubdirectory),
        archivePath: path.join(paths.vendorDir, apacheHttpd.vendorSubdirectory, apacheHttpd.archiveFilename),
        visualCppRuntime: {
            ...apacheHttpd.visualCppRuntime,
            path: path.join(paths.vendorDir, apacheHttpd.vendorSubdirectory, apacheHttpd.visualCppRuntime.filename),
        },
        hostPort: apachePortForward.hostPort,
        hostAddress: apachePortForward.hostAddress,
        port: apachePortForward.guestPort,
    },
    guestFeatures,
    // openSsh / winRm / serialAgent присутствуют только если
    // соответствующая фича включена в активном профиле (см.
    // data/profiles/*.json5) — обращение к отсутствующей фиче из
    // потребителя (src/verbs, src/tools, src/services) упадёт явной ошибкой доступа к undefined, что и есть
    // fail-fast для "эта фича не выбрана в профиле, а код её требует".
    ...namedFeatureConfigs,
    unattend: {
        ...raw.unattend,
        // чистый build-артефакт из конфига, без накопленного состояния —
        // поэтому в cache/, а не в db/ (в отличие от диска/OVMF vars/tpm).
        answerFileImagePath: path.join(paths.vmCacheDir, raw.unattend.answerFileFilename.replace(/\.xml$/i, '.img')),
    },
    disk: {
        ...raw.disk,
        path: path.join(paths.vmDbDir, 'disk.qcow2'),
    },
    ovmf: {
        ...raw.ovmf,
        varsPath: path.join(paths.vmDbDir, 'OVMF_VARS.fd'),
    },
    tpm: {
        ...raw.tpm,
        stateDir: path.join(paths.vmDbDir, 'tpm'),
        // сокет — рантайм-артефакт процесса, не состояние TPM, поэтому в cache,
        // а не в db (см. data/base.json5 про причину unix-сокета здесь).
        ctrlSocketPath: path.join(paths.vmCacheDir, raw.tpm.ctrlSocketFilename),
    },
    qemu: {
        ...raw.qemu,
        vmName,
        pidFile: path.join(paths.vmCacheDir, 'qemu.pid'),
        screendumpPath: path.join(paths.vmCacheDir, raw.qemu.screendumpFilename),
        // COM1-лог — рантайм-артефакт (не состояние VM), пишет
        // capture-serial-log.js, поэтому в cache/<vm>/, не в db/.
        serialLogPath: path.join(paths.vmCacheDir, raw.qemu.serialLogFilename),
    },
};
