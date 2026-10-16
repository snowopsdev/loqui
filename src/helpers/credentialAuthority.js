const path = require("node:path");
const crypto = require("node:crypto");
const { BYOK_API_KEYS } = require("../config/secretKeys");

// Main-owned credential authority (Plan 03 Task 2). Main persists, then
// acknowledges; renderers only ever learn presence, a per-identity generation
// and an opaque undo token. Secret values leave this module only toward the
// environment manager that stores them and, through captureCommitted, toward
// main's keyring Verify (Task 11). Neither path crosses IPC.

const UNDO_MS = 8000;
const MAX_SECRET_LENGTH = 8192; // same cap as personal-inference:credential-save
const STORED_SENTINEL = "__stored__";

// The identities route facts reason about (CredentialId in src/lib/routeGraph.ts).
const CREDENTIAL_IDS = [
  "openai",
  "anthropic",
  "gemini",
  "groq",
  "xai",
  "mistral",
  "openrouter",
  "tinfoil",
  "deepgram",
  "assemblyai",
  "corti:text",
  "corti:speech",
  "codex",
  "bedrock",
  "azure",
  "vertex",
];

// Per-scope custom-endpoint keys use the personal-inference credential ref
// names (main.js credentialSlot), so one slot id means one secret everywhere.
const BYOK_CUSTOM_SLOTS = {
  "note-formatting-custom": "custom:noteFormatting",
  "translation-custom": "custom:dictationTranslation",
  "dictation-agent-custom": "custom:dictationAgent",
  "dictation-agent-vision-custom": "custom:dictationAgentVision",
  "chat-agent-custom": "custom:chatIntelligence",
};

function byokSlotId(base) {
  if (base === "corti") return "corti:text";
  return Object.hasOwn(BYOK_CUSTOM_SLOTS, base) ? BYOK_CUSTOM_SLOTS[base] : base;
}

const field = (env, get) => ({ env, get });

const SLOTS = {
  ...Object.fromEntries(
    BYOK_API_KEYS.map((k) => [byokSlotId(k.base), { fields: { key: field(k.env, k.get) } }])
  ),
  "corti:speech": {
    fields: {
      clientId: field("CORTI_CLIENT_ID", "getCortiClientId"),
      clientSecret: field("CORTI_CLIENT_SECRET", "getCortiClientSecret"),
    },
    // Speech authenticates with the client-credentials pair (_mintStoredCortiToken).
    present: (stored) => stored.clientId && stored.clientSecret,
  },
  bedrock: {
    fields: {
      accessKeyId: field("BEDROCK_ACCESS_KEY_ID", "getBedrockAccessKeyId"),
      secretAccessKey: field("BEDROCK_SECRET_ACCESS_KEY", "getBedrockSecretAccessKey"),
      sessionToken: field("BEDROCK_SESSION_TOKEN", "getBedrockSessionToken"),
    },
    // The SDK factory requires both static fields; profile auth is independent.
    present: (stored, env) =>
      !!env.getBedrockProfile() || (stored.accessKeyId && stored.secretAccessKey),
  },
  azure: { fields: { key: field("AZURE_OPENAI_API_KEY", "getAzureApiKey") } },
  vertex: {
    fields: { key: field("VERTEX_API_KEY", "getVertexApiKey") },
    // This is readiness only. It never selects the request host: the
    // persisted source does. ADC needs a project; apiKey uses the committed
    // stored value before the legacy GOOGLE_VERTEX_API_KEY fallback.
    present: (stored, env) =>
      env.getVertexAuthSource() === "apiKey"
        ? !!stored.key || Boolean(env.getLegacyVertexApiKey())
        : Boolean(env.getVertexProject().trim()),
  },
  "custom:transcription": {
    fields: { key: field("CUSTOM_TRANSCRIPTION_API_KEY", "getCustomTranscriptionKey") },
  },
  "custom:dictationCleanup": {
    fields: { key: field("CUSTOM_CLEANUP_API_KEY", "getCleanupCustomKey") },
  },
};

