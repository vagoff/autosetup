import { installOneCPlatform } from './install-1c-platform.js';
import { installApacheHttpd } from './install-apache-httpd.js';
import { configureOneCApacheWebExtension } from './configure-1c-apache-web-extension.js';

// Тонкий оркестратор полного набора «платформа 1С + Apache + модуль
// интеграции». В нём нет собственных условий или параметров: каждый шаг
// остаётся отдельно применимым и проверяемым модулем.
export async function installOneCWebEnvironment() {
    await installOneCPlatform();
    await installApacheHttpd();
    await configureOneCApacheWebExtension();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    installOneCWebEnvironment().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
