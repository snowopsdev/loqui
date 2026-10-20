// Only for finalization-only fixtures that intentionally skip real startup.
// Production startup captures this owner before acquisition; genuine startup
// and adapter-replacement proof lives in audioManagerStreamingStartup.test.js.
function admitStreamingTransportFixture(manager) {
  manager._streamingTransport = {
    name: manager.getStreamingProviderName(),
    adapter: manager.getStreamingProvider(),
    options: Object.freeze({}),
    closed: false,
    stopPromise: null,
  };
  return manager;
}
module.exports = { admitStreamingTransportFixture };
