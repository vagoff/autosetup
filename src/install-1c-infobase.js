import { restoreOneCInfobase } from './restore-1c-infobase.js';
import { createOneCInfobaseShortcuts } from './create-1c-infobase-shortcuts.js';

// Тонкий оркестратор полного развёртывания DT: сам не содержит условий,
// путей или действий над гостем, только упорядочивает отдельные модули.
export async function installOneCInfobase() {
    await restoreOneCInfobase();
    await createOneCInfobaseShortcuts();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    installOneCInfobase().catch((error) => {
        console.error(error.message);
        process.exit(1);
    });
}
