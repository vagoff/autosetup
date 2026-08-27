#!/usr/bin/env bash
# Настройка PHP-зависимостей демо-модуля Dolibarr `odatatest`.
# Идемпотентно: composer.json/composer.lock коммитятся, vendor/ -- нет.
set -euo pipefail

project_dir="$(cd "$(dirname "${0}")/.." && pwd)"
cd "${project_dir}"

# Клиент стандартного OData 1С. Выбор обоснован в doc/php-backend-adr.md:
# fluent-запросы, CRUD, $inlinecount и произвольный request() с заголовками --
# последнее обязательно для If-Match (оптимистическая блокировка по DataVersion).
composer install --no-interaction --no-progress

echo "${0}: DONE"
