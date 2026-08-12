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

