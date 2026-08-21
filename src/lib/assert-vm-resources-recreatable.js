import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { resolveExistingPath } from './resolve-existing-path.js';

function findExecutable(binary) {
    if (binary.includes(path.sep)) return binary;
    for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
        if (!directory) continue;
        const candidate = path.join(directory, binary);
        try {
            accessSync(candidate, constants.X_OK);
            return candidate;
        } catch {
            // не в этом каталоге PATH -- пробуем следующий
        }
    }
    return null;
}

// "Не сноси то, что не сможешь восстановить."
//
// destroy-vm-resources.js -- чистые операции с файлами, поэтому он одинаково
// успешно работает и на обаруне, и в контейнере агента. А вот обратное
// создание требует qemu-img, virt-fw-vars и шаблона OVMF_VARS из edk2-ovmf,
// которые по замыслу стоят ТОЛЬКО на хосте (scripts/setup.sh). Без этой
// проверки агент из песочницы удаляет диск и UEFI-состояние, а воссоздать их
// уже не может -- ровно тот сценарий потери данных, о котором предупреждает
// шапка самого destroy-vm-resources.js.
//
// Шаблон OVMF_VARS намеренно проверяется именно здесь и не дублируется в
// alpine: vars обязан быть парой к OVMF_CODE, которым qemu грузит гостя, а
// это всегда прошивка хоста.
export function assertVmResourcesRecreatable() {
    const missing = [];

    for (const binary of ['qemu-img', config.ovmf.secureBoot.binary]) {
        if (!findExecutable(binary)) missing.push(`executable not found in PATH: ${binary}`);
    }
    try {
        resolveExistingPath(config.ovmf.varsTemplateCandidates, 'OVMF vars template');
    } catch (error) {
        missing.push(error.message);
    }

    if (missing.length > 0) {
        throw new Error([
            'refusing to destroy VM resources: this environment cannot recreate them.',
            ...missing.map((problem) => `  - ${problem}`),
            'Run the destroy/create pair on the host that has the qemu toolchain (scripts/setup.sh).',
        ].join('\n'));
    }
}