function slotForCredentialRef(ref) {
  if (typeof ref !== "string") return null;
  if (ref === "azure" || ref === "vertex") return { id: ref, field: "key" };
  if (ref.startsWith("custom:")) return SLOTS[ref] ? { id: ref, field: "key" } : null;
  const byok = BYOK_API_KEYS.find((k) => k.base === ref);
  return byok ? { id: byokSlotId(byok.base), field: "key" } : null;
}

// Codex keeps its sign-in in <CODEX_HOME>/auth.json (cli_auth_credentials_store
// "file", codexAppServer.js). Presence is a stat: no read, no app server, no
// release verification, no network.
function hasStoredAccount({ fs, codexHome }) {
  try {
    const stat = fs.statSync(path.join(codexHome, "auth.json"));
    return stat.isFile() && stat.size > 2;
  } catch {
    return false;
  }
}

// Thrown inside a write to stop it once a reset began; never leaves the module.
class ResetBarrier extends Error {}

function createCredentialAuthority({
  env,
  codexHome,
  fs,
  broadcast = () => {},
  now = Date.now,
  undoMs = UNDO_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms).unref?.(),
  randomToken = () => crypto.randomBytes(18).toString("base64url"),
}) {
  const generations = new Map();
  const queues = new Map();
  const undoEntries = new Map(); // token → { id, generation, values | null, expiresAt }
  const listeners = new Set();
  // Preserve the whole pre-mutation slot through native multi-file writes.
  // EnvironmentManager publishes individual values only after durable writes;
  // plaintext whole-slot mutations use one shared atomic prospective patch.
  const unknown = new Set();
  const committed = new Map(); // slot id → { [field]: value }, main memory only
  // R2-2. reset() raises the fence and moves the epoch. Work requested while
  // fenced is refused; work queued or running under an older epoch returns a
  // failure, and a running write stops before its next field.
  let epoch = 0;
  let fenced = false;

  const generation = (id) => generations.get(id) || 0;
  const bump = (id) => {
    const next = generation(id) + 1;
    generations.set(id, next);
    return next;
  };
  const liveValues = (id) =>
    Object.fromEntries(
      Object.entries(SLOTS[id].fields).map(([name, f]) => [name, env[f.get]() || ""])
    );
  // Main-only effective snapshot for migration and Verify. The persisted
  // slot key wins; only its absence allows the supported legacy SDK fallback.
  // `fieldsOf` remains stored-slot presence, so renderers never mistake the
  // fallback for a saved credential field.
  const committedValues = (id) => {
    const values = committed.get(id) || liveValues(id);
    if (id === "vertex" && !values.key) {
      const fallback = env.getLegacyVertexApiKey?.() || "";
      if (fallback) return { ...values, key: fallback };
    }
    return values;
  };
  const fieldsOf = (id) =>
    Object.fromEntries(
      Object.entries(committed.get(id) || liveValues(id)).map(([name, value]) => [name, !!value])
    );
  const present = (id) => {
    if (id === "codex") return hasStoredAccount({ fs, codexHome });
    if (!Object.hasOwn(SLOTS, id) || unknown.has(id)) return false;
    const stored = fieldsOf(id);
    return SLOTS[id].present
      ? !!SLOTS[id].present(stored, env)
      : Object.values(stored).some(Boolean);
  };
  const snapshot = (id) => ({
    id,
    present: present(id),
    generation: generation(id),
    fields: id === "codex" ? {} : fieldsOf(id),
    ...(unknown.has(id) ? { unknown: true } : {}),
  });
  const emit = (id, cause) => {
    const change = snapshot(id);
    broadcast("credentials-changed", change);
    for (const listener of listeners) {
      try {
        listener({ ...change, cause });
      } catch {}
    }
  };
  // A write succeeded: drop the pre-write snapshot first, so the broadcast
  // and every later read show the newly committed state.
  const publish = (id, cause) => {
    committed.delete(id);
    unknown.delete(id);
    const next = bump(id);
    emit(id, cause);
    return next;
  };
  // One task at a time per slot, in call order, so a replacement save can
  // never be overtaken by the save it replaces.
  const enqueue = (id, task) => {
    const run = (queues.get(id) || Promise.resolve()).then(task);
    queues.set(
      id,
      run.catch(() => {})
    );
    return run;
  };
  // A mutation of one slot. Resolves null when a reset began after it was
  // requested; `stale()` turns true from that moment.
  const mutate = (id, task) => {
    if (fenced) return Promise.resolve(null);
    const taskEpoch = epoch;
    const stale = () => taskEpoch !== epoch;
    return enqueue(id, async () => {
      if (stale()) return null; // queued before the reset: never written
      if (!unknown.has(id)) committed.set(id, liveValues(id));
      try {
        return await task(stale);
      } finally {
        if (!unknown.has(id)) committed.delete(id);
      }
    });
  };
  const invalidateUndo = (id) => {
    for (const entry of undoEntries.values()) if (entry.id === id) entry.values = null;
  };
  const persist = async (id, values, stale) => {
    if (stale()) throw new ResetBarrier();
    const patch = Object.fromEntries(
      Object.entries(values).map(([name, value]) => [SLOTS[id].fields[name].env, value])
    );
    const atomic = env.persistSecrets?.(patch, { stale });
    if (atomic) {
      await atomic;
      return;
    }
    for (const [name, value] of Object.entries(values)) {
      if (stale()) throw new ResetBarrier();
      await env.persistSecret(SLOTS[id].fields[name].env, value);
    }
  };
  // Native key files cannot be renamed atomically as a group. Restore the
  // previous whole slot on failure; if restoration fails, reread durable truth
  // and revoke every old generation/token rather than pretending unchanged.
  const persistSlot = async (id, values, stale) => {
    const previous = { ...committed.get(id) };
    try {
      await persist(id, values, stale);
    } catch (error) {
      if (stale()) throw error;
      try {
        await persist(id, previous, stale);
      } catch {
        if (stale()) throw error;
        let actual;
        try {
          actual = Object.fromEntries(
            await Promise.all(
              Object.entries(SLOTS[id].fields).map(async ([name, field]) => [
                name,
                await env.readPersistedSecret(field.env),
              ])
            )
          );
        } catch {
          actual = Object.fromEntries(Object.keys(SLOTS[id].fields).map((name) => [name, ""]));
          unknown.add(id);
          env.markCredentialUnknown?.(Object.values(SLOTS[id].fields).map((field) => field.env));
        }
        if (stale()) throw error;
        for (const [name, value] of Object.entries(actual)) {
          const key = SLOTS[id].fields[name].env;
          if (value) process.env[key] = value;
          else delete process.env[key];
        }
        committed.set(id, actual);
        invalidateUndo(id);
        bump(id);
        emit(id, "recovery");
      }
      throw error;
    }
  };
  const fail = (error) => ({ ok: false, error });
  const slotError = (id) => (id === "codex" ? "unsupported" : "unknownCredential");

  function save(id, fieldName, value) {
    if (fenced) return Promise.resolve(fail("reset"));
    if (unknown.has(id)) return Promise.resolve(fail("persistFailed"));
    if (!Object.hasOwn(SLOTS, id)) return Promise.resolve(fail(slotError(id)));
    if (!Object.hasOwn(SLOTS[id].fields, fieldName)) return Promise.resolve(fail("unknownField"));
    if (typeof value !== "string" || value.length > MAX_SECRET_LENGTH) {
      return Promise.resolve(fail("invalidValue"));
    }
    // The renderer echoes the sentinel back for an unchanged key; never store it.
    if (value === STORED_SENTINEL) return Promise.resolve({ ok: true, generation: generation(id) });
    return mutate(id, async (stale) => {
      try {
        await (env.persistSecrets ? persistSlot : persist)(
          id,
          { [fieldName]: value.trim() },
          stale
        );
      } catch {
        return stale() ? null : fail("persistFailed");
      }
      // Persisted, but a reset began meanwhile and will erase it: not a save.
      if (stale()) return null;
      return { ok: true, generation: publish(id, "save") };
    }).then((result) => result || fail("reset"));
  }

  // Removes every field of the slot (a two-field credential is removed whole)
  // and keeps the values in main memory for the Undo window.
  function remove(id) {
    if (fenced) return Promise.resolve(fail("reset"));
    if (!Object.hasOwn(SLOTS, id)) return Promise.resolve(fail(slotError(id)));
    return mutate(id, async (stale) => {
      if (unknown.has(id)) return fail("persistFailed");
      const values = {};
      for (const [name, stored] of Object.entries(committed.get(id))) {
        if (stored) values[name] = stored;
      }
      if (Object.keys(values).length === 0) return fail("notStored");
      try {
        await persistSlot(
          id,
          Object.fromEntries(Object.keys(values).map((name) => [name, ""])),
          stale
        );
      } catch {
        return stale() ? null : fail("persistFailed");
      }
      if (stale()) return null;
      const undoToken = randomToken();
      const expiresAt = now() + undoMs;
      const entry = { id, generation: generation(id) + 1, values, expiresAt };
      undoEntries.set(undoToken, entry);
      // The removed value must not outlive the Undo window in memory.
      setTimer(() => {
        entry.values = null;
      }, undoMs);
      const next = publish(id, "remove");
      return { ok: true, undoToken, expiresAt, generation: next };
    }).then((result) => result || fail("reset"));
  }

  function undoRemove(token) {
    const entry = typeof token === "string" ? undoEntries.get(token) : undefined;
    if (!entry) return Promise.resolve({ ok: false, reason: "unknown" });
    return mutate(entry.id, async (stale) => {
      if (undoEntries.get(token) !== entry) return { ok: false, reason: "unknown" };
      if (!entry.values || now() >= entry.expiresAt) {
        entry.values = null;
        return { ok: false, reason: "expired" };
      }
      if (generation(entry.id) !== entry.generation) {
        entry.values = null;
        return { ok: false, reason: "replaced" };
      }
      try {
        await persistSlot(entry.id, entry.values, stale);
      } catch {
        return stale() ? null : { ok: false, reason: "persistFailed" };
      }
      if (stale()) return null; // restored, but the reset erases it: Undo failed
      undoEntries.delete(token);
      entry.values = null;
      return { ok: true, generation: publish(entry.id, "undo") };
    }).then((result) => result || { ok: false, reason: "unknown" });
  }

  // Task 11 Verify (R2-4). Queued behind every save, removal and Undo already
  // requested for the slot, so it reads the committed value together with the
  // generation that value belongs to. Main-only: the values never cross IPC.
  function captureCommitted(id) {
    if (!Object.hasOwn(SLOTS, id) || fenced) return Promise.resolve(null);
    const taskEpoch = epoch;
    return enqueue(id, async () => {
      if (taskEpoch !== epoch || unknown.has(id)) return null;
      return { generation: generation(id), present: present(id), values: committedValues(id) };
    });
  }

  // R2-2. Reset Loqui must leave no credential behind. Fence new work and
  // move the epoch (queued work returns without writing); forget every Undo
  // value; bump every generation, which discards verifications in flight
  // (Task 11); wait for the write in flight; and only then erase.
  async function reset(erase = async () => {}) {
    // A second caller must not lower the first reset's fence in its finally.
    if (fenced) throw new Error("Credential reset already in progress");
    fenced = true;
    epoch += 1;
    for (const entry of undoEntries.values()) entry.values = null;
    undoEntries.clear();
    const ids = [...Object.keys(SLOTS), "codex"];
    for (const id of ids) bump(id);
    let failure = null;
    try {
      await Promise.allSettled([...queues.values()]);
      await erase();
    } catch (error) {
      failure = error;
    } finally {
      committed.clear();
      unknown.clear();
      fenced = false;
    }
    for (const id of ids) emit(id, "reset");
    if (failure) throw failure;
  }

  function refresh(id) {
    if (id === "codex" || Object.hasOwn(SLOTS, id)) emit(id, "refresh");
  }

  return {
    list: () => CREDENTIAL_IDS.map(snapshot),
    present,
    generation,
    save,
    remove,
    undoRemove,
    captureCommitted,
    reset,
    refresh,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

module.exports = {
  UNDO_MS,
  CREDENTIAL_IDS,
  byokSlotId,
  slotForCredentialRef,
  hasStoredAccount,
  createCredentialAuthority,
};
