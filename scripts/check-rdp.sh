#!/usr/bin/env bash
set -euo pipefail

domain=
user=
password=
host=

output=$(
    timeout 10s impacket-rdp_check \
        "$domain/$user:$password@$host" 2>&1
)
rc=$?

if [ "$rc" -eq 124 ]; then
    echo 'CRITICAL: RDP authentication timeout'
    exit 2
fi

case "$output" in
    *'Access Granted'*)
        echo 'OK: RDP credentials accepted'
        exit 0
        ;;
    *'Access Denied'*)
        echo 'CRITICAL: RDP credentials rejected'
        exit 2
        ;;
    *)
        echo "UNKNOWN: $output"
        exit 3
        ;;
esac


exit 0

use:

timeout 10s impacket-rdp_check \
    'COMPUTER/monitor:password@192.168.1.50' 2>&1 |
    grep -q 'Access Granted'
