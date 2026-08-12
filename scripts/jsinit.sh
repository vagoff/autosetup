set -euo pipefail

rm -rf node_modules package.json yarn.lock package.lock yarn-error.log .pnpm-debug.log pnpm-lock.yaml package-lock.json

cat > package.json <<'EOF'
{
  "license": "UNLICENSED",
  "private": true,
  "type": "module",
  "overrides": {
    "winrm-client": {
      "fast-xml-parser": "5.10.1"
    }
}
EOF

npm add json5 libmount basic-ftp node-ssh fast-xml-parser winrm-client
npm install-scripts approve ssh2
npm install-scripts approve cpu-features
npm i

exit 0
