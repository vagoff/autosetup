#!/usr/bin/env bash

set -euo pipefail
rm -rf vendor composer.lock composer.json

mkdir -p vendor
wget 'https://getcomposer.org/download/latest-stable/composer.phar' -O vendor/composer.phar
_composer() {
php vendor/composer.phar "${@}"
}

_composer init --name vagoff/php-demo --type project --no-interaction --license=proprietary --name=autosetup/php-odata-demo --description="Dolibarr module generated over the 1C standard OData interface"
cat > composer.json <<'EOF'
{
    "name": "autosetup/php-odata-demo",
    "description": "Dolibarr module generated over the 1C standard OData interface",
    "type": "project",
    "license": "proprietary",
    "config": {
        "sort-packages": true
    }
}
EOF

_composer require dakword/odata1c-client


echo "${0}: DONE"
exit 0

--no-interaction (-n): Do not ask any interactive question.


    library: This is the default. It will simply copy the files to /vendor.

    project: This denotes a project rather than a library. For example application shells like the Symfony standard edition, CMSs like the SilverStripe installer or full fledged applications distributed as packages.

    metapackage: An empty package that contains requirements and will trigger their installation, but contains no files and will not write anything to the filesystem.

    composer-plugin: A package of type composer-plugin may provide an installer for other packages that have a custom type. Only use a custom type if you need custom logic during installation.


    --name: Name of the package.
    --description: Description of the package.
    --author: Author name of the package.
    --type: Type of package.
    --homepage: Homepage of the package.
    --require: Package to require with a version constraint. Should be in format foo/bar:1.0.0.
    --require-dev: Development requirements, see --require.
    --stability (-s): Value for the minimum-stability field.
    --license (-l): License of package.
    --repository: Provide one (or more) custom repositories. They will be stored in the generated composer.json, and used for auto-completion when prompting for the list of requires. Every repository can be either an HTTP URL pointing to a composer repository or a JSON string which is similar to what the repositories key accepts.
    --autoload (-a): Add a PSR-4 autoload mapping to the composer.json. Automatically maps your package's namespace to the provided directory. (Expects a relative path, e.g. src/) See also PSR-4 autoload.

--no-interaction (-n): Do not ask any interactive question.
