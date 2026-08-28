while true; do AUTOSETUP_PROFILE=data/profiles/win11-1c.json5 node src/tools/top-guest-processes.js |jq '.top[0]';done
