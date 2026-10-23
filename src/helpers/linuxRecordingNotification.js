// Resident Linux meeting notification. Interruption alerts keep their separate,
// action-free path. Every continuation and delivered action owns one generation.
class LinuxRecordingNotification {
  constructor({ client, ElectronNotification, onStop, onOpen }) {
    Object.assign(this, { client, ElectronNotification, onStop, onOpen });
    this.generation = 0;
    this.current = null;
    this.fallback = null;
    this.queue = Promise.resolve();
    this.serviceAlive = Boolean(client);
    if (!client) return;
    client.onAction((id, key) => {
      const current = this.current;
      if (!current || current.generation !== this.generation || id !== current.id) return;
      if (key === "stop" && current.withStop) this.onStop?.(current.sessionId);
      else if (key === "default") this.onOpen?.(current.sessionId);
    });
    client.onClosed((id) => {
      if (this.current?.id === id) this.current = null;
    });
    client.onDisconnect(() => {
      if (!this.serviceAlive) return;
      this.serviceAlive = false;
      const lost = this.current;
      this.current = null;
      if (lost) void this._enqueue(() => this._postFallback(lost));
    });
  }

  _enqueue(job) {
    this.queue = this.queue.then(job, job);
    return this.queue;
  }

  show(options) {
    const generation = ++this.generation;
    return this._enqueue(async () => {
      await this._closeNow();
      if (generation !== this.generation) return;
      if (this.serviceAlive) {
        let caps;
        try {
          caps = await this.client.capabilities();
        } catch {}
        if (generation !== this.generation) return;
        if (caps && this.serviceAlive) {
          const withStop = Array.isArray(caps) && caps.includes("actions");
          let id;
          try {
            id = await this.client.notify({
              title: options.title,
              body: withStop ? options.body : options.fallbackBody,
              actions: withStop ? ["default", "", "stop", options.stopLabel] : ["default", ""],
              hints: { resident: true, urgency: 1, category: "device" },
            });
          } catch {}
          if (Number.isInteger(id) && id > 0) {
            if (generation !== this.generation || !this.serviceAlive) {
              await this._closeId(id);
            } else {
              this.current = { ...options, generation, id, withStop };
              return;
            }
          }
        }
      }
      this._postFallback({ ...options, generation });
    });
  }

  _postFallback(options) {
    const { sessionId, title, fallbackBody, generation } = options;
    if (generation !== this.generation) return;
    try {
      const notification = new this.ElectronNotification({
        title,
        body: fallbackBody,
        timeoutType: "never",
        silent: true,
      });
      const fallback = { notification, sessionId, generation };
      notification.on("click", () => {
        if (this.fallback === fallback && generation === this.generation) this.onOpen?.(sessionId);
      });
      notification.on("close", () => {
        if (this.fallback === fallback) this.fallback = null;
      });
      this.fallback = fallback;
      notification.show();
    } catch {
      this.fallback = null;
      // Delivery may be unavailable here too. Stop remains in the tray.
    }
  }

  close() {
    ++this.generation;
    return this._enqueue(() => this._closeNow());
  }

  async _closeId(id) {
    try {
      await this.client.close(id);
    } catch {}
  }

  async _closeNow() {
    const current = this.current;
    const fallback = this.fallback;
    this.current = null;
    this.fallback = null;
    try {
      fallback?.notification.close();
    } catch {}
    if (current && this.serviceAlive) await this._closeId(current.id);
  }
}

module.exports = { LinuxRecordingNotification };
