#!/usr/bin/env bash
set -euo pipefail

# Пересобирает cache/.venv с нуля (как jsinit.sh — не идемпотентно само по
# себе, cache/ discardable). Ставит ТОЛЬКО vendor/impacket (наша закреплённая
# копия, не произвольная версия с PyPI) — её собственный setup.py сам тянет
# pyasn1/pycryptodomex/pyOpenSSL/... транзитивно. Нужен для
# src/tools/check-rdp-login.js (vendor/impacket/examples/rdp_check.py).

#cd /data/wd/aibox/autosetup

mkdir -p cache
rm -rf cache/.venv
python3 -m venv cache/.venv
cache/.venv/bin/pip install --quiet ./vendor/impacket
#cache/.venv/bin/pip install --quiet logger

exit 0
