node -e '
import("./src/lib/connect-qmp.js").then(async ({ connectQmp }) => {
  const qmp = await connectQmp("127.0.0.1", 4000, 5000);
  const status = await qmp.execute("query-status");
  console.log("status:", JSON.stringify(status));
  const a = await qmp.execute("query-blockstats");
  for (const dev of a) {
    const key = dev.qdev || dev.device;
    console.log(key, "rd_ops", dev.stats.rd_operations, "wr_ops", dev.stats.wr_operations);
  }
  qmp.disconnect();
});
'
