import path from 'node:path';
import { existsSync } from 'node:fs';
import { config } from './configure.js';
import { runProcess } from './lib/run-process.js';
import { downloadWindowsIso } from './verbs/download-windows-iso.js';
import { downloadOpenSshArchive } from './verbs/download-open-ssh-archive.js';
import { downloadApacheHttpdArchive } from './verbs/download-apache-httpd-archive.js';
import { downloadApacheVisualCppRuntime } from './verbs/download-apache-visual-cpp-runtime.js';
import { createVmResources } from './verbs/orchestrators/create-vm-resources.js';
import { waitForWindowsInstallComplete } from './verbs/wait-for-windows-install-complete.js';
import { checkSshAccess } from './verbs/check-ssh-access.js';
import { checkRdpAccess } from './verbs/check-rdp-access.js';
import { installOneCWebEnvironment } from './verbs/orchestrators/install-1c-web-environment.js';
import { createOneCFirewallRules } from './verbs/create-1c-firewall-rules.js';
import { installOneCTechsysUpdate } from './verbs/install-1c-techsys-update.js';
import { installOneCInfobase } from './verbs/orchestrators/install-1c-infobase.js';
import { applyOneCConfiguration } from './verbs/apply-1c-configuration.js';
import { installOneCEpf } from './verbs/install-1c-epf.js';
import { registerOneCComConnector } from './verbs/register-1c-com-connector.js';
import { lockOneCInfobaseExternalResources } from './verbs/lock-1c-infobase-external-resources.js';
import { publishOneCOData } from './verbs/publish-1c-odata.js';

// Единственная команда полного пайплайна: от пустого db/cache до
// сгенерированного модуля php-odata-demo в docroot dobaerp. Тонкий
// оркестратор — каждый шаг уже является отдельно применимым и
// проверяемым модулем (verbs/orchestrators/tools), здесь только порядок.
// Выбор VM — как везде в проекте, через AUTOSETUP_PROFILE (см.
// src/services/run-vm-cli.js про то, почему этот файл НЕ пишет эту
// переменную сам, а только читает уже готовый config).
//
// Из коробки НЕ автоматизируется (и не должно): это не пробел, а честная
// граница воспроизводимости —
//   1. vendor/1C/BAF, vendor/1C/CONF, vendor/1C/UPDATE — дистрибутив и
//      прикладная часть 1С не распространяются публично, кладутся в
//      vendor/ руками ОДИН раз (см. data/1c-platform.json5,
//      data/1c-configuration.json5, data/1c-techsys-update.json5).
//      Каждый install-модуль сам проверяет их SHA-256 и fail-fast, если
//      их нет.
//   2. после генерации модуля Dolibarr его нужно один раз выключить и
//      включить в админке (см. features/php-odata-demo/README.md) —
//      это GUI-only шаг самого Dolibarr, скриптом не нажимается.
//
// STATEFUL-RESOURCE-GUARD: это бутстрап С НУЛЯ. createVmResources() (шаг
// ниже) fail-fast, если диск/OVMF/tpm/ssh-key уже существуют — повторный
// запуск на уже развёрнутой VM ожидаемо остановится тут с понятной
// ошибкой. Чтобы пересобрать с нуля — сначала
// verbs/orchestrators/destroy-vm-resources.js.
async function runFullPipeline() {
    const { paths } = config;

    console.log(`\n=== 1/8: скачивание публично доступных дистрибутивов (${config.qemu.vmName}) ===`);
    await downloadWindowsIso();
    await downloadOpenSshArchive();
    await downloadApacheHttpdArchive();
    await downloadApacheVisualCppRuntime();

    console.log('\n=== 2/8: создание ресурсов VM (диск, OVMF vars, TPM state, SSH-ключ) ===');
    await createVmResources();

    console.log(`\n=== 3/8: запуск VM через process-manager (qemu-${config.qemu.vmName}) ===`);
    await runProcess('a', ['pm', 'start', '--name', `qemu-${config.qemu.vmName}`]);

    console.log('\n=== 4/8: ожидание завершения установки Windows и первого входа гостя ===');
    await waitForWindowsInstallComplete();
    await checkSshAccess();
    const enabledOptionalFeatures = ['openSsh', 'winRm', 'rdp', 'serialAgent'].filter((key) => config[key]);
    console.log(`опциональные фичи гостя в активном профиле: ${enabledOptionalFeatures.join(', ') || '(нет)'}`);
    if (config.rdp) {
        // winRm сюда намеренно не входит: известный, принятый и не
        // чинящийся в рамках проекта баг библиотеки winrm-client (см.
        // комментарий в data/profiles/win11-1c.json5) не должен ронять
        // весь пайплайн из-за фичи, не влияющей на путь до php-odata.
        await checkRdpAccess();
    }

    console.log('\n=== 5/8: платформа 1С + Apache + модуль интеграции ===');
    await installOneCWebEnvironment();
    await createOneCFirewallRules();
    await installOneCTechsysUpdate();

    console.log('\n=== 6/8: восстановление инфобазы (DT) + применение конфигурации (CF) + EPF ===');
    await installOneCInfobase();
    await applyOneCConfiguration();
    await installOneCEpf();
    await registerOneCComConnector();
    await lockOneCInfobaseExternalResources();

    console.log('\n=== 7/8: публикация стандартного OData ===');
    await publishOneCOData();

    console.log('\n=== 8/8: генерация модуля php-odata-demo ===');
    await ensureFeatureDependenciesInstalled(path.join(paths.featuresDir, 'odata-demo'), 'node_modules');
    await runProcess('node', ['scripts/read-1c-odata-metadata.js'], { cwd: path.join(paths.featuresDir, 'odata-demo') });
    await ensureFeatureDependenciesInstalled(path.join(paths.featuresDir, 'php-odata-demo'), 'vendor/autoload.php');
    await runProcess('node', ['scripts/generate-odatatest-module.js'], { cwd: path.join(paths.featuresDir, 'php-odata-demo') });

    console.log([
        '',
        'пайплайн пройден до конца.',
        'единственный оставшийся шаг — ручной, GUI-only, за пределами автоматизации:',
        '  в админке Dolibarr выключить и включить модуль odatatest',
        '  (права read/write/delete заводятся только при активации,',
        '  см. features/php-odata-demo/README.md).',
        config.rdp ? `для визуальной проверки: RDP на 127.0.0.1:${config.rdp.hostPort} (или SPICE/VNC, см. data/base.json5 -> qemu.displayProtocol).` : '',
    ].filter(Boolean).join('\n'));
}

// scripts/{phpinit,jsinit}.sh написаны как безусловный "стереть и
// пересобрать с нуля" (см. их исходный код) — намеренно НЕ идемпотентны сами
// по себе и недёшевы (composer.phar качается заново). Гонять их на
// каждый прогон пайплайна незачем: если маркер зависимостей уже есть,
// это не "тихий пропуск проверки" (сами зависимости никакой пайплайн
// нигде дальше не проверяет на целостность), а обычная economия времени.
async function ensureFeatureDependenciesInstalled(featureDirectory, markerRelativePath) {
    const marker = path.join(featureDirectory, markerRelativePath);
    if (existsSync(marker)) return;
    const initScript = markerRelativePath.startsWith('vendor') ? 'phpinit.sh' : 'jsinit.sh';
    console.log(`${marker} отсутствует, запускаю ${path.join(featureDirectory, 'scripts', initScript)}`);
    await runProcess('bash', [path.join('scripts', initScript)], { cwd: featureDirectory });
}

if (import.meta.url === `file://${process.argv[1]}`) {
    runFullPipeline().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
