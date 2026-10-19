const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { installBrowserGlobals, installHookDom } = require("../lib/rendererTestHarness");
const { rendererServer, noticeCapture } = require("../lib/routeTestApi");
const { deferred } = require("../helpers/harness/deferred");
const { fakeCredentialEnv, fakeCodexFs } = require("../helpers/harness/fakeCredentialEnv");
const { createCredentialAuthority } = require("../../src/helpers/credentialAuthority.js");

const SECRETS = [
  "sk-or-SECRET",
  "note-key-SECRET",
  "cid-SECRET",
  "csec-SECRET",
  "sk-oai-SECRET",
  "sk-new-SECRET",
];

function find(node, predicate) {
  if (Array.isArray(node)) return node.map((item) => find(item, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}
function textOf(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props?.children);
}
const byAction = (action) => (n) => n.type === "button" && n.props?.["data-action"] === action;
const editButton = (n) => n.type === "button" && n.props?.className?.includes("cursor-pointer");
const input = (n) => n.props?.type === "password";
const settle = () =>
  React.act(async () => {
    await new Promise((r) => setImmediate(r));
  });

// The credentials-* IPC surface over main's real authority (what Task 2's
// handlers return), recording every call and result. Tokens are recorded as
// "<token>"; a test proves they never reach a toast.
function mainCredentials(initial = {}, { now = () => Date.now() } = {}) {
  const env = fakeCredentialEnv(initial);
  const listeners = new Set();
  const authority = createCredentialAuthority({
    env,
    fs: fakeCodexFs(),
    codexHome: "/profile/codex",
    now,
    setTimer: () => {},
    broadcast: (_channel, change) => listeners.forEach((listener) => listener(change)),
  });
  const calls = [];
  const results = [];
  const tokens = [];
  const record = async (call, promise) => {
    calls.push(call);
    const result = await promise;
    results.push(result);
    if (result?.undoToken) tokens.push(result.undoToken);
    return result;
  };
  return {
    env,
    calls,
    results,
    tokens,
    api: {
      list: async () => authority.list(),
      save: (id, field, value) => record(["save", id, field], authority.save(id, field, value)),
      remove: (id) => record(["remove", id], authority.remove(id)),
      undoRemove: (token) =>
        record(
          ["undoRemove", tokens.includes(token) ? "<token>" : "?"],
          authority.undoRemove(token)
        ),
      onChanged: (callback) => {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
    },
  };
}

function assertSecretFree(surface) {
  const text = JSON.stringify(surface);
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `leaked ${secret}`);
}

test("[change-driving] api key input: undoable removal through main", async (t) => {
  installBrowserGlobals(t, { window: { electronAPI: {}, dispatchEvent() {} } });
  installHookDom(t);
  const vite = await rendererServer(t, "loqui-api-key-removal-test-", {
    mockModules: { "/services/ReasoningService": "export default { clearApiKeyCache() {} };" },
  });
  const ApiKeyInput = (await vite.ssrLoadModule("/components/ui/ApiKeyInput.tsx")).default;
  const OpenAICompatiblePanel = (await vite.ssrLoadModule("/components/OpenAICompatiblePanel.tsx"))
    .default;
  const removalModule = await vite.ssrLoadModule("/components/ui/useUndoableRemoval.ts");
  const useCredentials = (st, main) => {
    const original = globalThis.window.electronAPI;
    globalThis.window.electronAPI = { credentials: main.api };
    st.after(() => {
      globalThis.window.electronAPI = original;
    });
  };

  // Mounts the actual field/hook and observes the production module store.
  async function mount(st, render, props) {
    const capture = await noticeCapture(vite, st);
    let tree;
    let current = props;
    function Probe() {
      tree = render(current);
      return null;
    }
    const root = createRoot(globalThis.document.documentElement);
    let mounted = true;
    const unmount = async () => {
      if (!mounted) return;
      mounted = false;
      await React.act(async () => root.unmount());
    };
    st.after(unmount);
    const draw = () => React.act(async () => root.render(React.createElement(Probe)));
    await draw();
    return {
      tree: () => tree,
      notices: capture.notices,
      store: capture.store,
      unmount,
      rerender: async (next) => {
        current = { ...current, ...next };
        await draw();
      },
      click: async (predicate) => {
        const node = find(tree, predicate);
        assert.ok(node, "the control is rendered");
        await React.act(async () => {
          await node.props.onClick();
        });
      },
    };
  }
  const field = (st, props) => mount(st, ApiKeyInput, props);
  // The ApiKeyInput element a real OpenAICompatiblePanel (Task 9) renders, mounted with exactly its props.
  async function panelKeyField(st, panelProps) {
    const panel = await mount(st, OpenAICompatiblePanel, panelProps);
    const element = find(panel.tree(), (n) => n.type === ApiKeyInput);
    assert.ok(element, "the panel renders an ApiKeyInput");
    await panel.unmount();
    return { element, field: await field(st, element.props) };
  }
  const runCapturedAction = async (toast) =>
    React.act(async () => {
      await toast.actions[0].onClick();
    });

  await t.test(
    "change-driving: reversed guard (R2-5): a field without a credential identity offers no Remove, so nothing is ever erased by an empty save",
    async (st) => {
      // Before this task: Remove called setApiKey("") — a permanent delete with no Undo (ApiKeyInput.tsx:164-171).
      const main = mainCredentials({ OPENAI_API_KEY: SECRETS[4] });
      useCredentials(st, main);
      const saved = [];
      const c = await field(st, {
        apiKey: "__stored__",
        setApiKey: async (key) => (saved.push(key), { ok: true }),
      });
      assert.equal(find(c.tree(), byAction("remove-key")), undefined);
      assert.equal(
        find(
          c.tree(),
          (n) => n.type === "button" && n.props?.className?.includes("hover:text-destructive")
        ),
        undefined
      );
      assert.deepEqual(saved, []);
      assert.deepEqual(main.calls, []);
    }
  );

  await t.test(
    "change-driving: reversed guard (R2-5): without main's credentials api (browser preview) there is no Remove either",
    async (st) => {
      const saved = [];
      const c = await field(st, {
        apiKey: "__stored__",
        credentialId: "openai",
        setApiKey: async (key) => (saved.push(key), { ok: true }),
      });
      assert.equal(find(c.tree(), byAction("remove-key")), undefined);
      assert.deepEqual(saved, []);
    }
  );

  await t.test(
    "change-driving: OpenRouter (R2-5): Remove in the compatible panel removes by token, shows Undo, and Undo restores the key after the field unmounted",
    async (st) => {
      // change-driving: OpenRouter's panel passed no identity, so Remove permanently erased the key.
      const main = mainCredentials({ OPENROUTER_API_KEY: SECRETS[0] });
      useCredentials(st, main);
      const saved = [];
      const { element, field: c } = await panelKeyField(st, {
        credentialRef: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "__stored__",
        saveApiKey: async (key) => (saved.push(key), { ok: true }),
        model: "",
        onSelectModel() {},
        lockedBaseUrl: true,
        apiKeyRequired: true,
      });
      assert.equal(element.props.credentialId, "openrouter");
      await c.click(byAction("remove-key"));
      await settle();
      assert.deepEqual(main.calls, [["remove", "openrouter"]]);
      assert.deepEqual(saved, [], "removal never goes through the secret setter");
      assert.equal(main.env.values.has("OPENROUTER_API_KEY"), false);
      const [removedNotice] = c.notices;
      assert.equal(removedNotice.title, "apiKeyInput.removed");
      assert.equal(removedNotice.actions[0].label, "apiKeyInput.undo");
      assert.equal(removedNotice.actions[0].primary, true);
      assert.ok(
        removedNotice.expiresAt - removedNotice.createdAt === 7000,
        "the receipt action lives 7s; main retains its original 8s authority"
      );
      await c.unmount(); // switching provider tabs unmounts the field; the toast keeps the Undo
      await runCapturedAction(removedNotice);
      assert.deepEqual(main.calls, [
        ["remove", "openrouter"],
        ["undoRemove", "<token>"],
      ]);
      assert.equal(main.env.values.get("OPENROUTER_API_KEY"), SECRETS[0]);
      assert.equal(c.notices.at(-1).title, "apiKeyInput.restored");
      assertSecretFree({ results: main.results, notices: c.notices });
      assert.ok(
        !JSON.stringify(c.notices).includes(main.tokens[0]),
        "the undo token never reaches a toast"
      );
    }
  );

  await t.test(
    "change-driving: hydrated custom slot (R2-5): Remove reaches custom:noteFormatting, the store sentinel follows main, and Undo brings it back",
    async (st) => {
      // change-driving: custom-endpoint keys kept the permanent empty-save Remove.
      const main = mainCredentials({ NOTE_FORMATTING_CUSTOM_API_KEY: SECRETS[1] });
      useCredentials(st, main);
      const { useSettingsStore, subscribeCredentialChanges } = await vite.ssrLoadModule(
        "/stores/settingsStore.ts"
      );
      useSettingsStore.setState({ noteFormattingCustomApiKey: "__stored__" }); // hydrated from main's presence
      const stop = subscribeCredentialChanges();
      st.after(stop);
      const { element, field: c } = await panelKeyField(st, {
        credentialRef: "custom:noteFormatting",
        baseUrl: "http://localhost:1234/v1",
        apiKey: useSettingsStore.getState().noteFormattingCustomApiKey,
        saveApiKey: async () => ({ ok: true }),
        model: "",
        onSelectModel() {},
      });
      assert.equal(element.props.credentialId, "custom:noteFormatting");
      await c.click(byAction("remove-key"));
      await settle();
      assert.deepEqual(main.calls, [["remove", "custom:noteFormatting"]]);
      assert.equal(
        useSettingsStore.getState().noteFormattingCustomApiKey,
        "",
        "credentials-changed cleared the sentinel"
      );
      await runCapturedAction(c.notices[0]);
      assert.equal(useSettingsStore.getState().noteFormattingCustomApiKey, "__stored__");
      assert.equal(main.env.values.get("NOTE_FORMATTING_CUSTOM_API_KEY"), SECRETS[1]);
      assertSecretFree({
        results: main.results,
        notices: c.notices,
        store: useSettingsStore.getState(),
      });
    }
  );

  await t.test(
    "change-driving: pair removal (R2-5): Remove on either Corti speech field removes the whole client pair, and one Undo restores both",
    async (st) => {
      // change-driving: pair fields had only the per-field empty save, which left half a credential.
      const main = mainCredentials({
        CORTI_CLIENT_ID: SECRETS[2],
        CORTI_CLIENT_SECRET: SECRETS[3],
      });
      useCredentials(st, main);
      const c = await field(st, {
        apiKey: "__stored__",
        credentialId: "corti:speech",
        setApiKey: async () => ({ ok: true }),
      });
      const remove = find(c.tree(), byAction("remove-key"));
      assert.equal(
        textOf(remove),
        "apiKeyInput.removeCredential",
        "the label says the whole credential goes"
      );
      await c.click(byAction("remove-key"));
      await settle();
      assert.deepEqual(main.calls, [["remove", "corti:speech"]]);
      assert.equal(main.env.values.has("CORTI_CLIENT_ID"), false);
      assert.equal(main.env.values.has("CORTI_CLIENT_SECRET"), false);
      assert.equal(c.notices[0].title, "apiKeyInput.removedCredential");
      await runCapturedAction(c.notices[0]);
      assert.equal(main.env.values.get("CORTI_CLIENT_ID"), SECRETS[2]);
      assert.equal(main.env.values.get("CORTI_CLIENT_SECRET"), SECRETS[3]);
      assertSecretFree({ results: main.results, notices: c.notices });
    }
  );

  await t.test(
    "change-driving: a key saved after the removal wins: the toast's Undo says the newer key was kept",
    async (st) => {
      // change-driving.
      const main = mainCredentials({ OPENAI_API_KEY: SECRETS[4] });
      useCredentials(st, main);
      const c = await field(st, {
        apiKey: "__stored__",
        credentialId: "openai",
        setApiKey: (value) => main.api.save("openai", "key", value).then((r) => ({ ok: r.ok })),
      });
      await c.click(byAction("remove-key"));
      await settle();
      await c.rerender({ apiKey: "" });
      await c.click(editButton);
      await React.act(async () =>
        find(c.tree(), input).props.onChange({ target: { value: SECRETS[5] } })
      );
      await c.click(byAction("save-key"));
      await settle();
      await runCapturedAction(c.notices[0]);
      assert.equal(c.notices.at(-1).title, "apiKeyInput.undoReplaced");
      assert.equal(c.notices.at(-1).actions, undefined, "no second attempt is offered");
      assert.equal(main.env.values.get("OPENAI_API_KEY"), SECRETS[5]);
      assertSecretFree({ results: main.results, notices: c.notices });
    }
  );

  await t.test(
    "change-driving: an Undo after main's window closed says it is too late",
    async (st) => {
      // change-driving.
      let clock = Date.now();
      const main = mainCredentials({ OPENAI_API_KEY: SECRETS[4] }, { now: () => clock });
      useCredentials(st, main);
      const c = await field(st, {
        apiKey: "__stored__",
        credentialId: "openai",
        setApiKey: async () => ({ ok: true }),
      });
      await c.click(byAction("remove-key"));
      await settle();
      clock += 8_000;
      await runCapturedAction(c.notices[0]);
      assert.equal(c.notices.at(-1).title, "apiKeyInput.undoExpired");
      assert.equal(main.env.values.has("OPENAI_API_KEY"), false);
    }
  );

  await t.test(
    "change-driving: an Undo main could not persist offers Undo again for the rest of the window",
    async (st) => {
      // change-driving: main keeps the value and the token on persistFailed (Task 2).
      const main = mainCredentials({ OPENAI_API_KEY: SECRETS[4] });
      useCredentials(st, main);
      const c = await field(st, {
        apiKey: "__stored__",
        credentialId: "openai",
        setApiKey: async () => ({ ok: true }),
      });
      await c.click(byAction("remove-key"));
      await settle();
      let failOnce = true;
      main.env.persistImpl = async (_name, value) => {
        if (value && failOnce) {
          failOnce = false;
          throw new Error("locked");
        }
      };
      await runCapturedAction(c.notices[0]);
      const retry = c.notices.at(-1);
      assert.equal(retry.title, "apiKeyInput.undoRetry");
      assert.equal(retry.actions[0].label, "apiKeyInput.undo");
      await runCapturedAction(retry);
      assert.equal(main.env.values.get("OPENAI_API_KEY"), SECRETS[4]);
      assert.equal(c.notices.at(-1).title, "apiKeyInput.restored");
    }
  );

  await t.test("a retried notice never extends main's original credential expiry", async (st) => {
    let clock = 1_000_000;
    const main = mainCredentials({ OPENAI_API_KEY: SECRETS[4] }, { now: () => clock });
    useCredentials(st, main);
    let removal;
    const scheduled = new Map();
    let sequence = 0;
    const c = await mount(st, () => {
      removal = removalModule.useUndoableRemoval("openai", {
        api: main.api,
        now: () => clock,
        schedule: (fn, ms) => {
          const id = ++sequence;
          scheduled.set(id, { fn, at: clock + ms });
          return id;
        },
        cancel: (id) => scheduled.delete(id),
      });
      return null;
    });
    c.store.__setNoticeClockForTests({ now: () => clock, setTimeout: () => 1, clearTimeout() {} });
    await React.act(async () => removal.remove());
    const originalExpiry = main.results[0].expiresAt;
    const first = c.store.getNotices()[0];
    assert.equal(first.kind, "receipt");
    assert.equal(first.expiresAt - first.createdAt, 7000);
    clock += 6000;
    main.env.persistImpl = async (_name, value) => {
      if (value) throw new Error("fixture locked");
    };
    await React.act(async () => c.store.runNoticeAction(first.id, first.actions[0]));
    const retry = c.store.getNotices()[0];
    assert.equal(retry.title, "apiKeyInput.undoRetry");
    assert.equal(retry.expiresAt - retry.createdAt, 7000, "tier lifetime stays 7s");
    assert.equal(main.results[0].expiresAt, originalExpiry);
    c.store.pauseNotice(retry.id);
    clock = originalExpiry;
    await React.act(async () => {
      for (const [id, timer] of [...scheduled])
        if (timer.at <= clock) {
          scheduled.delete(id);
          timer.fn();
        }
    });
    assert.deepEqual(
      c.store.getNotices(),
      [],
      "original deadline removes even a hover-paused Retry affordance"
    );
    const before = main.calls.length;
    await React.act(async () => c.store.runNoticeAction(retry.id, retry.actions[0]));
    assert.equal(main.calls.length, before, "dismissed revision cannot activate Undo");
    await React.act(async () => retry.actions[0].onClick());
    assert.equal(c.store.getNotices().at(-1).title, "apiKeyInput.undoExpired");
    assert.equal(main.env.values.has("OPENAI_API_KEY"), false);
    assert.equal(main.tokens.length, 1, "retry never creates a new capability");
    assert.ok(!JSON.stringify(c.store.getNotices()).includes(main.tokens[0]));
    assert.ok(c.store.getNotices().every((n) => n.title !== "apiKeyInput.restored"));
  });

  await t.test(
    "change-driving: a refused removal keeps the key and shows Task 2's removeFailed alert",
    async (st) => {
      // change-driving: the credentials.remove refusal path does not exist before this task.
      const main = mainCredentials({ OPENAI_API_KEY: SECRETS[4] });
      useCredentials(st, main);
      main.env.persistImpl = async (_name, value) => {
        if (value === "") throw new Error("locked");
      };
      const c = await field(st, {
        apiKey: "__stored__",
        credentialId: "openai",
        setApiKey: async () => ({ ok: true }),
      });
      await c.click(byAction("remove-key"));
      await settle();
      assert.equal(
        textOf(find(c.tree(), (n) => n.props?.role === "alert")),
        "apiKeyInput.removeFailed"
      );
      assert.deepEqual(c.notices, []);
      assert.ok(find(c.tree(), byAction("remove-key")), "the key is still there to remove again");
      assert.equal(main.env.values.get("OPENAI_API_KEY"), SECRETS[4]);
    }
  );

  await t.test(
    "change-driving: without a provider wrapper the module store retains Removed · Undo and restores through the token",
    async (st) => {
      // The module store is available without a context provider.
      const main = mainCredentials({ OPENAI_API_KEY: SECRETS[4] });
      useCredentials(st, main);
      const c = await field(st, {
        apiKey: "__stored__",
        credentialId: "openai",
        setApiKey: async () => ({ ok: true }),
      });
      await c.click(byAction("remove-key"));
      await settle();
      assert.equal(c.notices[0].title, "apiKeyInput.removed");
      assert.ok(
        !JSON.stringify(c.notices).includes(main.tokens[0]),
        "the token stays in the action closure"
      );
      await runCapturedAction(c.notices[0]);
      await settle();
      assert.equal(main.env.values.get("OPENAI_API_KEY"), SECRETS[4]);
      assert.equal(find(c.tree(), byAction("undo-remove")), undefined);
    }
  );

  await t.test(
    "baseline guard: Remove is not offered while a key save is pending, so a late save cannot resurrect a removed key",
    async (st) => {
      // baseline guard: Task 2's editor stays open until main acknowledges the save; this task's Remove relies on that.
      const main = mainCredentials({ OPENAI_API_KEY: SECRETS[4] });
      useCredentials(st, main);
      const gate = deferred();
      const c = await field(st, {
        apiKey: "__stored__",
        credentialId: "openai",
        setApiKey: () => gate.promise,
      });
      await c.click(editButton);
      await React.act(async () =>
        find(c.tree(), input).props.onChange({ target: { value: "sk-slow" } })
      );
      await React.act(async () => {
        void find(c.tree(), byAction("save-key")).props.onClick();
      });
      assert.equal(
        find(c.tree(), byAction("remove-key")),
        undefined,
        "no Remove while main persists the key"
      );
      await React.act(async () => {
        gate.resolve({ ok: true });
        await gate.promise;
      });
      await settle();
      assert.ok(
        find(c.tree(), byAction("remove-key")),
        "Remove returns once the save is acknowledged"
      );
      assert.deepEqual(main.calls, []);
    }
  );

  await t.test(
    "change-driving: hook: the inline undo window ends after 8 seconds, clamped to what main granted",
    async (st) => {
      // change-driving (hook level, injected clock, no toast host: the inline fallback).
      const scheduled = [];
      const cancelled = [];
      let latest;
      const api = {
        async remove() {
          return { ok: true, undoToken: "tok-x", expiresAt: 9000, generation: 1 };
        },
        async undoRemove() {
          return { ok: true, generation: 2 };
        },
      };
      const root = createRoot(globalThis.document.documentElement);
      st.after(async () => React.act(async () => root.unmount()));
      function Probe() {
        latest = removalModule.useUndoableRemoval("groq", {
          api,
          notify: null,
          now: () => 1000,
          schedule: (fn, ms) => {
            scheduled.push({ fn, ms });
            return scheduled.length;
          },
          cancel: (handle) => cancelled.push(handle),
        });
        return null;
      }
      await React.act(async () => root.render(React.createElement(Probe)));
      assert.equal(latest.available, true);
      await React.act(async () => {
        await latest.remove();
      });
      assert.equal(removalModule.UNDO_WINDOW_MS, 8000);
      assert.equal(scheduled[0].ms, 8000, "expiresAt - now is exactly the window");
      assert.equal(latest.notice.kind, "removed");
      await React.act(async () => {
        scheduled[0].fn();
      });
      assert.equal(latest.notice, null, "the notice disappears when the window ends");
      await React.act(async () => {
        await latest.remove();
      });
      await React.act(async () => {
        latest.clear();
      });
      assert.ok(cancelled.length >= 1, "clear() cancels the pending expiry");
    }
  );

  await t.test(
    "change-driving: hook: undoRemoval maps main's answers, and a persistFailed after the window is too late",
    async () => {
      // change-driving (pure helper the toast action runs after the field unmounted).
      const api = (answer) => ({ undoRemove: async () => answer });
      assert.deepEqual(
        await removalModule.undoRemoval(api({ ok: true, generation: 2 }), "t", 9000, () => 1000),
        { kind: "restored" }
      );
      assert.deepEqual(
        await removalModule.undoRemoval(
          api({ ok: false, reason: "persistFailed" }),
          "t",
          9000,
          () => 5000
        ),
        { kind: "retry" }
      );
      assert.deepEqual(
        await removalModule.undoRemoval(
          api({ ok: false, reason: "persistFailed" }),
          "t",
          9000,
          () => 9500
        ),
        {
          kind: "failed",
          reason: "expired",
        }
      );
      assert.deepEqual(
        await removalModule.undoRemoval(
          api({ ok: false, reason: "replaced" }),
          "t",
          9000,
          () => 1000
        ),
        {
          kind: "failed",
          reason: "replaced",
        }
      );
      const thrown = { undoRemove: async () => Promise.reject(new Error("ipc down")) };
      assert.deepEqual(await removalModule.undoRemoval(thrown, "t", 9000, () => 1000), {
        kind: "error",
        message: "unavailable",
      });
    }
  );

  await t.test(
    "change-driving: source guard (R2-5): every ApiKeyInput passes a credential identity, and the empty-save Remove is gone",
    () => {
      // change-driving until Step 3.3 lands; a baseline guard afterwards.
      const srcRoot = path.join(__dirname, "../../src");
      const files = fs
        .globSync("**/*.tsx", { cwd: srcRoot })
        .map((file) => path.join(srcRoot, file));
      let elements = 0;
      for (const file of files) {
        const source = fs.readFileSync(file, "utf8");
        let at = source.indexOf("<ApiKeyInput");
        while (at !== -1) {
          const element = source.slice(at, source.indexOf("/>", at));
          elements++;
          assert.match(
            element,
            /credentialId=/,
            `${path.relative(srcRoot, file)}: ${element.split("\n")[0]}`
          );
          at = source.indexOf("<ApiKeyInput", at + 1);
        }
      }
      assert.ok(elements >= 15, `found ${elements} ApiKeyInput elements`);
      const apiKeyInput = fs.readFileSync(
        path.join(srcRoot, "components/ui/ApiKeyInput.tsx"),
        "utf8"
      );
      assert.doesNotMatch(
        apiKeyInput,
        /commit\(""\)|setApiKey\(""\)/,
        "no permanent empty-save Remove"
      );
      const enterprise = fs.readFileSync(
        path.join(srcRoot, "components/EnterpriseProviderConfig.tsx"),
        "utf8"
      );
      assert.equal(
        (enterprise.match(/credentialId="bedrock"/g) ?? []).length,
        3,
        "Bedrock's three fields are one credential"
      );
    }
  ); // baseline guard: real main whole-slot behavior through mounted Bedrock fields, authored after implementation.
  await t.test(
    "baseline guard: Bedrock Remove and Undo include the optional session token, keeping the profile",
    async (st) => {
      const main = mainCredentials({
        BEDROCK_ACCESS_KEY_ID: "fixture-access",
        BEDROCK_SECRET_ACCESS_KEY: "fixture-secret",
        BEDROCK_SESSION_TOKEN: "fixture-session",
        BEDROCK_PROFILE: "fixture-profile",
      });
      useCredentials(st, main);
      const c = await field(st, {
        apiKey: "__stored__",
        credentialId: "bedrock",
        setApiKey: async () => ({ ok: true }),
      });
      await c.click(byAction("remove-key"));
      for (const name of [
        "BEDROCK_ACCESS_KEY_ID",
        "BEDROCK_SECRET_ACCESS_KEY",
        "BEDROCK_SESSION_TOKEN",
      ])
        assert.equal(main.env.values.has(name), false);
      assert.equal(main.env.values.get("BEDROCK_PROFILE"), "fixture-profile");
      await c.unmount();
      await runCapturedAction(c.notices[0]);
      assert.equal(main.env.values.get("BEDROCK_ACCESS_KEY_ID"), "fixture-access");
      assert.equal(main.env.values.get("BEDROCK_SECRET_ACCESS_KEY"), "fixture-secret");
      assert.equal(main.env.values.get("BEDROCK_SESSION_TOKEN"), "fixture-session");
      assert.equal(main.env.values.get("BEDROCK_PROFILE"), "fixture-profile");
    }
  );

  // baseline guard: a toast cannot borrow a subsequently mounted field's API, slot or translations.
  await t.test(
    "baseline guard: Undo retains its removal API/identity through field and bridge replacement",
    async (st) => {
      const main = mainCredentials({ OPENAI_API_KEY: SECRETS[4] });
      useCredentials(st, main);
      const c = await field(st, {
        apiKey: "__stored__",
        credentialId: "openai",
        setApiKey: async () => ({ ok: true }),
      });
      await c.click(byAction("remove-key"));
      const toast = c.notices[0];
      await c.rerender({ credentialId: "groq" });
      let wrongApiCalls = 0;
      globalThis.window.electronAPI = {
        credentials: {
          remove() {
            wrongApiCalls++;
          },
          undoRemove() {
            wrongApiCalls++;
          },
        },
      };
      await c.unmount();
      await runCapturedAction(toast);
      await runCapturedAction(toast); // stale/double action is inert after success
      assert.equal(wrongApiCalls, 0);
      assert.equal(main.env.values.get("OPENAI_API_KEY"), SECRETS[4]);
      assert.deepEqual(main.calls, [
        ["remove", "openai"],
        ["undoRemove", "<token>"],
      ]);
    }
  );

  // baseline guard: no arbitrary secret-bearing error is placed in inline, toast or helper output.
  await t.test(
    "baseline guard: removal exceptions are bounded and preserve the configured credential",
    async (st) => {
      const api = {
        remove: async () => {
          throw new Error(SECRETS[4]);
        },
        undoRemove: async () => {
          throw new Error(SECRETS[4]);
        },
      };
      useCredentials(st, { api });
      const c = await field(st, {
        apiKey: "__stored__",
        credentialId: "openai",
        setApiKey: async () => ({ ok: true }),
      });
      await c.click(byAction("remove-key"));
      assert.equal(
        textOf(find(c.tree(), (node) => node.props?.role === "alert")),
        "apiKeyInput.removeFailed"
      );
      assertSecretFree({
        tree: textOf(c.tree()),
        notices: c.notices,
        outcome: await removalModule.undoRemoval(api, "opaque", 9000, () => 1000),
      });
    }
  );

  // baseline guard for Task2 ACK/revision ownership while adding the removal controls.
  await t.test(
    "baseline guard: refused and successful old saves preserve a newer raw draft",
    async (st) => {
      for (const ok of [false, true]) {
        const gate = deferred();
        const c = await field(st, {
          apiKey: "__stored__",
          credentialId: "openai",
          setApiKey: () => gate.promise,
        });
        await c.click(editButton);
        await React.act(async () =>
          find(c.tree(), input).props.onChange({ target: { value: "old-fixture" } })
        );
        let saving;
        await React.act(async () => {
          saving = find(c.tree(), byAction("save-key")).props.onClick();
        });
        await React.act(async () =>
          find(c.tree(), input).props.onChange({ target: { value: "newer-fixture" } })
        );
        await React.act(async () => {
          gate.resolve({ ok });
          await saving;
        });
        assert.equal(find(c.tree(), input).props.value, "newer-fixture");
        assert.equal(find(c.tree(), byAction("remove-key")), undefined);
        await c.unmount();
      }
    }
  ); // change-driving: a reused input changing slot must release the old pending editor, without old ACK ownership.
  await t.test(
    "change-driving: a pending save cannot strand or clear another credential editor",
    async (st) => {
      const gate = deferred();
      const c = await field(st, {
        apiKey: "__stored__",
        credentialId: "openai",
        setApiKey: () => gate.promise,
      });
      await c.click(editButton);
      await React.act(async () =>
        find(c.tree(), input).props.onChange({ target: { value: "old-slot-fixture" } })
      );
      let old;
      await React.act(async () => {
        old = find(c.tree(), byAction("save-key")).props.onClick();
      });
      const saved = [];
      await c.rerender({
        credentialId: "groq",
        apiKey: "",
        setApiKey: async (value) => {
          saved.push(value);
          return { ok: true };
        },
      });
      assert.equal(
        find(c.tree(), input),
        undefined,
        "another credential starts outside the old editor"
      );
      await c.click(editButton);
      await React.act(async () =>
        find(c.tree(), input).props.onChange({ target: { value: "new-slot-fixture" } })
      );
      await React.act(async () => {
        gate.resolve({ ok: true });
        await old;
      });
      assert.equal(
        find(c.tree(), input).props.value,
        "new-slot-fixture",
        "the old slot ACK cannot clear the new draft"
      );
      await c.click(byAction("save-key"));
      assert.deepEqual(saved, ["new-slot-fixture"]);
    }
  );
});

// Actual host nodes and React's delegated capture/bubble listeners. This is a
// bounded Node DOM fixture, not native-browser layout/focus evidence. In
// particular, never inspect __reactProps or call a captured onClick callback.
function removalEventTree() {
  const document = globalThis.document;
  const { installTree } = require("../helpers/harness/fakeDomTree");
  const tree = installTree();
  const listeners = new Map();
  tree.container.addEventListener = (type, callback, options) => {
    const capture = typeof options === "boolean" ? options : !!options?.capture;
    const key = `${type}:${capture}`;
    const callbacks = listeners.get(key) ?? new Set();
    callbacks.add(callback);
    listeners.set(key, callbacks);
  };
  tree.container.removeEventListener = (type, callback, options) => {
    const capture = typeof options === "boolean" ? options : !!options?.capture;
    listeners.get(`${type}:${capture}`)?.delete(callback);
  };
  const makeElement = document.createElement;
  document.createElement = (tag) => {
    const element = makeElement(tag);
    element.click = () => {
      if (element.disabled) return;
      const event = {
        type: "click",
        target: element,
        button: 0,
        bubbles: true,
        cancelable: true,
        defaultPrevented: false,
        stopPropagation() {
          this.cancelBubble = true;
        },
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
      for (const capture of [true, false]) {
        for (const callback of listeners.get(`click:${capture}`) ?? []) callback(event);
        if (event.cancelBubble) break;
      }
    };
    return element;
  };
  return tree;
}

test("[change-driving] rendered removal Undo survives its field and restores the original slot", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const main = mainCredentials({ OPENAI_API_KEY: SECRETS[4], GROQ_API_KEY: "groq-kept-fixture" });
  installBrowserGlobals(t, {
    window: { location: { search: "?panel=true" }, electronAPI: { credentials: main.api } },
  });
  installHookDom(t);
  const tree = removalEventTree();
  const vite = await rendererServer(t, "loqui-rendered-removal-", {
    mockModules: { "/services/ReasoningService": "export default { clearApiKeyCache() {} };" },
  });
  const ApiKeyInput = (await vite.ssrLoadModule("/components/ui/ApiKeyInput.tsx")).default;
  const { NoticeStack } = await vite.ssrLoadModule("/components/ui/NoticeStack.tsx");
  await noticeCapture(vite, t);
  root = createRoot(tree.container);
  const draw = (id) =>
    React.act(async () =>
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(NoticeStack, { placement: "panel" }),
          id
            ? React.createElement(ApiKeyInput, {
                credentialId: id,
                apiKey: "__stored__",
                setApiKey: async () => {
                  throw new Error("not a save");
                },
              })
            : null
        )
      )
    );
  const button = (label) =>
    tree.find((node) => node.tagName === "BUTTON" && node.textContent === label);
  const click = async (node) => {
    assert.ok(node, "the actual host button is rendered");
    await React.act(async () => {
      node.click();
      await new Promise((resolve) => setImmediate(resolve));
    });
  };
  await draw("openai");
  await click(button("personal.removeKey"));
  assert.deepEqual(main.calls, [["remove", "openai"]]);
  assert.equal(main.env.values.has("OPENAI_API_KEY"), false);
  assert.match(tree.text(), /apiKeyInput.removed/, "the real toast renders the removal notice");
  const undo = button("apiKeyInput.undo");
  assert.ok(undo, "the real standard toast renders its structured Undo button");
  assert.equal(undo.attributes.type, "button");
  await draw("groq");
  await draw(null);
  assert.ok(
    button("apiKeyInput.undo"),
    "the provider retains Undo after field replacement/unmount"
  );
  const surface = () => {
    const collect = (node) => ({
      text: node.nodeType === 3 ? node.data : undefined,
      attributes: node.attributes,
      children: node.childNodes.map(collect),
    });
    return collect(tree.container);
  };
  assertSecretFree(surface());
  assert.ok(
    !JSON.stringify(surface()).includes(main.tokens[0]),
    "the capability never enters DOM text/attributes"
  );
  await click(button("apiKeyInput.undo"));
  assert.deepEqual(main.calls, [
    ["remove", "openai"],
    ["undoRemove", "<token>"],
  ]);
  assert.equal(main.env.values.get("OPENAI_API_KEY"), SECRETS[4]);
  assert.equal(main.env.values.get("GROQ_API_KEY"), "groq-kept-fixture");
  assert.match(tree.text(), /apiKeyInput.restored/);
  assertSecretFree(surface());
});

