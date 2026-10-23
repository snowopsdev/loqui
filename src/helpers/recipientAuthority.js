const { randomUUID } = require("node:crypto");

// Main-only authority for reviewed non-secret request configurations. Callers
// canonicalize config, capture credentials, then validate again after all waits.
function createRecipientAuthority({ now = Date.now, ttlMs = 300000, limit = 512 } = {}) {
  const entries = new Map();
  const owners = new Map();
  const prune = () => {
    for (const [token, entry] of entries) if (entry.expiresAt <= now()) entries.delete(token);
  };
  return {
    issue(sender, config, credential) {
      prune();
      if (
        sender.isDestroyed() ||
        !credential ||
        credential.unknown ||
        !Number.isSafeInteger(credential.generation)
      )
        throw new Error("Recipient unavailable. Review the destination again.");
      if (!owners.has(sender)) {
        const destroyed = () => {
          owners.delete(sender);
          for (const [token, entry] of entries) if (entry.sender === sender) entries.delete(token);
        };
        owners.set(sender, destroyed);
        sender.once("destroyed", destroyed);
      }
      while (entries.size >= limit) entries.delete(entries.keys().next().value);
      const token = randomUUID();
      entries.set(token, {
        sender,
        config: JSON.stringify(config),
        id: credential.id,
        present: credential.present,
        generation: credential.generation,
        expiresAt: now() + ttlMs,
      });
      return token;
    },
    validate(token, sender, config, credential) {
      prune();
      const entry = entries.get(token);
      if (
        !entry ||
        sender.isDestroyed() ||
        entry.sender !== sender ||
        entry.config !== JSON.stringify(config) ||
        !credential ||
        credential.unknown ||
        entry.id !== credential.id ||
        entry.present !== credential.present ||
        entry.generation !== credential.generation
      ) {
        throw Object.assign(new Error("Recipient changed. Review the destination and try again."), {
          code: "RECIPIENT_CHANGED",
        });
      }
    },
    dispose() {
      entries.clear();
      for (const [sender, listener] of owners) sender.removeListener("destroyed", listener);
      owners.clear();
    },
  };
}
module.exports = { createRecipientAuthority };
