set -euo pipefail

rm -rf node_modules package.json yarn.lock package.lock yarn-error.log .pnpm-debug.log pnpm-lock.yaml package-lock.json

cat > package.json <<'EOF'
{
  "license": "UNLICENSED",
  "private": true,
  "type": "commonjs"
}
EOF

exit 0
