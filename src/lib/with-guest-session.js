import { connectGuestSsh } from './connect-guest-ssh.js';
import { removeGuestDirectory, stageGuestFiles } from './stage-guest-files.js';

// Жизненный цикл SSH-сессии к гостю и staging-каталога в ней — один раз,
// вместо пяти дословных копий "connect / try / stage / remove / dispose"
// в модулях установки.
//
// session — намеренно мутируемый объект { ssh }, а не голый клиент:
// установка может перезагрузить гостя и получить НОВОЕ соединение
// (см. restartGuestAndWait). Тогда модуль присваивает session.ssh, и
// освобождение в finally касается уже актуального соединения, а не
// закрытого старого.
export async function withGuestSession(run) {
    const session = { ssh: await connectGuestSsh() };
    try {
        return await run(session);
    } finally {
        session.ssh.dispose();
    }
}

// Staging удаляется ТОЛЬКО при успехе. Это не забывчивость: msiexec и
// Designer читают исходники до самого конца, и снос каталога на упавшем
// шаге превращает настоящую причину в невнятный MSI 1603. При ошибке
// каталог остаётся для разбора — ровно то, чего требует NOHIDEBUG.
export async function withGuestStaging(session, { stagingRoot, files }, run) {
    const remoteDirectory = await stageGuestFiles(session.ssh, { stagingRoot, files });
    const result = await run(remoteDirectory);
    await removeGuestDirectory(session.ssh, remoteDirectory);
    return result;
}
