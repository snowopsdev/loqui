// Retire the owned listener before terminating its remaining connections, and
// keep test teardown pending until Node's close callback reports completion.
function registerHttpServerCleanup(t, server) {
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  });
}

module.exports = { registerHttpServerCleanup };
