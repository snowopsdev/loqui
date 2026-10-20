// Preload registrars (preload.js registerListener) deliver every event to every
// subscriber and dispose only the callback they returned. Fakes must do the same.
function listenerBus() {
  const listeners = new Set();
  return {
    subscribe(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    emit(...args) {
      for (const listener of [...listeners]) listener(...args);
    },
    size: () => listeners.size,
  };
}

module.exports = { listenerBus };