test("[change-driving] notices render migrated structured actions and keepOpen retains the notice", async (t) => {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  installBrowserGlobals(t, { window: { location: { search: "?panel=true" } } });
  installHookDom(t);
  const tree = removalEventTree();
  const vite = await rendererServer(t, "loqui-rendered-notice-actions-");
  const { NoticeStack } = await vite.ssrLoadModule("/components/ui/NoticeStack.tsx");
  const { store } = await noticeCapture(vite, t);
  const clicked = [];
  store.notify({
    kind: "receipt",
    title: "Action fixture",
    persistent: true,
    actions: [
      {
        label: "Migrated action",
        primary: true,
        keepOpen: true,
        onClick: () => clicked.push("migrated"),
      },
      { label: "Keep open", keepOpen: true, onClick: () => clicked.push("keep") },
      { label: "Finish", onClick: () => clicked.push("finish") },
    ],
  });
  root = createRoot(tree.container);
  await React.act(async () =>
    root.render(React.createElement(NoticeStack, { placement: "panel" }))
  );
  const button = (label) =>
    tree.find((node) => node.tagName === "BUTTON" && node.textContent === label);
  const click = async (label) => {
    const target = button(label);
    assert.ok(target, `${label} is an actual rendered action button`);
    assert.equal(target.attributes.type, "button");
    await React.act(async () => target.click());
  };
  await click("Migrated action");
  await React.act(async () => {
    const more = tree.find((node) => node.attributes?.["aria-label"] === "notices.messageDetails");
    assert.ok(more, "secondary actions remain reachable behind More");
    more.click();
  });
  await click("Keep open");
  assert.deepEqual(clicked, ["migrated", "keep"]);
  assert.equal(store.getNotices().length, 1, "keepOpen retains the real notice");
  await click("Finish");
  assert.deepEqual(clicked, ["migrated", "keep", "finish"]);
  assert.deepEqual(store.getNotices(), []);
  assert.equal(
    tree.find((node) => node.attributes?.class === "notice-chip"),
    null
  );
});
