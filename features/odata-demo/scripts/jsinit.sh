set -euo pipefail

rm -rf node_modules package.json yarn.lock package.lock yarn-error.log .pnpm-debug.log pnpm-lock.yaml package-lock.json

cat > package.json <<'EOF'
{
  "license": "UNLICENSED",
  "private": true,
  "type": "module",
  "scripts": { "start": "node server.js" }
}
EOF

# @1c-odata/client is main and mandatory
npm add  @1c-odata/client @1c-odata/metadata
npm add -D @1c-odata/cli

exit 0
