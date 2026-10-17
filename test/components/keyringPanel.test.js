const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");
const { resolveTokens } = require("../helpers/harness/cssTokens");
const Module = require("node:module");
const { EventEmitter } = require("node:events");

// R2-6's fake transport. Main's cortiAuth.js sends Corti's token request
// through Electron's net.fetch; this stub records the URL it reaches.
const transportUrls = [];
const originalLoad = Module._load;
Module._load = function loadWithNetStub(request, parent, isMain) {
  if (request === "electron") {
    return {
      net: {
        fetch: async (url) => {
          transportUrls.push(String(url));
          return {
            ok: true,
            status: 200,
            json: async () => ({ access_token: "tok", expires_in: 300 }),
          };
        },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
test.after(() => {
  Module._load = originalLoad;
});
const { fakeCredentialEnv, fakeCodexFs } = require("../helpers/harness/fakeCredentialEnv");
const { createCredentialAuthority } = require("../../src/helpers/credentialAuthority.js");
const { createKeyring } = require("../../src/helpers/keyring.js");
const { getCortiToken } = require("../../src/helpers/cortiAuth.js");

// Main's real authority and keyring behind the keyring-* IPC surface. The
// transport is the real getCortiToken (the request URL builder Verify uses).
function mainKeyring(initial, { runTest, environment = {}, isSealed = () => false } = {}) {
  const env = fakeCredentialEnv(initial);
  const credentialListeners = new Set();
  const listeners = new Set();
  const credentials = createCredentialAuthority({
    env,
    fs: fakeCodexFs(),
    codexHome: "/profile/codex",
    setTimer: () => {},
    broadcast: (_channel, change) => credentialListeners.forEach((cb) => cb(change)),
  });
  const rows = new Map();
  const calls = [];
  const keyring = createKeyring({
    store: {
      all: () => [...rows.values()],
      save: (row) => rows.set(row.identity, { ...row }),
      remove: (id) => rows.delete(id),
    },
    credentials,
    environment: () => environment,
    isSealed,
    broadcast: (_channel, change) => listeners.forEach((cb) => cb(change)),
    runTest: async (config, captured) => {
      calls.push({ ...config });
      if (runTest) return runTest(config, captured);
      if (config.provider === "corti" && config.scope === "transcription")
        await getCortiToken({ ...config, ...captured });
      return { success: true };
    },
  });
  const sender = new EventEmitter();
  sender.isDestroyed = () => false;
  return {
    env,
    credentials,
    calls,
    dispose: () => keyring.dispose(),
    credentialApi: {
      list: async () => credentials.list(),
      save: (...args) => credentials.save(...args),
      remove: (id) => credentials.remove(id),
      undoRemove: (token) => credentials.undoRemove(token),
      onChanged: (cb) => {
        credentialListeners.add(cb);
        return () => credentialListeners.delete(cb);
      },
    },
    list: async (options) => keyring.list(options),
    verify: (id, options) => keyring.verify(id, options, sender),
    describeVerify: (id, options) => keyring.describeVerify(id, options, sender),
    setReminder: async (id, enabled) => keyring.setReminder(id, enabled),
    onChanged: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

const tr = (key, options) => (options ? `${key}${JSON.stringify(options)}` : key);
// Task 11's KeyringEntry: keyed by KeyringIdentity, with the provider id for display.
const entry = (id, o = {}) => ({
  id,
  providerId: id.startsWith("corti:") ? "corti" : id,
  status: "unverified",
  lastVerifiedAt: null,
  lastErrorCode: null,
  lastErrorStatus: null,
  reminderDueAt: null,
  ...o,
});
const RECORDED = { outcome: "recorded", entry: null };
const defer = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () =>
  React.act(async () => {
    await new Promise((r) => setImmediate(r));
  });
function find(node, predicate) {
  if (Array.isArray(node)) return node.map((item) => find(item, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}

function fakeKeyring(initial) {
  let rows = initial;
  const listeners = new Set();
  const api = {
    calls: { list: 0, verify: [], options: [], setReminder: [] },
    listeners,
    set: (next) => {
      rows = next;
    },
    emit: (id = "openai") => {
      for (const listener of [...listeners]) listener({ id });
    },
    list: async () => {
      api.calls.list++;
      return rows.map((r) => ({ ...r }));
    },
    describeVerify: async (id, options) => ({
      hosts: [
        id === "corti:speech"
          ? `auth.${options?.cortiEnvironment ?? "us"}.corti.app`
          : `verify.${id}.example`,
      ],
      fields: id === "corti:speech" ? ["clientId", "clientSecret"] : ["key"],
      recipientToken: `reviewed-${id}`,
    }),
    verify: (id, options) => {
      api.calls.verify.push(id);
      api.calls.options.push(options);
      return api.verifyImpl(id, options);
    },
    verifyImpl: async () => RECORDED,
    setReminder: async (id, enabled) => {
      api.calls.setReminder.push([id, enabled]);
      rows = rows.map((r) => (r.id === id ? { ...r, reminderDueAt: enabled ? 1 : null } : r));
      return rows.find((r) => r.id === id) ?? null;
    },
    onChanged: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return api;
}

test("[change-driving] keyring panel", async (t) => {
  installBrowserGlobals(t, { window: { dispatchEvent() {} } });
  installHookDom(t);
  const vite = await createRendererServer(
    t,
    withI18nMock({ cachePrefix: "loqui-keyring-panel-test-" }, { withOptions: true })
  );
  const k = await vite.ssrLoadModule("/components/settings/routing/KeyringPanel.tsx");
  const section = await vite.ssrLoadModule("/components/settings/routing/RoutingSection.tsx");

  function mountController(st, deps) {
    let latest;
    function Probe() {
      latest = k.useKeyringController(deps());
      return null;
    }
    const root = createRoot(globalThis.document.documentElement);
    let mounted = true;
    const unmount = async () => {
      if (mounted) {
        mounted = false;
        await React.act(async () => root.unmount());
      }
    };
    st.after(unmount);
    return {
      current: () => latest,
      unmount,
      render: () => React.act(async () => root.render(React.createElement(Probe))),
    };
  }
  const deps =
    (api, over = {}) =>
    () => ({
      api,
      flush: async () => {},
      getSealed: () => false,
      ...over, // verifyOptions is optional; omitted by default
    });

  await t.test(
    "change-driving: keyring identities: Corti's text key and speech client pair are two rows with distinct labels",
    () => {
      // change-driving: the panel does not exist yet.
      assert.equal(k.keyringIdentityLabel(entry("groq"), tr), "Groq");
      assert.equal(
        k.keyringIdentityLabel(entry("corti:text"), tr),
        'keyring.identity.cortiText{"provider":"Corti"}'
      );
      assert.equal(
        k.keyringIdentityLabel(entry("corti:speech"), tr),
        'keyring.identity.cortiSpeech{"provider":"Corti"}'
      );
      // R2-6: the target text is main's disclosure, verbatim; there is no renderer host map.
      assert.deepEqual(
        k.verifyTargetText(
          { hosts: ["auth.eu.corti.app"], fields: ["clientId", "clientSecret"] },
          tr
        ),
        {
          host: "auth.eu.corti.app",
          fields: "keyring.fields.clientId, keyring.fields.clientSecret",
        }
      );
      assert.deepEqual(k.verifyTargetText({ hosts: [], fields: ["key"] }, tr), {
        host: null,
        fields: "keyring.fields.key",
      });
      assert.deepEqual(k.verifyTargetText(null, tr), { host: null, fields: "" });
    }
  );

  await t.test(
    "change-driving: keyring verify options: only Corti speech carries the region and tenant from settings",
    () => {
      // change-driving: Task 11's testConfigFor reads options for corti:speech only.
      const settings = { cortiEnvironment: "eu", cortiTenant: "acme" };
      assert.deepEqual(k.keyringVerifyOptions("corti:speech", settings), {
        cortiEnvironment: "eu",
        cortiTenant: "acme",
      });
      assert.equal(k.keyringVerifyOptions("corti:text", settings), undefined);
      assert.equal(k.keyringVerifyOptions("groq", settings), undefined);
    }
  );

  await t.test(
    "change-driving: keyring paused tasks are the routes that need a key and use that credential identity",
    () => {
      // change-driving.
      const routes = [
        {
          id: "chat",
          kind: "text",
          providerId: "groq",
          state: { status: "needsKey", provider: "Groq" },
        },
        {
          id: "dictationStt",
          kind: "speech",
          providerId: "corti",
          state: { status: "needsKey", provider: "Corti" },
        },
        { id: "noteFormatting", kind: "text", providerId: "corti", state: { status: "ready" } },
        {
          id: "translation",
          kind: "text",
          providerId: "corti",
          state: { status: "needsKey", provider: "Corti" },
        },
        {
          id: "uploadStt",
          kind: "speech",
          providerId: "custom",
          state: { status: "needsKey", provider: "Custom endpoint" },
        },
      ];
      assert.deepEqual(k.pausedTasksByCredential(routes), {
        groq: ["chat"],
        "corti:speech": ["dictationStt"],
        "corti:text": ["translation"],
      });
    }
  );

  await t.test(
    "change-driving: keyring status lines say when, what failed and what it breaks",
    () => {
      // change-driving.
      assert.deepEqual(k.keyringStatusLine(entry("groq"), [], tr, "en", "api.groq.com"), {
        text: "keyring.never",
        tone: "muted",
      });
      const rejected = k.keyringStatusLine(
        entry("groq", {
          status: "rejected",
          lastVerifiedAt: Date.now() - 120000,
          lastErrorCode: "credentialsRejected",
          lastErrorStatus: 401,
        }),
        ["Chat"],
        tr,
        "en",
        "api.groq.com"
      );
      assert.equal(rejected.tone, "error");
      assert.match(rejected.text, /keyring\.rejected\{"status":401\}/);
      assert.match(rejected.text, /keyring\.paused\{"tasks":"Chat"\}/);
      assert.match(rejected.text, /keyring\.lastVerified.*minutesAgo/);
      const unreachable = k.keyringStatusLine(
        entry("groq", { status: "unreachable", lastVerifiedAt: Date.now() }),
        [],
        tr,
        "en",
        "api.groq.com"
      );
      assert.match(unreachable.text, /keyring\.unreachable\{"host":"api\.groq\.com"\}/);
      assert.match(
        k.keyringStatusLine(
          entry("mistral", { status: "unreachable", lastVerifiedAt: Date.now() }),
          [],
          tr,
          "en",
          null
        ).text,
        /keyring\.unreachableNoHost/
      );
      assert.match(
        k.keyringStatusLine(
          entry("groq", { status: "rejected", lastVerifiedAt: Date.now() }),
          [],
          tr,
          "en",
          null
        ).text,
        /keyring\.rejectedNoStatus/
      );
    }
  );

  await t.test(
    "change-driving: keyring controller lists on mount and never verifies: list refreshes and changes send nothing",
    async (st) => {
      // change-driving (rule 1: no verification without a button press).
      const api = fakeKeyring([entry("openai"), entry("corti:text"), entry("corti:speech")]);
      const c = mountController(st, deps(api));
      await c.render();
      await tick();
      assert.deepEqual(
        c.current().entries.map((e) => e.id),
        ["openai", "corti:text", "corti:speech"]
      );
      api.set([entry("openai", { status: "verified", lastVerifiedAt: 5 })]);
      await React.act(async () => api.emit());
      await tick();
      assert.equal(api.calls.list, 2);
      assert.deepEqual(
        c.current().entries.map((e) => e.status),
        ["verified"]
      );
      assert.deepEqual(api.calls.verify, [], "nothing verified");
      await c.unmount();
      assert.equal(api.listeners.size, 0, "the change subscription is released");
    }
  );

  await t.test(
    "change-driving: keyring overlapping list requests: the latest request wins even when an older one answers last",
    async (st) => {
      // change-driving.
      const pending = [];
      const api = fakeKeyring([]);
      api.list = () => {
        const d = defer();
        pending.push(d);
        return d.promise;
      };
      const c = mountController(st, deps(api));
      await c.render();
      await React.act(async () => api.emit());
      await tick();
      assert.equal(pending.length, 2);
      await React.act(async () => pending[1].resolve([entry("groq", { status: "verified" })]));
      await tick();
      await React.act(async () => pending[0].resolve([entry("groq", { status: "rejected" })]));
      await tick();
      assert.deepEqual(
        c.current().entries.map((e) => e.status),
        ["verified"]
      );
    }
  );

  await t.test(
    "change-driving: keyring: a failed refresh keeps the rows we already have and flags the error",
    async (st) => {
      // change-driving (retain last-known values).
      const api = fakeKeyring([entry("groq", { status: "verified", lastVerifiedAt: 5 })]);
      const c = mountController(st, deps(api));
      await c.render();
      await tick();
      api.list = async () => {
        throw new Error("ipc down");
      };
      await React.act(async () => api.emit());
      await tick();
      assert.equal(c.current().entries.length, 1);
      assert.equal(c.current().loadError, true);
      // FIX1 baseline guard: invalidating empty-read authority must preserve historical identities neutrally.
      assert.equal(c.current().loaded, false);
      assert.equal(c.current().entries[0].id, "groq");
      assert.equal(c.current().entries[0].unknown, true);
      assert.equal(c.current().entries[0].status, "unverified");
      assert.equal(c.current().entries[0].lastVerifiedAt, null);
    }
  );

  await t.test(
    "change-driving: keyring I11: Verify waits for pending key saves before the request goes out",
    async (st) => {
      // change-driving.
      const api = fakeKeyring([entry("groq")]);
      const gate = defer();
      const c = mountController(st, deps(api, { flush: () => gate.promise }));
      await c.render();
      await tick();
      await React.act(async () => {
        void c.current().verify("groq");
      });
      await tick();
      assert.equal(c.current().checking, "groq");
      assert.deepEqual(api.calls.verify, [], "not yet: a key save is still pending");
      gate.resolve();
      await tick();
      assert.deepEqual(api.calls.verify, ["groq"]);
      assert.equal(c.current().checking, null);
    }
  );

  await t.test(
    "change-driving: keyring I11: a verdict for a key that changed mid-check never paints the replacement",
    async (st) => {
      // change-driving: v1 wrote the verify result straight into the row.
      const api = fakeKeyring([entry("groq", { status: "verified", lastVerifiedAt: 1000 })]);
      const gate = defer();
      api.verifyImpl = () => gate.promise;
      const c = mountController(st, deps(api));
      await c.render();
      await tick();
      await React.act(async () => {
        void c.current().verify("groq");
      });
      await tick();
      api.set([entry("groq")]); // main replaced the key and marked it unverified
      await React.act(async () => api.emit());
      await tick();
      assert.equal(c.current().entries[0].status, "unverified");
      gate.resolve({ outcome: "superseded", entry: entry("groq") });
      await tick();
      assert.equal(c.current().checking, null);
      assert.equal(c.current().entries[0].status, "unverified", "the stale 401 is not shown");
      assert.deepEqual(c.current().notices.groq, { kind: "superseded" });
    }
  );

  await t.test(
    "change-driving: keyring I11: the entry inside a verify result never overwrites the listed row",
    async (st) => {
      // change-driving: v1 painted the row from the verify result.
      const api = fakeKeyring([entry("groq")]);
      api.verifyImpl = async () => {
        api.set([entry("groq", { status: "verified", lastVerifiedAt: 9 })]); // the authoritative state main holds
        return {
          outcome: "recorded",
          entry: entry("groq", { status: "rejected", lastErrorStatus: 401 }),
        };
      };
      const c = mountController(st, deps(api));
      await c.render();
      await tick();
      await React.act(async () => {
        await c.current().verify("groq");
      });
      assert.equal(c.current().entries[0].status, "verified");
      assert.equal(c.current().notices.groq, undefined);
    }
  );

  await t.test(
    "change-driving: keyring: a failed verification names the error and releases the row",
    async (st) => {
      // change-driving.
      const api = fakeKeyring([entry("groq")]);
      api.verifyImpl = async () => {
        throw new Error("offline");
      };
      const c = mountController(st, deps(api));
      await c.render();
      await tick();
      await React.act(async () => {
        await c.current().verify("groq");
      });
      assert.deepEqual(c.current().notices.groq, { kind: "failed" });
      assert.equal(c.current().checking, null);
    }
  );

  await t.test(
    "change-driving: keyring: Corti speech Verify passes the region and tenant; other identities send no options",
    async (st) => {
      // change-driving: without options main tests the US/base Corti tenant, not the one the user configured.
      const api = fakeKeyring([entry("groq"), entry("corti:speech")]);
      const settings = { cortiEnvironment: "eu", cortiTenant: "acme" };
      const c = mountController(
        st,
        deps(api, { verifyOptions: (id) => k.keyringVerifyOptions(id, settings) })
      );
      await c.render();
      await tick();
      await React.act(async () => {
        await c.current().verify("corti:speech");
      });
      await React.act(async () => {
        await c.current().verify("groq");
      });
      assert.deepEqual(api.calls.verify, ["corti:speech", "groq"]);
      assert.deepEqual(api.calls.options, [
        { cortiEnvironment: "eu", cortiTenant: "acme", recipientToken: "reviewed-corti:speech" },
        { recipientToken: "reviewed-groq" },
      ]);
    }
  );

  await t.test(
    "change-driving: keyring: invalidOptions names the Corti region and tenant main refused",
    async (st) => {
      // change-driving.
      const api = fakeKeyring([entry("corti:speech")]);
      api.verifyImpl = async () => ({ outcome: "invalidOptions", entry: entry("corti:speech") });
      const c = mountController(
        st,
        deps(api, { verifyOptions: () => ({ cortiEnvironment: "mars", cortiTenant: "base" }) })
      );
      await c.render();
      await tick();
      await React.act(async () => {
        await c.current().verify("corti:speech");
      });
      assert.deepEqual(c.current().notices["corti:speech"], {
        kind: "invalidOptions",
        environment: "mars",
        tenant: "base",
      });
    }
  );

  await t.test(
    "change-driving: keyring: a Verify answered missing adds no notice and the row disappears after the refresh",
    async (st) => {
      // change-driving.
      const api = fakeKeyring([entry("groq"), entry("openai")]);
      api.verifyImpl = async () => {
        api.set([entry("openai")]); // removed in another window before main ran the check
        return { outcome: "missing", entry: null };
      };
      const c = mountController(st, deps(api));
      await c.render();
      await tick();
      await React.act(async () => {
        await c.current().verify("groq");
      });
      assert.deepEqual(
        c.current().entries.map((e) => e.id),
        ["openai"]
      );
      assert.deepEqual(c.current().notices, {});
    }
  );

  await t.test(
    "change-driving: keyring: main answering sealed shows the sealed notice and ends a Verify all run",
    async (st) => {
      // change-driving: main's sealed state (Plan 07) can refuse even when the renderer has not seen it yet.
      const api = fakeKeyring([entry("openai"), entry("groq")]);
      api.verifyImpl = async (id) => ({ outcome: "sealed", entry: entry(id) });
      const c = mountController(st, deps(api));
      await c.render();
      await tick();
      await React.act(async () => {
        await c.current().verifyAll();
      });
      assert.deepEqual(api.calls.verify, ["openai"], "the run stops at the first sealed refusal");
      assert.deepEqual(c.current().notices.openai, { kind: "sealed" });
      assert.equal(c.current().progress, null);
    }
  );

  await t.test(
    "change-driving: keyring Verify all is sequential, flushes saves first and stops when sealed mode turns on between requests (I14)",
    async (st) => {
      // change-driving.
      const api = fakeKeyring([entry("openai"), entry("groq"), entry("deepgram")]);
      const gates = [];
      api.verifyImpl = () => {
        const g = defer();
        gates.push(g);
        return g.promise;
      };
      let sealed = false;
      const flushedAfter = [];
      const c = mountController(
        st,
        deps(api, {
          flush: async () => {
            flushedAfter.push(api.calls.verify.length);
          },
          getSealed: () => sealed,
        })
      );
      await c.render();
      await tick();
      await React.act(async () => {
        void c.current().verifyAll();
      });
      await tick();
      assert.deepEqual(api.calls.verify, ["openai"]);
      assert.deepEqual(c.current().progress, { current: 1, total: 3 });
      assert.deepEqual(flushedAfter, [0], "pending saves were flushed before the first request");
      await React.act(async () => {
        void c.current().verify("groq");
      });
      assert.deepEqual(
        api.calls.verify,
        ["openai"],
        "a second verification cannot start while one is running"
      );
      gates[0].resolve(RECORDED);
      await tick();
      assert.deepEqual(api.calls.verify, ["openai", "groq"]);
      sealed = true;
      gates[1].resolve(RECORDED);
      await tick();
      assert.deepEqual(
        api.calls.verify,
        ["openai", "groq"],
        "the run stops instead of sending the third credential"
      );
      assert.equal(c.current().progress, null);
      assert.equal(c.current().checking, null);
    }
  );

  await t.test(
    "change-driving: keyring Verify all skips a credential that was removed while the run was in progress",
    async (st) => {
      // change-driving.
      const api = fakeKeyring([entry("openai"), entry("groq"), entry("deepgram")]);
      const gates = [];
      api.verifyImpl = () => {
        const g = defer();
        gates.push(g);
        return g.promise;
      };
      const c = mountController(st, deps(api));
      await c.render();
      await tick();
      await React.act(async () => {
        void c.current().verifyAll();
      });
      await tick();
      api.set([entry("openai"), entry("deepgram")]); // groq was removed in another window
      gates[0].resolve(RECORDED);
      await tick();
      assert.deepEqual(
        api.calls.verify,
        ["openai", "deepgram"],
        "the removed credential is never sent"
      );
      gates[1].resolve(RECORDED);
      await tick();
      assert.equal(c.current().progress, null);
    }
  );

  await t.test("change-driving: keyring: a single Verify is refused while sealed", async (st) => {
    // change-driving.
    const api = fakeKeyring([entry("groq")]);
    const c = mountController(st, deps(api, { getSealed: () => true }));
    await c.render();
    await tick();
    await React.act(async () => {
      await c.current().verify("groq");
    });
    assert.deepEqual(api.calls.verify, []);
  });

  await t.test(
    "change-driving: keyring: the reminder switch asks main, then the row comes back from the list",
    async (st) => {
      // change-driving.
      const api = fakeKeyring([entry("groq")]);
      const c = mountController(st, deps(api));
      await c.render();
      await tick();
      await React.act(async () => {
        await c.current().setReminder("groq", true);
      });
      assert.deepEqual(api.calls.setReminder, [["groq", true]]);
      assert.equal(c.current().entries[0].reminderDueAt, 1);
    }
  );

  const viewProps = (over = {}) => ({
    entries: [],
    paused: {},
    notices: {},
    disclosureOf: (e) =>
      e.id === "groq"
        ? { hosts: ["api.groq.com"], fields: ["key"], recipientToken: "reviewed-groq" }
        : null,
    checking: null,
    progress: null,
    sealed: false,
    loadError: false,
    onVerify() {},
    onVerifyAll() {},
    onReminder() {},
    ...over,
  });
  const rows = (html) => html.split("<li ").slice(1);

  await t.test(
    "change-driving: keyring rows expose status in words, a named reminder switch and an explicit Verify that names credential and host",
    () => {
      // change-driving.
      const html = renderToStaticMarkup(
        React.createElement(
          k.KeyringPanelView,
          viewProps({
            entries: [
              entry("groq", {
                status: "rejected",
                lastErrorCode: "credentialsRejected",
                lastErrorStatus: 401,
                lastVerifiedAt: Date.now(),
              }),
              entry("openai"),
              entry("corti:text"),
              entry("corti:speech"),
            ],
            paused: { groq: ["Chat"] },
            checking: "openai",
            progress: { current: 2, total: 4 },
          })
        )
      );
      const [groq, openai, cortiText, cortiSpeech] = rows(html);
      assert.match(groq, /role="img"[^>]*aria-label="keyring\.status\.rejected"/);
      assert.match(
        groq,
        /aria-label="keyring\.remindLabel\{&quot;identity&quot;:&quot;Groq&quot;\}"/
      );
      assert.match(
        groq,
        /title="keyring\.verifyTooltip\{&quot;identity&quot;:&quot;Groq&quot;,&quot;host&quot;:&quot;api\.groq\.com&quot;,&quot;fields&quot;:&quot;keyring\.fields\.key&quot;\}"/
      );
      assert.match(groq, /data-verify-target="api\.groq\.com"/);
      assert.match(openai, /keyring\.verifyTargetUnknown/);
      assert.match(
        groq,
        /aria-label="keyring\.verifyLabel\{&quot;identity&quot;:&quot;Groq&quot;\}"/
      );
      assert.match(openai, /data-checking="true"/);
      assert.match(openai, /aria-label="keyring\.checking"/);
      assert.match(
        openai,
        /title="keyring\.verifyTooltipNoHost\{/,
        "no known host: the tooltip still names the credential"
      );
      assert.match(cortiText, /data-credential="corti:text"/);
      assert.match(cortiText, /keyring\.identity\.cortiText/);
      assert.match(cortiSpeech, /data-credential="corti:speech"/);
      assert.match(cortiSpeech, /keyring\.identity\.cortiSpeech/);
      assert.match(html, /keyring\.verifyingAll\{&quot;current&quot;:2,&quot;total&quot;:4\}/);
      assert.match(html, /title="keyring\.verifyAllTooltip"/);
    }
  );

  await t.test(
    "change-driving: keyring I13: dots use locality tokens and destructive, never the warning amber",
    () => {
      // change-driving: v1 used bg-warning for unverified and unreachable.
      assert.deepEqual(k.STATUS_DOT, {
        verified: "bg-locality-device",
        unverified: "bg-locality-remote",
        unreachable: "bg-locality-remote",
        rejected: "bg-destructive",
      });
      const html = renderToStaticMarkup(
        React.createElement(
          k.KeyringPanelView,
          viewProps({
            entries: ["verified", "unverified", "unreachable", "rejected"].map((status, i) =>
              entry(["openai", "groq", "deepgram", "gemini"][i], { status })
            ),
          })
        )
      );
      const [verified, unverified, unreachable, rejected] = rows(html);
      assert.match(verified, /rounded-full bg-locality-device/);
      assert.match(unverified, /rounded-full bg-locality-remote/);
      assert.match(unreachable, /rounded-full bg-locality-remote/);
      assert.match(rejected, /rounded-full bg-destructive/);
      assert.doesNotMatch(html, /bg-warning|text-warning/);
    }
  );

  await t.test(
    "change-driving: keyring notices render under their row; sealed mode disables verification and says why; an empty keyring says everything runs locally",
    () => {
      // change-driving.
      const withNotice = renderToStaticMarkup(
        React.createElement(
          k.KeyringPanelView,
          viewProps({
            entries: [entry("groq")],
            notices: { groq: { kind: "superseded" } },
          })
        )
      );
      assert.match(withNotice, /role="status"[^>]*>keyring\.superseded</);
      const failed = renderToStaticMarkup(
        React.createElement(
          k.KeyringPanelView,
          viewProps({
            entries: [entry("groq")],
            notices: { groq: { kind: "failed" } },
          })
        )
      );
      assert.match(failed, /keyring\.verifyFailed/);
      const invalid = renderToStaticMarkup(
        React.createElement(
          k.KeyringPanelView,
          viewProps({
            entries: [entry("corti:speech")],
            notices: {
              "corti:speech": { kind: "invalidOptions", environment: "mars", tenant: "base" },
            },
          })
        )
      );
      assert.match(
        invalid,
        /keyring\.invalidCortiOptions\{&quot;environment&quot;:&quot;mars&quot;,&quot;tenant&quot;:&quot;base&quot;\}/
      );
      const refusedSealed = renderToStaticMarkup(
        React.createElement(
          k.KeyringPanelView,
          viewProps({
            entries: [entry("groq")],
            notices: { groq: { kind: "sealed" } },
          })
        )
      );
      assert.match(refusedSealed, /role="status"[^>]*>keyring\.sealed</);
      const sealed = renderToStaticMarkup(
        React.createElement(
          k.KeyringPanelView,
          viewProps({ entries: [entry("groq")], sealed: true })
        )
      );
      assert.match(sealed, /keyring\.sealed/);
      assert.ok(
        (sealed.match(/disabled=""/g) ?? []).length >= 2,
        "Verify all and the row's Verify are disabled"
      );
      const empty = renderToStaticMarkup(React.createElement(k.KeyringPanelView, viewProps()));
      assert.match(empty, /keyring\.empty/);
      const loadFailed = renderToStaticMarkup(
        React.createElement(
          k.KeyringPanelView,
          viewProps({ entries: [entry("groq")], loadError: true })
        )
      );
      assert.match(loadFailed, /keyring\.loadFailed/);
    }
  );

  await t.test(
    "change-driving: the Routing page renders the Keyring below the Patchbay",
    async () => {
      // change-driving.
      let tree;
      const root = createRoot(globalThis.document.documentElement);
      function Probe() {
        tree = section.RoutingSection({});
        return null;
      }
      await React.act(async () => root.render(React.createElement(Probe)));
      await React.act(async () => root.unmount());
      assert.ok(find(tree, (n) => n.type === k.KeyringPanel));
    }
  );

  await t.test(
    "baseline guard: keyring I13: dots clear 3:1 and error text clears 4.5:1 on the surfaces the panel uses, in both themes",
    async () => {
      // baseline guard: measured on the shipped tokens, so a future token change that breaks the keyring fails here.
      const { contrastRatio } = await import("../../src/utils/contrast.ts");
      const css = fs.readFileSync(path.join(__dirname, "../../src/index.css"), "utf8");
      const { light, dark } = resolveTokens(css);
      for (const [name, theme] of [
        ["light", light],
        ["dark", dark],
      ]) {
        for (const dot of [
          "--color-locality-device",
          "--color-locality-remote",
          "--color-destructive",
        ]) {
          for (const surface of ["--color-background", "--color-card"]) {
            const ratio = contrastRatio(theme[dot], theme[surface]);
            assert.ok(ratio >= 3, `${name} ${dot} on ${surface} is ${ratio}:1`);
          }
        }
        for (const surface of ["--color-background", "--color-card"]) {
          const ratio = contrastRatio(theme["--color-destructive"], theme[surface]);
          assert.ok(ratio >= 4.5, `${name} destructive text on ${surface} is ${ratio}:1`);
        }
      }
    }
  );

  await t.test(
    "baseline guard: keyring panel never uses amber, success text or the grey surfaces destructive text fails on (source guard)",
    () => {
      // baseline guard once the file exists (it fails before Step 3 only because the file is missing);
      // also pins the owner rule: the panel never writes provider/model/endpoint fields.
      const source = fs.readFileSync(
        path.join(__dirname, "../../src/components/settings/routing/KeyringPanel.tsx"),
        "utf8"
      );
      assert.doesNotMatch(
        source,
        /bg-warning|text-warning|text-success|\bbg-muted(?:[/"\s]|$)|bg-secondary|bg-surface-3/
      );
      assert.doesNotMatch(source, /providerDisplayName\(/);
      assert.match(source, /getSealed/);
      assert.match(source, /flushSecretSaves/);
      assert.doesNotMatch(
        source,
        /\.setState\(|applyRoutePatch|requestRoute(Change|Patch)|setCorti(Environment|Tenant)/,
        "the keyring writes no settings"
      );
      // R2-6: no renderer-side host map, frozen or otherwise.
      assert.doesNotMatch(source, /providerHosts|routeSnapshotFromSettings|credentialHost/);
      assert.match(source, /useSettingsStore\(\(s\) => s\.cortiEnvironment\)/);
      assert.match(source, /describeVerify/);
    }
  );

  await t.test(
    "change-driving: keyring R2-6: disclosures are asked again on a list refresh, an options change and credentials-changed",
    async (st) => {
      // change-driving: v1 froze the host map at mount (useMemo with []).
      const api = fakeKeyring([entry("corti:speech")]);
      const described = [];
      api.describeVerify = async (id, options) => {
        described.push([id, options]);
        return {
          hosts: [`auth.${options.cortiEnvironment}.corti.app`],
          fields: ["clientId", "clientSecret"],
          recipientToken: "reviewed-corti",
        };
      };
      let credentialsListener = null;
      const settings = { cortiEnvironment: "eu", cortiTenant: "acme" };
      let optionsKey = "eu|acme";
      const c = mountController(st, () => ({
        api,
        flush: async () => {},
        getSealed: () => false,
        verifyOptions: (id) => k.keyringVerifyOptions(id, settings),
        optionsKey,
        onCredentialsChanged: (cb) => {
          credentialsListener = cb;
          return () => (credentialsListener = null);
        },
      }));
      await c.render();
      await tick();
      assert.deepEqual(c.current().disclosures["corti:speech"].hosts, ["auth.eu.corti.app"]);
      settings.cortiEnvironment = "us";
      optionsKey = "us|acme";
      await c.render();
      await tick();
      assert.deepEqual(
        c.current().disclosures["corti:speech"].hosts,
        ["auth.us.corti.app"],
        "re-asked after the region changed"
      );
      const before = described.length;
      await React.act(async () => credentialsListener());
      await tick();
      assert.equal(described.length, before + 1, "credentials-changed asks again");
      await React.act(async () => api.emit("corti:speech"));
      await tick();
      assert.equal(described.length, before + 2, "keyring-changed (a list refresh) asks again");
      await c.unmount();
      assert.equal(credentialsListener, null, "the credentials subscription is released");
    }
  );

  await t.test(
    "change-driving: keyring R2-6 (mounted): the host the Keyring shows is the host the request reaches, also after a region change",
    async (st) => {
      // change-driving: the panel showed api.<region>.corti.app while Verify sent the
      // client pair to auth.<region>.corti.app, and kept the mount-time region.
      const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
      await React.act(async () =>
        useSettingsStore.setState({ cortiEnvironment: "eu", cortiTenant: "acmePanel" })
      );
      const original = globalThis.window.electronAPI;
      globalThis.window.electronAPI = {
        keyring: mainKeyring({ CORTI_CLIENT_ID: "cid-panel", CORTI_CLIENT_SECRET: "csec-panel" }),
      };
      st.after(() => {
        globalThis.window.electronAPI = original;
      });
      let tree;
      function Probe() {
        tree = k.KeyringPanel();
        return null;
      }
      const root = createRoot(globalThis.document.documentElement);
      st.after(async () => React.act(async () => root.unmount()));
      await React.act(async () => root.render(React.createElement(Probe)));
      await tick();
      await tick();
      const shownHost = () => renderToStaticMarkup(tree).match(/data-verify-target="([^"]*)"/)[1];
      for (const region of ["eu", "us"]) {
        if (region === "us") {
          await React.act(async () => useSettingsStore.setState({ cortiEnvironment: "us" }));
          await tick();
          await tick();
        }
        const displayed = shownHost();
        assert.equal(displayed, `auth.${region}.corti.app`);
        const sent = transportUrls.length;
        await React.act(async () => {
          tree.props.onVerify("corti:speech");
        });
        await tick();
        await tick();
        assert.equal(transportUrls.length, sent + 1, "Verify sent one request");
        assert.equal(
          new URL(transportUrls.at(-1)).host,
          displayed,
          "the displayed host is the host the request reached"
        );
      }
    }
  );

  // change-driving: displayed recipient admission.
  await t.test(
    "change-driving: keyring R3-4: pending replacement disclosure hides the old host and refuses Verify and Verify all",
    async (st) => {
      const api = fakeKeyring([entry("corti:speech")]);
      const gate = defer();
      const settings = { cortiEnvironment: "eu", cortiTenant: "acme" };
      let optionsKey = "eu|acme";
      api.describeVerify = async (_id, options) => {
        if (options.cortiEnvironment === "us") await gate.promise;
        return {
          hosts: [`auth.${options.cortiEnvironment}.corti.app`],
          fields: ["clientId", "clientSecret"],
          recipientToken: "reviewed-corti",
        };
      };
      const c = mountController(st, () => ({
        api,
        flush: async () => {},
        getSealed: () => false,
        optionsKey,
        verifyOptions: (id) => k.keyringVerifyOptions(id, settings),
      }));
      await c.render();
      await tick();
      assert.deepEqual(c.current().disclosures["corti:speech"].hosts, ["auth.eu.corti.app"]);
      settings.cortiEnvironment = "us";
      optionsKey = "us|acme";
      await c.render();
      assert.equal(
        c.current().disclosures["corti:speech"],
        undefined,
        "old host is hidden while main describes the replacement"
      );
      await React.act(async () => {
        await c.current().verify("corti:speech");
        await c.current().verifyAll();
      });
      assert.deepEqual(
        api.calls.verify,
        [],
        "neither entry point sends without a matching displayed target"
      );
      gate.resolve();
      await tick();
      const shown = c.current().disclosures["corti:speech"].hosts[0];
      await React.act(async () => {
        await c.current().verify("corti:speech");
      });
      assert.equal(shown, `auth.${api.calls.options.at(-1).cortiEnvironment}.corti.app`);
      assert.equal(api.calls.verify.length, 1);
    }
  );

  // change-driving: displayed recipient admission.
  await t.test(
    "change-driving: keyring R3-4: a region change while saves flush cannot upgrade the captured recipient snapshot",
    async (st) => {
      const api = fakeKeyring([entry("corti:speech")]);
      const gate = defer();
      const settings = { cortiEnvironment: "eu", cortiTenant: "acme" };
      let optionsKey = "eu|acme";
      const c = mountController(st, () => ({
        api,
        flush: () => gate.promise,
        getSealed: () => false,
        optionsKey,
        verifyOptions: (id) => k.keyringVerifyOptions(id, settings),
      }));
      await c.render();
      await tick();
      await React.act(async () => {
        void c.current().verify("corti:speech");
      });
      settings.cortiEnvironment = "us";
      optionsKey = "us|acme";
      await c.render();
      await tick();
      gate.resolve();
      await tick();
      assert.deepEqual(
        api.calls.options,
        [{ cortiEnvironment: "eu", cortiTenant: "acme", recipientToken: "reviewed-corti:speech" }],
        "the click retains the reviewed immutable intent"
      );
      const shown = c.current().disclosures["corti:speech"].hosts[0];
      await React.act(async () => {
        await c.current().verify("corti:speech");
      });
      assert.equal(shown, `auth.${api.calls.options.at(-1).cortiEnvironment}.corti.app`);
    }
  ); // change-driving: real sender-bound main authority, no duplicate renderer admission reducer.
  await t.test(
    "change-driving: mounted panel retains the displayed token across actual pending save, refuses replacement, and needs a second click",
    async (st) => {
      const { useSettingsStore, subscribeCredentialChanges } = await vite.ssrLoadModule(
        "/stores/settingsStore.ts"
      );
      const main = mainKeyring({ GROQ_API_KEY: "old-fixture-secret" });
      st.after(main.dispose);
      const original = globalThis.window.electronAPI;
      const received = [];
      globalThis.window.electronAPI = {
        credentials: main.credentialApi,
        keyring: {
          ...main,
          verify: (id, options) => {
            received.push({ ...options });
            return main.verify(id, options);
          },
        },
      };
      st.after(() => {
        globalThis.window.electronAPI = original;
      });
      const stop = subscribeCredentialChanges();
      st.after(stop);
      let tree;
      function Probe() {
        tree = k.KeyringPanel();
        return null;
      }
      const root = createRoot(globalThis.document.documentElement);
      st.after(async () => React.act(async () => root.unmount()));
      await React.act(async () => root.render(React.createElement(Probe)));
      await tick();
      await tick();
      const displayed = tree.props.disclosureOf(tree.props.entries[0]).recipientToken;
      assert.ok(displayed);
      assert.deepEqual(main.calls, [], "mount/description makes no provider request");
      const gate = defer();
      main.env.persistImpl = () => gate.promise;
      let saved;
      await React.act(async () => {
        saved = useSettingsStore.getState().setGroqApiKey("new-fixture-secret");
      });
      await React.act(async () => {
        tree.props.onVerify("groq");
      });
      await tick();
      assert.deepEqual(received, [], "actual settings secret flush is still pending");
      await React.act(async () => {
        gate.resolve();
        await saved;
      });
      await tick();
      await tick();
      assert.equal(received.length, 1);
      assert.equal(
        received[0].recipientToken,
        displayed,
        "no new token obtained after the save wait"
      );
      assert.deepEqual(main.calls, [], "main rejects the old generation before transport");
      assert.equal(tree.props.notices.groq.kind, "recipientChanged");
      assert.equal(tree.props.entries[0].status, "unverified");
      await React.act(async () => {
        tree.props.onVerify("groq");
      });
      await tick();
      await tick();
      assert.equal(main.calls.length, 1, "only the new explicit reviewed click dispatches");
      assert.notEqual(received[1].recipientToken, displayed);
    }
  );

  // change-driving: actual main config fingerprints keep same-host tenant A history out of B.
  await t.test(
    "change-driving: real main same-host Corti health and reminder reads always use the current options",
    async (st) => {
      const pending = [];
      const main = mainKeyring(
        { CORTI_CLIENT_ID: "cid-race", CORTI_CLIENT_SECRET: "secret-race" },
        {
          runTest: (config) => {
            const gate = defer();
            pending.push({ gate, config });
            return gate.promise;
          },
        }
      );
      st.after(main.dispose);
      const settings = { cortiEnvironment: "eu", cortiTenant: "tenantA" };
      const c = mountController(st, () => ({
        api: main,
        flush: async () => {},
        getSealed: () => false,
        optionsKey: JSON.stringify(settings),
        verifyOptions: (id) => k.keyringVerifyOptions(id, settings),
      }));
      await c.render();
      await tick();
      let first;
      await React.act(async () => {
        first = c.current().verify("corti:speech");
      });
      await tick();
      assert.equal(pending[0].config.tenant, "tenantA");
      settings.cortiTenant = "tenantB";
      await c.render();
      await tick();
      await React.act(async () => {
        pending[0].gate.resolve({ success: false, errorCode: "credentialsRejected", status: 401 });
        await first;
      });
      await tick();
      assert.equal(
        c.current().entries[0].status,
        "unverified",
        "late A is never painted as B's rejection"
      );
      let second;
      await React.act(async () => {
        second = c.current().verify("corti:speech");
      });
      await tick();
      await React.act(async () => {
        pending[1].gate.resolve({ success: true });
        await second;
      });
      await tick();
      assert.equal(c.current().entries[0].status, "verified");
      await React.act(async () => c.current().setReminder("corti:speech", true));
      assert.equal(
        c.current().entries[0].status,
        "verified",
        "default us/base reminder return cannot replace B"
      );
      assert.ok(c.current().entries[0].reminderDueAt);
    }
  );

  // change-driving: whole-run reviewed tokens cannot be silently replaced by refreshes between rows.
  await t.test(
    "change-driving: real main Verify all retains every reviewed row binding after another credential changes",
    async (st) => {
      const gate = defer();
      const main = mainKeyring(
        { OPENAI_API_KEY: "oai-fixture", GROQ_API_KEY: "groq-fixture" },
        { runTest: () => gate.promise }
      );
      st.after(main.dispose);
      const received = [];
      const api = {
        ...main,
        verify: (id, options) => {
          received.push([id, { ...options }]);
          return main.verify(id, options);
        },
      };
      const c = mountController(
        st,
        deps(api, { onCredentialsChanged: main.credentialApi.onChanged })
      );
      await c.render();
      await tick();
      const token = c.current().disclosures.groq.recipientToken;
      let run;
      await React.act(async () => {
        run = c.current().verifyAll();
      });
      await tick();
      await React.act(async () => main.credentials.save("groq", "key", "new-groq-fixture"));
      await tick();
      await React.act(async () => {
        gate.resolve({ success: true });
        await run;
      });
      await tick();
      assert.deepEqual(
        received.map(([id]) => id),
        ["openai", "groq"]
      );
      assert.equal(received[1][1].recipientToken, token);
      assert.equal(
        main.calls.length,
        1,
        "replaced second-row key is never sent under a refreshed token"
      );
      assert.equal(c.current().notices.groq.kind, "recipientChanged");
    }
  );

  // change-driving: unknown is neither confirmed persistence nor absent, and no token means no Verify.
  await t.test(
    "change-driving: unknown rows stay neutral and disable both Verify and reminders even with stale health",
    () => {
      const html = renderToStaticMarkup(
        React.createElement(
          k.KeyringPanelView,
          viewProps({
            entries: [
              entry("groq", {
                unknown: true,
                status: "rejected",
                lastVerifiedAt: 1,
                lastErrorStatus: 401,
              }),
            ],
            disclosureOf: () => ({ hosts: ["api.groq.com"], fields: ["key"] }),
          })
        )
      );
      assert.match(html, /keyring\.unknown/);
      assert.doesNotMatch(html, /keyring\.rejected|status\.rejected|bg-destructive/);
      assert.ok((html.match(/disabled=""/g) ?? []).length >= 3);
    }
  );

  // change-driving: latest-request wins includes configuration, not just list invocation order.
  await t.test(
    "change-driving: out-of-order current-option lists and descriptions cannot replace the latest tenant",
    async (st) => {
      const api = fakeKeyring([entry("corti:speech")]);
      const lists = [],
        descriptions = [];
      api.list = (options) => {
        const gate = defer();
        lists.push({ options, gate });
        return gate.promise;
      };
      api.describeVerify = (_id, options) => {
        const gate = defer();
        descriptions.push({ options, gate });
        return gate.promise;
      };
      const settings = { cortiEnvironment: "eu", cortiTenant: "A" };
      const c = mountController(st, () => ({
        api,
        flush: async () => {},
        getSealed: () => false,
        optionsKey: JSON.stringify(settings),
        verifyOptions: (id) => k.keyringVerifyOptions(id, settings),
      }));
      await c.render();
      lists[0].gate.resolve([entry("corti:speech")]);
      await tick();
      settings.cortiTenant = "B";
      await c.render();
      await tick();
      assert.equal(c.current().disclosures["corti:speech"], undefined);
      assert.equal(lists.at(-1).options.cortiTenant, "B");
      lists.at(-1).gate.resolve([entry("corti:speech", { status: "verified" })]);
      await tick();
      descriptions.at(-1).gate.resolve({
        hosts: ["auth.eu.corti.app"],
        fields: ["clientId", "clientSecret"],
        recipientToken: "B",
      });
      await tick();
      descriptions[0].gate.resolve({
        hosts: ["stale.example"],
        fields: ["key"],
        recipientToken: "A",
      });
      await tick();
      assert.equal(c.current().disclosures["corti:speech"].recipientToken, "B");
      assert.equal(c.current().entries[0].status, "verified");
    }
  );
  // baseline guard: actual mounted configuration race through the real main authority and Corti transport.
  await t.test(
    "baseline guard: a Corti click keeps its immutable displayed region and tenant through an actual save wait",
    async (st) => {
      const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
      const main = mainKeyring({
        CORTI_CLIENT_ID: "cid-options-wait",
        CORTI_CLIENT_SECRET: "secret-options-wait",
        GROQ_API_KEY: "groq-options-wait",
      });
      st.after(main.dispose);
      const original = globalThis.window.electronAPI;
      const received = [];
      globalThis.window.electronAPI = {
        credentials: main.credentialApi,
        keyring: {
          ...main,
          verify: (id, options) => {
            received.push({ ...options });
            return main.verify(id, options);
          },
        },
      };
      st.after(() => {
        globalThis.window.electronAPI = original;
      });
      await React.act(async () =>
        useSettingsStore.setState({ cortiEnvironment: "eu", cortiTenant: "reviewedTenant" })
      );
      let tree;
      function Probe() {
        tree = k.KeyringPanel();
        return null;
      }
      const root = createRoot(globalThis.document.documentElement);
      st.after(async () => React.act(async () => root.unmount()));
      await React.act(async () => root.render(React.createElement(Probe)));
      await tick();
      await tick();
      const reviewed = tree.props.disclosureOf(
        tree.props.entries.find((e) => e.id === "corti:speech")
      );
      const count = transportUrls.length;
      const gate = defer();
      main.env.persistImpl = () => gate.promise;
      let saved;
      await React.act(async () => {
        saved = useSettingsStore.getState().setGroqApiKey("new-groq-options-wait");
      });
      await React.act(async () => {
        tree.props.onVerify("corti:speech");
      });
      await React.act(async () =>
        useSettingsStore.setState({ cortiEnvironment: "us", cortiTenant: "newTenant" })
      );
      await tick();
      assert.equal(transportUrls.length, count, "still waiting for the real store save");
      await React.act(async () => {
        gate.resolve();
        await saved;
      });
      await tick();
      await tick();
      assert.deepEqual(received[0], {
        cortiEnvironment: "eu",
        cortiTenant: "reviewedTenant",
        recipientToken: reviewed.recipientToken,
      });
      assert.equal(transportUrls.length, count + 1);
      assert.equal(new URL(transportUrls.at(-1)).host, reviewed.hosts[0]);
      assert.match(transportUrls.at(-1), /\/realms\/reviewedTenant\//);
      assert.equal(
        tree.props.entries.find((e) => e.id === "corti:speech").status,
        "unverified",
        "old intent result never paints the new current options"
      );
      assert.deepEqual(
        tree.props.disclosureOf(tree.props.entries.find((e) => e.id === "corti:speech")).hosts,
        ["auth.us.corti.app"]
      );
    }
  );

  // baseline guard: bounded refusals are notices, never a health verdict and never a retry.
  await t.test(
    "baseline guard: recipientChanged and unavailable refresh disclosure without automatic verification",
    async (st) => {
      for (const outcome of ["recipientChanged", "unavailable"]) {
        const api = fakeKeyring([entry("groq")]);
        api.verifyImpl = async () => ({ outcome, entry: entry("groq", { status: "verified" }) });
        const c = mountController(st, deps(api));
        await c.render();
        await tick();
        await React.act(async () => c.current().verify("groq"));
        assert.equal(api.calls.verify.length, 1);
        assert.equal(c.current().entries[0].status, "unverified");
        assert.equal(c.current().notices.groq.kind, outcome);
        const html = renderToStaticMarkup(
          React.createElement(
            k.KeyringPanelView,
            viewProps({ entries: c.current().entries, notices: c.current().notices })
          )
        );
        assert.match(html, new RegExp(`keyring\\.${outcome}`));
        await c.unmount();
      }
    }
  );

  // baseline guard: rendered Keyring control overrides use shared motion and actual readable surfaces.
  await t.test(
    "baseline guard: Keyring text, buttons and reminder indicators meet composited contrast in both themes",
    async () => {
      const { contrastRatio, parseHexColor } = await import("../../src/utils/contrast.ts");
      const over = (fg, alpha, bg) => {
        const a = parseHexColor(fg),
          b = parseHexColor(bg);
        return (
          "#" +
          ["r", "g", "b"]
            .map((channel) =>
              Math.round(a[channel] * alpha + b[channel] * (1 - alpha))
                .toString(16)
                .padStart(2, "0")
            )
            .join("")
        );
      };
      const css = fs.readFileSync(path.join(__dirname, "../../src/index.css"), "utf8");
      const themes = resolveTokens(css);
      const html = renderToStaticMarkup(
        React.createElement(k.KeyringPanelView, viewProps({ entries: [entry("groq")] }))
      );
      assert.match(html, /\[&amp;&gt;button\]:bg-muted-foreground!/);
      assert.match(html, /duration-\[var\(--motion-fast\)\]/);
      for (const [name, theme] of Object.entries(themes)) {
        const background = theme["--color-background"];
        const rest =
          name === "dark"
            ? over(theme["--color-surface-raised"], 0.9, background)
            : over(theme["--color-muted"], 0.7, background);
        const hover = name === "dark" ? theme["--color-surface-raised"] : theme["--color-muted"];
        for (const surface of [
          background,
          rest,
          hover,
          name === "dark" ? over("#ffffff", 0.08, background) : theme["--color-muted"],
        ]) {
          assert.ok(
            contrastRatio(theme["--color-foreground"], surface) >= 4.5,
            `${name} button text`
          );
        }
        assert.ok(
          contrastRatio(theme["--color-muted-foreground"], background) >= 4.5,
          `${name} body copy`
        );
        assert.ok(
          contrastRatio(theme["--color-muted-foreground"], background) >= 3,
          `${name} reminder track/boundary and thumb`
        );
        assert.ok(contrastRatio(theme["--color-ring"], background) >= 3, `${name} focus ring`);
      }
    }
  );

  // change-driving: a pending first list is not confirmed absence.
  await t.test(
    "change-driving: initial list loading or failure never claims no saved credentials",
    async (st) => {
      const api = fakeKeyring([]),
        gate = defer();
      api.list = () => gate.promise;
      const c = mountController(st, deps(api));
      await c.render();
      const render = () =>
        renderToStaticMarkup(
          React.createElement(
            k.KeyringPanelView,
            viewProps({
              entries: c.current().entries,
              loaded: c.current().loaded,
              loadError: c.current().loadError,
            })
          )
        );
      assert.doesNotMatch(render(), /keyring\.empty/);
      assert.match(render(), /keyring\.checking/);
      await React.act(async () => {
        gate.resolve([]);
      });
      await tick();
      assert.match(render(), /keyring\.empty/);
      await c.unmount();
    }
  );
  // change-driving: a credential event invalidates the prior verdict while fresh main metadata is pending.
  await t.test(
    "change-driving: pending metadata refresh cannot paint the prior key's rejection",
    async (st) => {
      const api = fakeKeyring([
        entry("groq", { status: "rejected", lastVerifiedAt: 10, lastErrorStatus: 401 }),
      ]);
      const c = mountController(st, deps(api));
      await c.render();
      await tick();
      assert.equal(c.current().entries[0].status, "rejected");
      const gate = defer();
      api.list = () => gate.promise;
      await React.act(async () => api.emit());
      assert.equal(c.current().entries[0].status, "unverified");
      assert.equal(c.current().entries[0].unknown, true);
      assert.equal(c.current().disclosures.groq, undefined);
      await React.act(async () => gate.resolve([entry("groq")]));
      await tick();
      assert.equal(c.current().entries[0].unknown, undefined);
      assert.equal(c.current().entries[0].status, "unverified");
    }
  );
  // change-driving: isolate the main-disclosed host inside translated RTL/LTR prose.
  await t.test(
    "change-driving: visible verification hosts use bidi isolation within translated copy",
    () => {
      const html = renderToStaticMarkup(
        React.createElement(k.KeyringPanelView, viewProps({ entries: [entry("groq")] }))
      );
      assert.match(html, /<bdi dir="ltr">api\.groq\.com<\/bdi>/);
    }
  );
  // change-driving FIX1 I1: historical [] is not current evidence after any read owner changes.
  await t.test(
    "change-driving FIX1: a previously empty list stays unknown during a pending refresh",
    async (st) => {
      for (const trigger of ["event", "options", "api"]) {
        const originalApi = fakeKeyring([]);
        let api = originalApi;
        let tenant = "reviewedA";
        const c = mountController(st, () => ({
          api,
          flush: async () => {},
          getSealed: () => false,
          optionsKey: tenant,
          verifyOptions: (id) =>
            k.keyringVerifyOptions(id, { cortiEnvironment: "eu", cortiTenant: tenant }),
        }));
        const html = () =>
          renderToStaticMarkup(
            React.createElement(
              k.KeyringPanelView,
              viewProps({
                entries: c.current().entries,
                loaded: c.current().loaded,
                loadError: c.current().loadError,
              })
            )
          );
        await c.render();
        await tick();
        assert.equal(c.current().loaded, true);
        assert.match(
          html(),
          /keyring\.empty/,
          `${trigger}: successful current empty read confirms absence`
        );
        const gate = defer();
        if (trigger === "api") api = fakeKeyring([]);
        api.list = () => gate.promise;
        if (trigger === "event") await React.act(async () => api.emit());
        else {
          if (trigger === "options") tenant = "reviewedB";
          await c.render();
        }
        assert.equal(c.current().loaded, false, `${trigger}: history is not current read validity`);
        assert.doesNotMatch(
          html(),
          /keyring\.empty/,
          `${trigger}: pending metadata cannot claim absence`
        );
        assert.match(html(), /keyring\.checking/);
        assert.deepEqual(originalApi.calls.verify, []);
        await React.act(async () => gate.resolve([]));
        await tick();
        assert.equal(c.current().loaded, true);
        assert.match(
          html(),
          /keyring\.empty/,
          `${trigger}: only the new successful read restores absence`
        );
        await c.unmount();
      }
    }
  );

  // change-driving FIX1 I1: a failed current read must not promote prior confirmed absence.
  await t.test(
    "change-driving FIX1: a previously empty list stays unavailable after a failed refresh",
    async (st) => {
      const api = fakeKeyring([]);
      const c = mountController(st, deps(api));
      const html = () =>
        renderToStaticMarkup(
          React.createElement(
            k.KeyringPanelView,
            viewProps({
              entries: c.current().entries,
              loaded: c.current().loaded,
              loadError: c.current().loadError,
            })
          )
        );
      await c.render();
      await tick();
      assert.equal(c.current().loaded, true);
      assert.match(html(), /keyring\.empty/);
      let reject;
      api.list = () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        });
      await React.act(async () => api.emit());
      await React.act(async () => reject(new Error("fixture metadata unavailable")));
      await tick();
      assert.equal(c.current().loadError, true);
      assert.equal(
        c.current().loaded,
        false,
        "failed refresh cannot leave historical [] marked current"
      );
      assert.doesNotMatch(html(), /keyring\.empty/);
      assert.match(html(), /keyring\.unavailable/);
      assert.deepEqual(api.calls.verify, [], "refresh failure does not verify automatically");
      api.list = async () => [];
      await React.act(async () => api.emit());
      await tick();
      assert.equal(c.current().loadError, false);
      assert.equal(c.current().loaded, true);
      assert.match(
        html(),
        /keyring\.empty/,
        "a later successful empty read is authoritative again"
      );
    }
  );
});
