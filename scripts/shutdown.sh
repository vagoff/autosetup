#!/usr/bin/env bash

set -euo pipefail

ps -eo pid,ppid,stat,args | rg 'qemu-system|swtpm|node src/run-vm'

node --input-type=module -e "
import { connectQmp } from './src/lib/connect-qmp.js';
import { config } from './src/config.js';
const qmp = await connectQmp(config.network.loopbackHost,config.qemu.qmpPort,config.qemu.qmpConnectTimeoutMs);
await qmp.execute('quit');
console.log('QEMU quit requested through QMP');
"

node --input-type=module -e "
import net from 'node:net';
import { config } from './src/config.js';
const ports=[config.qemu.qmpPort, config.qemu.serialLogTcpPort, config.qemu.serialCommandTcpPort, config.winRm.hostPort];
await Promise.all(ports.map((port) => new Promise((resolve) => {
    const socket = net.connect({host:'127.0.0.1',port}, () => {
        console.log(port+': still listening');
        socket.end();
        resolve();
    });
    socket.once('error', (error) => {
        console.log(port+': '+error.code);
        resolve();
    });
    socket.setTimeout(2000, () => {
        console.log(port + ': timeout');
        socket.destroy();
        resolve();
    });
})));
"

echo "DONE"
exit 0

node -e "
import('./src/lib/connect-qmp.js').then(async ({connectQmp}) => {
  const qmp = await connectQmp('127.0.0.1', 4000, 5000);
  await qmp.execute('quit', undefined);
  qmp.disconnect();
  console.log('quit sent');
});
"

sleep 2

timeout 2 bash -c "echo | nc 127.0.0.1 4000" 2>&1; echo "qmp reachable after quit? exit=$?"
