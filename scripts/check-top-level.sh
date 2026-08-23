find -type f -name '*.js' -exec cat '{}' ';' |grep '^[a-z]'|grep -v '^const '|grep -v '^function '|grep -v '^import '|grep -v '^export '|grep -v '^async function '|grep -v '^if..import.meta.url.=='
