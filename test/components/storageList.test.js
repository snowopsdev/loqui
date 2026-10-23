const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");
const { deferred } = require("../helpers/harness/deferred");
const { resolveTokens } = require("../helpers/harness/cssTokens");
const { createHash } = require("node:crypto");

// Renders key(name=value,...) so nested, counted strings stay readable.
const T =
  "(k, o) => (o ? k + '(' + Object.entries(o).map(([a, b]) => a + '=' + b).join(',') + ')' : k)";
const serverOptions = (prefix) => withI18nMock({ cachePrefix: prefix }, { t: T });

const AUDIO_IDENTITY = "a".repeat(64);
const HISTORY_IDENTITY = "b".repeat(64);
const AUDIO = {
  kind: "audio",
  files: 214,
  bytes: 1_200_000_000,
  directory: "/tmp/loqui-test/audio",
  audioIdentity: AUDIO_IDENTITY,
};
const HISTORY = {
  kind: "history",
  total: 1482,
  discarded: 12,
  softDeleted: 3,
  files: 214,
  bytes: 1_200_000_000,
  directory: "/tmp/loqui-test/audio",
  audioIdentity: AUDIO_IDENTITY,
  historyIdentity: HISTORY_IDENTITY,
};
const MODELS = {
  kind: "models",
  count: 3,
  bytes: 9_800_000_000,
  directory: "/tmp/loqui-test/cache",
};
const ready = (snapshot) => ({ status: "ready", snapshot });
const noop = () => {};

// baseline guard: Plan 01 tokens already satisfy these pairs; the class test below pins their use.
test("[baseline guard] destructive text clears 4.5:1 on the surfaces Storage puts it on (I13)", async () => {
  const { contrastRatio } = await import("../../src/utils/contrast.ts");
  const { light, dark } = resolveTokens(
    fs.readFileSync(path.join(__dirname, "../../src/index.css"), "utf8")
  );
  for (const surface of ["--color-background", "--color-card"]) {
    const ratio = contrastRatio(light["--color-destructive"], light[surface]);
    assert.ok(ratio >= 4.5, `light destructive on ${surface} is ${ratio}:1`);
  }
  for (const surface of ["--color-surface-raised", "--color-surface-2"]) {
    const ratio = contrastRatio(dark["--color-destructive"], dark[surface]);
    assert.ok(ratio >= 4.5, `dark destructive on ${surface} is ${ratio}:1`);
  }
});

// change-driving (every subtest): StorageList.tsx does not exist.
test("[change-driving] storage list markup", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, serverOptions("loqui-storage-view-test-"));
  const s = await vite.ssrLoadModule("/components/settings/StorageList.tsx");
  const view = (props = {}) =>
    renderToStaticMarkup(
      React.createElement(s.StorageListView, {
        audio: ready(AUDIO),
        models: ready(MODELS),
        history: ready(HISTORY),
        onDelete: noop,
        onOpenModels: noop,
        onRefresh: noop,
        onReset: noop,
        ...props,
      })
    );
  const content = (snapshot, extra = {}) =>
    renderToStaticMarkup(
      React.createElement(s.CountedDeleteContent, {
        snapshot,
        phase: "review",
        last: null,
        onConfirm: noop,
        onCancel: noop,
        onRecount: noop,
        ...extra,
      })
    );

  await t.test("[change-driving] rows show main's counts, including hidden history rows", () => {
    const html = view();
    assert.ok(html.includes("storage.audio.summary(count=214,size=1.2 GB)"));
    assert.ok(html.includes("storage.models.summary(count=3,size=9.8 GB)"));
    assert.ok(
      html.includes(
        "storage.history.summaryWithHidden(count=1482,hidden=storage.history.hidden(count=15))"
      )
    );
    assert.doesNotMatch(
      html,
      /data-variant="destructive"/,
      "solid destructive only inside dialogs"
    );
  });

  await t.test(
    "[change-driving] destructive triggers sit on and hover to the background, never muted (I13)",
    () => {
      const tags = view().match(/<button[^>]*data-storage-(?:delete|reset)=[^>]*>/g);
      assert.equal(tags.length, 4);
      for (const tag of tags) {
        const classes = /class="([^"]*)"/.exec(tag)[1].split(/\s+/);
        assert.ok(classes.includes("text-destructive"), tag);
        assert.ok(
          classes.includes("bg-background") && classes.includes("hover:bg-background"),
          tag
        );
        assert.ok(!classes.some((c) => c === "hover:bg-muted" || c.startsWith("bg-muted")), tag);
      }
    }
  );

  await t.test(
    "[change-driving] an uncountable or loading row says so and cannot delete (I12)",
    () => {
      const html = view({
        audio: { status: "error", error: "ENOTDIR" },
        history: { status: "error", error: "audio: ENOTDIR" },
        models: { status: "loading" },
      });
      assert.ok(html.includes("storage.countFailed"));
      // Plan 02's unavailable state (spec §5.6), ported from audioStorageRow.test.js: the audio row says the
      // folder couldn't be read, offers Count again (the Retry), and never says "no audio".
      assert.ok(html.includes("settingsPage.privacy.audioStorageUnavailable"));
      assert.ok(!html.includes("storage.audio.empty"));
      assert.ok(html.includes("storage.loading"));
      for (const kind of ["audio", "models", "history"]) {
        assert.match(html, new RegExp(`<button[^>]*data-storage-delete="${kind}"[^>]*disabled=""`));
      }
      assert.match(html, /data-storage-action="refresh"/);
      assert.ok(!html.includes("summary(count=0"), "unreadable is never shown as zero");
    }
  );

  await t.test("[change-driving] the audio confirm repeats count, size and folder", () => {
    const html = content(AUDIO);
    assert.ok(html.includes("storage.audio.confirmTitle(count=214)"));
    assert.ok(html.includes("storage.audio.confirmBody(count=214,size=1.2 GB)"));
    assert.match(html, /<code dir="ltr"[^>]*>\/tmp\/loqui-test\/audio<\/code>/);
    assert.ok(html.includes("storage.audio.confirmButton(count=214)"));
    assert.match(html, /data-variant="destructive"/);
  });

  await t.test(
    "[change-driving] the history confirm counts and names transcripts and audio (C2)",
    () => {
      const html = content(HISTORY);
      assert.ok(
        html.includes(
          "storage.history.confirmBody(transcripts=storage.history.transcriptsWithHidden(count=1482,discarded=storage.history.discarded(count=12),deleted=storage.history.softDeleted(count=3)),audio=storage.history.audioFiles(count=214,size=1.2 GB))"
        )
      );
      assert.ok(
        html.includes(
          "storage.history.confirmButton(transcripts=storage.history.transcripts(count=1482),audio=storage.history.audioFilesShort(count=214))"
        )
      );
    }
  );
});

// ---- Mounted container: the real handlers against a fake window.electronAPI ----

function find(node, predicate) {
  if (Array.isArray(node)) return node.map((item) => find(item, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}
const settle = () =>
  React.act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const UNREADABLE = { fileCount: 0, totalBytes: 0, readable: false }; // Plan 02's unreadable usage
const PREVIEW = {
  audio: {
    files: 214,
    bytes: 1_200_000_000,
    directory: "/tmp/loqui-test/audio",
    audioIdentity: AUDIO_IDENTITY,
  },
  history: {
    total: 1482,
    discarded: 12,
    softDeleted: 3,
    withAudio: 199,
    historyIdentity: HISTORY_IDENTITY,
  },
};

// Main's model inventory identity: the downloaded set only, never download progress.
const modelsIdentity = ({ whisper, parakeet, llm }) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        ...(whisper?.models ?? []).filter((m) => m?.downloaded).map((m) => ["whisper", m.model]),
        ...(parakeet?.models ?? []).filter((m) => m?.downloaded).map((m) => ["parakeet", m.model]),
        ...(Array.isArray(llm) ? llm : []).filter((m) => m?.isDownloaded).map((m) => ["llm", m.id]),
      ])
    )
    .digest("hex");

function fakeApi({ storage = {}, sealed = false, ...rest } = {}) {
  const calls = [];
  const main = { sealed };
  const disk = { whisper: true, parakeet: false, llm: true };
  // Stands in for main's storage-preview-models/storage-delete-models: one read of
  // the three family lists with its identity, and a delete that refuses a changed set.
  const previewModels = async () => {
    const [whisper, parakeet, llm] = await Promise.all([
      api.listWhisperModels(),
      api.listParakeetModels(),
      api.modelGetAll(),
    ]);
    return { whisper, parakeet, llm, modelsIdentity: modelsIdentity({ whisper, parakeet, llm }) };
  };
  const api = {
    storage: {
      preview: async () => PREVIEW,
      previewModels,
      deleteModels: async (expected) => {
        calls.push(["deleteModels", expected]);
        const current = await previewModels();
        if (current.modelsIdentity !== expected.modelsIdentity) {
          return { ok: false, remaining: null, errors: ["stale"], families: null };
        }
        const families = {};
        for (const [family, erase] of [
          ["whisper", api.deleteAllWhisperModels],
          ["parakeet", api.deleteAllParakeetModels],
          ["llm", api.modelDeleteAll],
        ]) {
          try {
            families[family] = await erase();
          } catch (error) {
            families[family] = { success: false, error: error.message };
          }
        }
        return { ok: true, errors: [], families };
      },
      deleteAudio: async (expected) => {
        calls.push(["deleteAudio", expected]);
        return { ok: true, deleted: 214, failed: 0, readable: true, remaining: 0, errors: [] };
      },
      deleteHistory: async (expected) => {
        calls.push(["deleteHistory", expected]);
        return {
          ok: true,
          deleted: 1482,
          remaining: 0,
          errors: [],
          audio: { deleted: 214, failed: 0, readable: true, remaining: 0 },
        };
      },
      ...storage,
    },
    // Plan 02's hook (useAudioStorageUsage) reads this for the audio row.
    getAudioStorageUsage: async () => ({
      fileCount: 214,
      totalBytes: 1_200_000_000,
      readable: true,
    }),
    listWhisperModels: async () => ({
      success: true,
      models: [{ model: "base", downloaded: disk.whisper, size_bytes: 147_951_465 }],
    }),
    listParakeetModels: async () => ({
      success: true,
      models: [
        { model: "parakeet-tdt-0.6b-v3", downloaded: disk.parakeet, size_bytes: 640_000_000 },
      ],
    }),
    modelGetAll: async () => [
      { id: "qwen3.5-2b-q4_k_m", isDownloaded: disk.llm, downloadedSize: 1_329_766_560 },
    ],
    getModelCacheRoot: async () => "/tmp/loqui-test/cache",
    deleteAllWhisperModels: async () => {
      disk.whisper = false;
      return { success: true };
    },
    deleteAllParakeetModels: async () => {
      disk.parakeet = false;
      return { success: true };
    },
    modelDeleteAll: async () => {
      disk.llm = false;
      return { success: true };
    },
    cleanupApp: async () => ({ success: true, message: "Cleanup completed", errors: [] }),
    // Main's relaunch-app refuses while sealed (A5: it would launch a native
    // waiter), and the rejection crosses IPC as an invoke error.
    relaunchApp: async () => {
      calls.push(["relaunch"]);
      if (main.sealed)
        throw new Error(
          "Error invoking remote method 'relaunch-app': Error: NATIVE_BOUNDARY_UNAVAILABLE"
        );
    },
    ...rest,
  };
  return { api, calls, main, disk };
}

async function mount(t, api) {
  let root;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const events = [];
  installBrowserGlobals(t, {
    initialStorage: {
      cleanupMode: "local",
      cleanupModel: "qwen3.5-2b-q4_k_m",
      useLocalWhisper: "true",
      uploadUseLocalWhisper: "true",
    },
    window: {
      electronAPI: api,
      dispatchEvent: (event) => {
        events.push(event.type);
        return true;
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, serverOptions("loqui-storage-list-test-"));
  const s = await vite.ssrLoadModule("/components/settings/StorageList.tsx");
  const { notices } = await require("../lib/routeTestApi").noticeCapture(vite, t);
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  let tree;
  function Probe() {
    tree = s.StorageList();
    return null;
  }
  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(Probe)));
  await settle();
  const part = (type) => find(tree, (node) => node.type === type);
  return {
    s,
    noteStore: await vite.ssrLoadModule("/stores/noteStore.ts"),
    unmount: async () => {
      const current = root;
      root = null;
      if (current) await React.act(async () => current.unmount());
    },
    notices,
    events,
    store: useSettingsStore,
    view: () => part(s.StorageListView).props,
    dialog: () => part(s.CountedDeleteDialog)?.props ?? null,
    reset: () => part(s.ResetDialog)?.props ?? null,
  };
}

async function confirmDelete(h, kind) {
  await React.act(async () => h.view().onDelete(kind));
  await React.act(async () => h.dialog().onConfirm());
  await settle();
}

// change-driving (every mounted test): the container does not exist.
test("[change-driving] history delete sends the reviewed counts and identities and reports main's numbers (C2)", async (t) => {
  const { api, calls } = fakeApi();
  const h = await mount(t, api);
  await React.act(async () => h.view().onDelete("history"));
  assert.deepEqual(h.dialog().snapshot, {
    kind: "history",
    total: 1482,
    discarded: 12,
    softDeleted: 3,
    files: 214,
    bytes: 1_200_000_000,
    directory: "/tmp/loqui-test/audio",
    audioIdentity: AUDIO_IDENTITY,
    historyIdentity: HISTORY_IDENTITY,
  });
  await React.act(async () => h.dialog().onConfirm());
  await settle();
  assert.deepEqual(calls, [
    [
      "deleteHistory",
      { total: 1482, files: 214, audioIdentity: AUDIO_IDENTITY, historyIdentity: HISTORY_IDENTITY },
    ],
  ]);
  assert.equal(h.dialog(), null);
  assert.deepEqual(
    h.notices.map((x) => x.title),
    ["storage.history.done(count=1482)"]
  );
});

test("[change-driving] a rejected delete keeps the reviewed snapshot with an unknown outcome (I12)", async (t) => {
  const { api } = fakeApi({
    storage: {
      deleteAudio: async () => {
        throw new Error("IPC channel closed");
      },
    },
  });
  const h = await mount(t, api);
  await confirmDelete(h, "audio");
  const d = h.dialog();
  assert.equal(d.phase, "failed");
  assert.equal(d.snapshot.files, 214);
  assert.deepEqual(d.last.outcome, {
    ok: false,
    deleted: null,
    remaining: null,
    errors: ["ipc-failed: IPC channel closed"],
  });
  assert.deepEqual(h.notices, []);
  const html = renderToStaticMarkup(React.createElement(h.s.CountedDeleteContent, d));
  assert.match(html, /role="alert"/);
  assert.ok(html.includes("storage.failed.unknown"));
  assert.ok(html.includes("ipc-failed: IPC channel closed"));
  assert.match(html, /data-storage-action="recount"/);
});

test("[change-driving] a partial result from main shows its exact counts and errors (M4)", async (t) => {
  const { api } = fakeApi({
    storage: {
      deleteAudio: async () => ({
        ok: false,
        deleted: 211,
        failed: 3,
        readable: true,
        remaining: 3,
        errors: ["delete-failed: OpenWhispr-7.webm: EBUSY"],
      }),
    },
  });
  const h = await mount(t, api);
  await confirmDelete(h, "audio");
  const d = h.dialog();
  assert.equal(d.phase, "failed");
  assert.deepEqual(d.last.outcome, {
    ok: false,
    deleted: 211,
    remaining: 3,
    errors: ["delete-failed: OpenWhispr-7.webm: EBUSY"],
  });
  const html = renderToStaticMarkup(React.createElement(h.s.CountedDeleteContent, d));
  assert.match(html, /role="alert"/);
  assert.ok(html.includes("storage.failed.partial(deleted=211,total=214,remaining=3)"));
  assert.ok(html.includes("delete-failed: OpenWhispr-7.webm: EBUSY"));
  assert.deepEqual(h.notices, []);
});

test("[change-driving] ok:true with an unknown remainder is still a failure (I12)", async (t) => {
  const { api } = fakeApi({
    storage: {
      deleteAudio: async () => ({
        ok: true,
        deleted: 214,
        failed: 0,
        readable: true,
        remaining: null,
        errors: ["recount-failed: EACCES"],
      }),
    },
  });
  const h = await mount(t, api);
  await confirmDelete(h, "audio");
  assert.equal(h.dialog().phase, "failed");
  assert.equal(h.dialog().last.outcome.ok, false);
  assert.deepEqual(h.notices, []);
});

test("[change-driving] a failed recount after a delete shows an error row, never zero (I12)", async (t) => {
  let previews = 0;
  const { api } = fakeApi({
    storage: {
      preview: async () => {
        previews++;
        if (previews > 2) throw new Error("EACCES"); // 1: mount, 2: Delete… re-read, 3: after the delete
        return PREVIEW;
      },
    },
    // load() calls preview first, then the hook's refresh(), so this sees the same read number.
    getAudioStorageUsage: async () =>
      previews > 2 ? UNREADABLE : { fileCount: 214, totalBytes: 1_200_000_000, readable: true },
  });
  const h = await mount(t, api);
  await confirmDelete(h, "audio");
  assert.deepEqual(
    h.notices.map((x) => x.title),
    ["storage.audio.done(count=214)"],
    "success came from main's typed result"
  );
  assert.deepEqual(
    h.view().audio,
    { status: "error", error: "unavailable" },
    "Plan 02's hook: unavailable, not zero"
  );
  assert.deepEqual(h.view().history, { status: "error", error: "EACCES" });
});

test("[change-driving] the dialog keeps the reviewed snapshot while a delete runs (I12)", async (t) => {
  const pending = deferred();
  let files = 214;
  const sent = [];
  const { api } = fakeApi({
    storage: {
      preview: async () => ({ ...PREVIEW, audio: { ...PREVIEW.audio, files } }),
      deleteAudio: (expected) => {
        sent.push(expected);
        return pending.promise;
      },
    },
    getAudioStorageUsage: async () => ({
      fileCount: files,
      totalBytes: 1_200_000_000,
      readable: true,
    }),
  });
  const h = await mount(t, api);
  await React.act(async () => h.view().onDelete("audio"));
  await React.act(async () => {
    h.dialog().onConfirm();
  });
  assert.equal(h.dialog().phase, "running");
  files = 5;
  await React.act(async () => h.view().onRefresh());
  await settle();
  assert.equal(h.view().audio.snapshot.files, 5, "the row refreshed");
  assert.equal(h.dialog().snapshot.files, 214, "the dialog did not");
  await React.act(async () => h.dialog().onConfirm());
  await React.act(async () => h.dialog().onOpenChange(false));
  assert.deepEqual(
    sent,
    [{ files: 214, audioIdentity: AUDIO_IDENTITY }],
    "reviewed identity stays fixed while running"
  );
  assert.equal(sent.length, 1, "a second click while running is ignored");
  assert.equal(h.dialog().phase, "running", "a running dialog cannot be closed");
  pending.resolve({ ok: true, deleted: 214, failed: 0, readable: true, remaining: 0, errors: [] });
  await settle();
  assert.equal(h.dialog(), null);
});

test("[change-driving] main's stale refusal brings back the new counts for review (C2)", async (t) => {
  let total = 1482;
  const { api } = fakeApi({
    storage: {
      preview: async () => ({ ...PREVIEW, history: { ...PREVIEW.history, total } }),
      deleteHistory: async () => {
        total = 1483;
        return {
          ok: false,
          deleted: 0,
          remaining: 1483,
          errors: ["stale"],
          audio: { deleted: 0, failed: 0, readable: true, remaining: 214 },
        };
      },
    },
  });
  const h = await mount(t, api);
  await confirmDelete(h, "history");
  const d = h.dialog();
  assert.equal(d.phase, "review");
  assert.equal(d.snapshot.total, 1483);
  assert.deepEqual(d.last.outcome.errors, ["stale"]);
  const html = renderToStaticMarkup(React.createElement(h.s.CountedDeleteContent, d));
  assert.ok(html.includes("storage.failed.stale"));
  assert.ok(html.includes("storage.history.transcripts(count=1483)"));
  assert.deepEqual(h.notices, []);
});

test("[change-driving] same-count stale refusal refreshes identities and the next confirmation sends the new pair", async (t) => {
  const newAudioIdentity = "c".repeat(64);
  const newHistoryIdentity = "d".repeat(64);
  let changed = false;
  const sent = [];
  const { api } = fakeApi({
    storage: {
      preview: async () =>
        changed
          ? {
              audio: { ...PREVIEW.audio, audioIdentity: newAudioIdentity },
              history: { ...PREVIEW.history, historyIdentity: newHistoryIdentity },
            }
          : PREVIEW,
      deleteHistory: async (expected) => {
        sent.push(expected);
        if (!changed) {
          changed = true;
          return {
            ok: false,
            deleted: 0,
            remaining: 1482,
            errors: ["stale"],
            audio: { deleted: 0, failed: 0, readable: true, remaining: 214 },
          };
        }
        return {
          ok: true,
          deleted: 1482,
          remaining: 0,
          errors: [],
          audio: { deleted: 214, failed: 0, readable: true, remaining: 0 },
        };
      },
    },
  });
  const h = await mount(t, api);
  await confirmDelete(h, "history");
  assert.equal(h.dialog().phase, "review");
  assert.equal(h.dialog().snapshot.total, 1482, "counts need not change");
  assert.equal(h.dialog().snapshot.audioIdentity, newAudioIdentity);
  assert.equal(h.dialog().snapshot.historyIdentity, newHistoryIdentity);
  assert.deepEqual(h.notices, []);
  await React.act(async () => h.dialog().onConfirm());
  await settle();
  assert.deepEqual(sent, [
    { total: 1482, files: 214, audioIdentity: AUDIO_IDENTITY, historyIdentity: HISTORY_IDENTITY },
    {
      total: 1482,
      files: 214,
      audioIdentity: newAudioIdentity,
      historyIdentity: newHistoryIdentity,
    },
  ]);
  assert.equal(h.dialog(), null);
});

test("[change-driving] models: typed per-family outcomes; selections stay after a partial delete", async (t) => {
  const { api } = fakeApi({
    deleteAllParakeetModels: async () => {
      throw new Error("EBUSY");
    },
    modelDeleteAll: async () => ({ success: false, error: "MODEL_BUSY" }),
  });
  const h = await mount(t, api);
  assert.equal(h.view().models.snapshot.count, 2);
  await confirmDelete(h, "models");
  const d = h.dialog();
  assert.equal(d.phase, "failed");
  assert.deepEqual(d.last.outcome, {
    ok: false,
    deleted: 1,
    remaining: 1,
    errors: ["parakeet: EBUSY", "llm: MODEL_BUSY"],
    families: [
      { family: "whisper", ok: true },
      { family: "parakeet", ok: false, error: "EBUSY" },
      { family: "llm", ok: false, error: "MODEL_BUSY" },
    ],
  });
  assert.equal(
    h.store.getState().cleanupModel,
    "qwen3.5-2b-q4_k_m",
    "a file is left, so selections stay"
  );
  assert.ok(h.events.includes("openwhispr-models-cleared"));
  const html = renderToStaticMarkup(React.createElement(h.s.CountedDeleteContent, d));
  assert.ok(html.includes("storage.models.familyFailed(family=storage.models.families.parakeet)"));
  assert.ok(html.includes("storage.failed.partial(deleted=1,total=2,remaining=1)"));
});

// The audio row runs on Plan 02's useAudioStorageUsage (its own tests stay unchanged); these pin that
// the Storage list keeps its unavailable state and clearAllAudio.test.js's "re-reads before confirming
// and never confirms a stale count". change-driving: the container does not exist.
test("[change-driving] an unreadable or rejected first read is unavailable, and opens no confirmation (Plan 02, §5.6)", async (t) => {
  const reject = async () => {
    throw new Error("ipc down");
  };
  for (const [index, [preview, getAudioStorageUsage]] of [
    [
      async () => ({ ...PREVIEW, audio: { error: "ENOTDIR: not a directory" } }),
      async () => UNREADABLE,
    ],
    [reject, reject],
  ].entries()) {
    await t.test(`[baseline guard] unreadable case ${index}`, async (t) => {
      const { api, calls } = fakeApi({ storage: { preview }, getAudioStorageUsage });
      const h = await mount(t, api);
      assert.deepEqual(h.view().audio, { status: "error", error: "unavailable" });
      await React.act(async () => h.view().onDelete("audio"));
      assert.equal(h.dialog(), null);
      assert.deepEqual(calls, []);
    });
  }
});

test("[change-driving] Delete… re-reads before confirming; a failed re-read opens nothing (Plan 02, §5.6)", async (t) => {
  let previews = 0;
  let files = 214;
  const { api, calls } = fakeApi({
    storage: {
      preview: async () => {
        previews++;
        if (previews === 3) throw new Error("EACCES");
        return { ...PREVIEW, audio: { ...PREVIEW.audio, files } };
      },
    },
    getAudioStorageUsage: async () =>
      previews >= 3 ? UNREADABLE : { fileCount: files, totalBytes: 1_200_000_000, readable: true },
  });
  const h = await mount(t, api); // read 1
  files = 210;
  await React.act(async () => h.view().onDelete("audio")); // read 2
  assert.equal(
    h.dialog().snapshot.files,
    210,
    "the confirm shows the fresh count, not the row's older one"
  );
  await React.act(async () => h.dialog().onCancel());
  await React.act(async () => h.view().onDelete("audio")); // read 3 fails
  assert.equal(h.dialog(), null, "no confirmation on a failed read");
  assert.deepEqual(
    h.view().audio,
    { status: "error", error: "unavailable" },
    "the stale count is not kept"
  );
  assert.deepEqual(calls, []);
});

test("[change-driving] models: selections are cleared only when every model file is gone", async (t) => {
  const { api } = fakeApi();
  const h = await mount(t, api);
  await confirmDelete(h, "models");
  assert.equal(h.dialog(), null);
  assert.equal(h.store.getState().cleanupModel, "");
  assert.deepEqual(
    h.notices.map((x) => x.title),
    ["storage.models.done(count=2)"]
  );
});

// change-driving (Codex P2): the models confirmation named a set main never rechecked.
test("[change-driving] models: a model added after review is refused as stale and nothing is deleted", async (t) => {
  const { api, calls, disk } = fakeApi();
  const h = await mount(t, api);
  await React.act(async () => h.view().onDelete("models"));
  assert.equal(h.dialog().snapshot.count, 2);
  disk.parakeet = true; // a background download finishes before the user confirms
  await React.act(async () => h.dialog().onConfirm());
  await settle();
  assert.deepEqual(disk, { whisper: true, parakeet: true, llm: true }, "nothing was deleted");
  assert.deepEqual(calls, [
    ["deleteModels", { count: 2, modelsIdentity: h.dialog().last.snapshot.modelsIdentity }],
  ]);
  const d = h.dialog();
  assert.equal(d.phase, "review");
  assert.equal(d.snapshot.count, 3, "the new model is shown for review");
  assert.notEqual(d.snapshot.modelsIdentity, d.last.snapshot.modelsIdentity);
  assert.deepEqual(d.last.outcome.errors, ["stale"]);
  const html = renderToStaticMarkup(React.createElement(h.s.CountedDeleteContent, d));
  assert.ok(html.includes("storage.failed.stale"));
  assert.ok(html.includes("storage.models.confirmTitle(count=3)"));
  assert.equal(h.store.getState().cleanupModel, "qwen3.5-2b-q4_k_m", "selections stay");
  assert.deepEqual(h.notices, []);
  // Confirming the refreshed review deletes the set the user saw.
  await React.act(async () => h.dialog().onConfirm());
  await settle();
  assert.equal(h.dialog(), null);
  assert.deepEqual(disk, { whisper: false, parakeet: false, llm: false });
  assert.deepEqual(
    h.notices.map((x) => x.title),
    ["storage.models.done(count=3)"]
  );
});

test("[change-driving] a partial reset stays open with its errors and never relaunches (I12)", async (t) => {
  let attempts = 0;
  const { api, calls } = fakeApi({
    cleanupApp: async () => {
      attempts++;
      return attempts === 1
        ? { success: false, message: "Cleanup completed", errors: ["DB file: EBUSY"] }
        : { success: true, message: "Cleanup completed", errors: [] };
    },
  });
  const h = await mount(t, api);
  await React.act(async () => h.view().onReset());
  assert.equal(h.reset().confirmDisabled, true, "the word has not been typed");
  await React.act(async () => h.reset().onConfirm());
  assert.equal(attempts, 0);
  await React.act(async () => h.reset().onTypedChange("storage.reset.word"));
  assert.equal(h.reset().confirmDisabled, false);
  await React.act(async () => h.reset().onConfirm());
  await settle();
  assert.equal(h.reset().phase, "failed");
  assert.deepEqual(h.reset().errors, ["DB file: EBUSY"]);
  const html = renderToStaticMarkup(React.createElement(h.s.ResetContent, h.reset()));
  assert.match(html, /role="alert"/);
  assert.ok(html.includes("DB file: EBUSY"));
  await wait(1100);
  assert.deepEqual(calls, [], "no relaunch after a failed reset");

  await React.act(async () => h.reset().onConfirm()); // "Try again"
  await settle();
  assert.equal(h.reset().phase, "done");
  await wait(1100);
  assert.deepEqual(calls, [["relaunch"]]);
});

test("[change-driving] a rejected reset keeps the dialog open with the IPC error (I12)", async (t) => {
  const { api, calls } = fakeApi({
    cleanupApp: async () => {
      throw new Error("main crashed");
    },
  });
  const h = await mount(t, api);
  await React.act(async () => h.view().onReset());
  await React.act(async () => h.reset().onTypedChange("storage.reset.word"));
  await React.act(async () => h.reset().onConfirm());
  await settle();
  assert.equal(h.reset().phase, "failed");
  assert.deepEqual(h.reset().errors, ["ipc-failed: main crashed"]);
  await wait(1100);
  assert.deepEqual(calls, []);
});

// change-driving: even an empty recount cannot override a typed family failure.
test("[change-driving] models: failed family with zero recount keeps raw selections and fails", async (t) => {
  const { api } = fakeApi();
  const erase = api.modelDeleteAll;
  api.modelDeleteAll = async () => {
    await erase();
    return { success: false, error: "PARTIAL_FAILURE" };
  };
  const h = await mount(t, api);
  await confirmDelete(h, "models");
  assert.equal(h.dialog().phase, "failed");
  assert.equal(h.dialog().last.outcome.remaining, 0);
  assert.equal(h.store.getState().cleanupModel, "qwen3.5-2b-q4_k_m");
  assert.deepEqual(h.notices, []);
});

// change-driving: the hook's failed fresh read must block the confirmation too.
test("[change-driving] audio Delete refuses a failed hook read even with a valid main preview", async (t) => {
  const { api, calls } = fakeApi({ getAudioStorageUsage: async () => UNREADABLE });
  const h = await mount(t, api);
  await React.act(async () => h.view().onDelete("audio"));
  assert.equal(h.dialog(), null);
  assert.deepEqual(calls, []);
});

// change-driving: capability is independent of storage inventory (Task 13).
test("[change-driving] downloaded models count even when hardware is unsupported", async (t) => {
  const { api } = fakeApi({
    listParakeetModels: async () => ({
      success: true,
      supported: false,
      models: [{ downloaded: true, size_bytes: 100 }],
    }),
    checkParakeetInstallation: async () => ({ supported: false }),
  });
  const h = await mount(t, api);
  assert.equal(h.view().models.snapshot.count, 3);
  assert.equal(h.view().models.snapshot.bytes, 147951465 + 1329766560 + 100);
});

// change-driving: a missing family success cannot retire even an empty inventory.
test("[change-driving] models: malformed family outcome with zero recount preserves selection", async (t) => {
  const { api } = fakeApi();
  const erase = api.modelDeleteAll;
  api.modelDeleteAll = async () => {
    await erase();
    return undefined;
  };
  const h = await mount(t, api);
  await confirmDelete(h, "models");
  assert.equal(h.dialog().phase, "failed");
  assert.equal(h.dialog().last.outcome.remaining, 0);
  assert.deepEqual(h.dialog().last.outcome.errors, ["llm: no success result"]);
  assert.equal(h.store.getState().cleanupModel, "qwen3.5-2b-q4_k_m");
});

// change-driving: state updates alone cannot fence two same-turn confirmations.
test("[change-driving] duplicate-reset confirmations invoke cleanup only once", async (t) => {
  const pending = deferred();
  let attempts = 0;
  const { api } = fakeApi({
    cleanupApp: () => {
      attempts++;
      return pending.promise;
    },
  });
  const h = await mount(t, api);
  await React.act(async () => h.view().onReset());
  await React.act(async () => h.reset().onTypedChange("storage.reset.word"));
  const confirm = h.reset().onConfirm;
  await React.act(async () => {
    confirm();
    confirm();
  });
  const callsWhileRunning = attempts;
  pending.resolve({ success: false, errors: ["fixture reset refused"] });
  await settle();
  assert.equal(callsWhileRunning, 1);
  assert.equal(h.reset().phase, "failed");
});

// change-driving: all typed deletes still need a complete, valid inventory recount.
test("[change-driving] malformed model recount preserves raw selections and unknown remainder", async (t) => {
  const { api } = fakeApi();
  let deleted = false;
  const list = api.modelGetAll;
  const erase = api.modelDeleteAll;
  api.modelGetAll = async () => (deleted ? [{}] : list());
  api.modelDeleteAll = async () => {
    const result = await erase();
    deleted = true;
    return result;
  };
  const h = await mount(t, api);
  await confirmDelete(h, "models");
  assert.equal(h.dialog()?.phase, "failed");
  assert.equal(h.dialog().last.outcome.remaining, null);
  assert.match(h.dialog().last.outcome.errors[0], /^recount-failed: llm:/);
  assert.equal(h.store.getState().cleanupModel, "qwen3.5-2b-q4_k_m");
  assert.deepEqual(h.notices, []);
});

const AUDIO_REFUSED = {
  ok: false,
  deleted: 0,
  failed: 1,
  readable: true,
  remaining: 214,
  errors: ["fixture refusal"],
};
const HISTORY_REFUSED = {
  ok: false,
  deleted: 0,
  remaining: 1482,
  errors: ["fixture refusal"],
  audio: { deleted: 0, failed: 0, readable: true, remaining: 214 },
};

// change-driving FIX1: both success and error metadata continuations must retain owner identity.
test("[change-driving FIX1] cancelled recount cannot replace newer running history", async (t) => {
  for (const rejected of [false, true])
    await t.test(`[baseline guard] old recount rejected=${rejected}`, async (t) => {
      const pending = Promise.withResolvers();
      const deletion = deferred();
      let hold = false;
      const { api } = fakeApi({
        storage: {
          preview: () => (hold ? ((hold = false), pending.promise) : Promise.resolve(PREVIEW)),
          deleteAudio: async () => AUDIO_REFUSED,
          deleteHistory: () => deletion.promise,
        },
      });
      const h = await mount(t, api);
      await confirmDelete(h, "audio");
      hold = true;
      await React.act(async () => h.dialog().onRecount());
      await React.act(async () => h.dialog().onCancel());
      await React.act(async () => h.view().onDelete("history"));
      await React.act(async () => h.dialog().onConfirm());
      const reviewed = h.dialog().snapshot;
      try {
        if (rejected) pending.reject(new Error("old recount failed"));
        else pending.resolve(PREVIEW);
        await settle();
        assert.equal(h.dialog().phase, "running");
        assert.deepEqual(h.dialog().snapshot, reviewed);
        assert.equal(h.dialog().snapshot.kind, "history");
      } finally {
        deletion.resolve(HISTORY_REFUSED);
        await settle();
      }
    });
});

// change-driving FIX1: an opening read is intent, even before a dialog is visible.
test("[change-driving FIX1] pending open cannot replace a newer running delete", async (t) => {
  const pending = Promise.withResolvers();
  const deletion = deferred();
  let hold = false;
  const { api } = fakeApi({
    storage: {
      preview: () => (hold ? ((hold = false), pending.promise) : Promise.resolve(PREVIEW)),
      deleteHistory: () => deletion.promise,
    },
  });
  const h = await mount(t, api);
  hold = true;
  await React.act(async () => {
    void h.view().onDelete("audio");
  });
  await React.act(async () => h.view().onDelete("history"));
  await React.act(async () => h.dialog().onConfirm());
  try {
    pending.resolve(PREVIEW);
    await settle();
    assert.equal(h.dialog().snapshot.kind, "history");
    assert.equal(h.dialog().phase, "running");
  } finally {
    deletion.resolve(HISTORY_REFUSED);
    await settle();
  }
});

// change-driving FIX1: cancelling the newer review also retires older pending opens.
test("[change-driving FIX1] cancelling a newer owner never resurrects an older pending open", async (t) => {
  const pending = Promise.withResolvers();
  let hold = false;
  const { api } = fakeApi({
    storage: {
      preview: () => (hold ? ((hold = false), pending.promise) : Promise.resolve(PREVIEW)),
    },
  });
  const h = await mount(t, api);
  hold = true;
  await React.act(async () => {
    void h.view().onDelete("audio");
  });
  await React.act(async () => h.view().onDelete("history"));
  await React.act(async () => h.dialog().onCancel());
  pending.resolve(PREVIEW);
  await settle();
  assert.equal(h.dialog(), null);
  await React.act(async () => h.view().onDelete("audio"));
  assert.equal(h.dialog().phase, "review", "a genuinely new intent still gets its fresh review");
});

// change-driving FIX1: pending metadata cannot introduce a delete dialog during reset.
test("[change-driving FIX1] reset owns the dialog surface over an older pending open", async (t) => {
  const pending = Promise.withResolvers();
  const reset = deferred();
  let hold = false;
  const { api } = fakeApi({
    storage: {
      preview: () => (hold ? ((hold = false), pending.promise) : Promise.resolve(PREVIEW)),
    },
    cleanupApp: () => reset.promise,
  });
  const h = await mount(t, api);
  hold = true;
  await React.act(async () => {
    void h.view().onDelete("audio");
  });
  await React.act(async () => h.view().onReset());
  await React.act(async () => h.reset().onTypedChange("storage.reset.word"));
  await React.act(async () => h.reset().onConfirm());
  try {
    pending.resolve(PREVIEW);
    await settle();
    assert.equal(h.dialog(), null);
    assert.equal(h.reset().phase, "running");
  } finally {
    reset.resolve({ success: false, errors: ["fixture refusal"] });
    await settle();
  }
});

// change-driving FIX1: a late failed recount may not revert a newer successful same-owner read.
test("[change-driving FIX1] newest recount owns review even if an older recount fails last", async (t) => {
  const pending = Promise.withResolvers();
  let hold = false;
  const { api } = fakeApi({
    storage: {
      preview: () => (hold ? ((hold = false), pending.promise) : Promise.resolve(PREVIEW)),
      deleteAudio: async () => AUDIO_REFUSED,
    },
  });
  const h = await mount(t, api);
  await confirmDelete(h, "audio");
  hold = true;
  await React.act(async () => h.dialog().onRecount());
  await React.act(async () => h.dialog().onRecount());
  assert.equal(h.dialog().phase, "review");
  pending.reject(new Error("old metadata error"));
  await settle();
  assert.equal(h.dialog().phase, "review");
  assert.deepEqual(h.dialog().last.outcome.errors, ["fixture refusal"]);
});

// change-driving FIX1: retained handlers and pending reads lose authority on unmount.
test("[change-driving FIX1] unmount retires pending reads and retained dialog handlers", async (t) => {
  const pending = Promise.withResolvers();
  let hold = false;
  let reads = 0;
  let deletes = 0;
  const { api } = fakeApi({
    storage: {
      preview: () => {
        reads++;
        return hold ? ((hold = false), pending.promise) : Promise.resolve(PREVIEW);
      },
      deleteAudio: async () => {
        deletes++;
        return AUDIO_REFUSED;
      },
    },
  });
  const h = await mount(t, api);
  await React.act(async () => h.view().onDelete("audio"));
  const retainedConfirm = h.dialog().onConfirm;
  await React.act(async () => h.dialog().onConfirm());
  await settle();
  hold = true;
  await React.act(async () => h.dialog().onRecount());
  const retainedView = h.view();
  const before = reads;
  await h.unmount();
  pending.resolve(PREVIEW);
  await settle();
  await React.act(async () => {
    retainedConfirm();
    void retainedView.onDelete("history");
  });
  await settle();
  assert.equal(reads, before, "unmounted handlers cannot start new metadata reads");
  assert.equal(deletes, 1, "unmounted confirmation cannot start a second delete");
});

for (const method of ["openNoteById", "restoreLaunchNote"]) {
  test(`R1: confirmed reset fences a pending ${method}, even if cleanup fails`, async (t) => {
    const fetch = deferred();
    const cleanup = deferred();
    let cleanupCalls = 0;
    const current = {
      id: 7,
      title: "Keep on failure",
      content: "Fixture content",
      space_id: 1,
      folder_id: null,
    };
    const { api, calls } = fakeApi({
      getNote: (id) => (id === 7 ? Promise.resolve(current) : fetch.promise),
      getNotes: async () => [],
      cleanupApp: () => {
        cleanupCalls++;
        return cleanup.promise;
      },
    });
    const h = await mount(t, api);
    const store = h.noteStore;
    await store.openNoteById(7);
    const stale = store[method](999);
    await React.act(async () => h.view().onReset());
    await React.act(async () => h.reset().onConfirm());
    assert.equal(cleanupCalls, 0, "unconfirmed reset cannot call cleanup");
    await React.act(async () => h.reset().onTypedChange("storage.reset.word"));
    await React.act(async () => {
      void h.reset().onConfirm();
    });
    assert.equal(cleanupCalls, 1);
    await React.act(async () => {
      void h.reset().onConfirm();
    });
    assert.equal(cleanupCalls, 1, "running reset still admits only once");
    fetch.resolve({ ...current, id: 999, title: "Stale fetch" });
    assert.equal(await stale, "superseded", "fenced before cleanup resolves");
    assert.equal(store.getNoteFromStore(999), null);
    assert.equal(store.getActiveNoteIdValue(), 7);
    assert.equal(store.getNoteFromStore(7)?.content, "Fixture content");
    await React.act(async () => cleanup.resolve({ success: false, errors: ["DB file: EBUSY"] }));
    assert.equal(h.reset().phase, "failed");
    assert.equal(store.getNoteFromStore(7)?.content, "Fixture content");
    assert.deepEqual(calls, [], "failed cleanup never relaunches");
  });
}

test("R1: confirmed successful reset fences stale fetch and retains existing relaunch", async (t) => {
  const fetch = deferred();
  const cleanup = deferred();
  const { api, calls } = fakeApi({
    getNote: () => fetch.promise,
    getNotes: async () => [],
    cleanupApp: () => cleanup.promise,
  });
  const h = await mount(t, api);
  const opening = h.noteStore.openNoteById(999);
  await React.act(async () => h.view().onReset());
  await React.act(async () => h.reset().onTypedChange("storage.reset.word"));
  await React.act(async () => {
    void h.reset().onConfirm();
  });
  await React.act(async () => cleanup.resolve({ success: true, errors: [] }));
  fetch.resolve({ id: 999, title: "Stale", space_id: 1, folder_id: null });
  assert.equal(await opening, "superseded");
  assert.equal(h.noteStore.getNoteFromStore(999), null);
  assert.equal(h.reset().phase, "done");
  await wait(1100);
  assert.deepEqual(calls, [["relaunch"]]);
});

test("R1 I2 integration: admitted reset retires tree selection and failure preserves cached content", async (t) => {
  const page = deferred();
  const requested = deferred();
  const cleanup = deferred();
  const kept = { id: 7, title: "Keep", content: "Fixture content", space_id: 1, folder_id: null };
  const cached = { ...kept, id: 8, folder_id: 3 };
  const { api, calls } = fakeApi({
    getSpaces: async () => [{ id: 1, kind: "private", name: "Personal" }],
    getFolders: async () => [{ id: 2, space_id: 1, name: "Work", is_default: 1 }],
    getFolderNoteCounts: async () => [],
    getNote: async () => kept,
    getNotes: async (_type, _limit, folderId) => {
      if (folderId === 3) return [cached];
      if (folderId !== 2) return [];
      requested.resolve();
      return page.promise;
    },
    cleanupApp: () => cleanup.promise,
  });
  const h = await mount(t, api);
  const store = h.noteStore;
  await store.initializeNotes(null, 50, 3);
  await store.openNoteById(7);
  store.navigateToContainer(1, 2);
  const tree = store.initializeNotesTree();
  await requested.promise;
  await React.act(async () => h.view().onReset());
  await React.act(async () => h.reset().onTypedChange("storage.reset.word"));
  await React.act(async () => {
    void h.reset().onConfirm();
  });
  page.resolve([{ ...kept, id: 1, folder_id: 2 }]);
  await tree;
  assert.equal(store.getActiveNoteIdValue(), null, "admission fence owns the pending tree pick");
  await React.act(async () => cleanup.resolve({ success: false, errors: ["DB file: EBUSY"] }));
  assert.equal(h.reset().phase, "failed");
  assert.equal(store.getNoteFromStore(7)?.content, "Fixture content", "held content survives");
  assert.equal(store.getNoteFromStore(8)?.content, "Fixture content", "loaded page survives");
  assert.deepEqual(calls, [], "failed cleanup never relaunches");
});

// T11-M5 (Plan 07 Task 13; fix round 1, I2): Sealed mode refused the Google
// revoke during the erase. Main also refuses relaunch-app while sealed, so the
// done state never says "restarting", offers no Restart that cannot work, and
// asks the user to quit and reopen. No relaunch is attempted.
function unhandledRejections(t) {
  const seen = [];
  const onRejection = (reason) => seen.push(reason);
  process.on("unhandledRejection", onRejection);
  t.after(() => process.off("unhandledRejection", onRejection));
  return seen;
}

// React reports a state update outside act() through console.error; collect only those (m2).
function actWarnings(t) {
  const seen = [];
  const original = console.error;
  console.error = (...args) => {
    const text = args.map(String).join(" ");
    if (text.includes("not wrapped in act(")) seen.push(text.slice(0, 120));
    else original(...args);
  };
  t.after(() => {
    console.error = original;
  });
  return seen;
}

async function runResetTo(h) {
  await React.act(async () => h.view().onReset());
  await React.act(async () => h.reset().onTypedChange("storage.reset.word"));
  await React.act(async () => h.reset().onConfirm());
  await settle();
}

test("a sealed-refused Google revoke is surfaced; the done state asks to quit and reopen, with no dead Restart", async (t) => {
  const rejections = unhandledRejections(t);
  const { api, calls } = fakeApi({
    sealed: true,
    cleanupApp: async () => ({
      success: true,
      message: "Cleanup completed",
      errors: [],
      googleGrantKept: true,
    }),
  });
  const h = await mount(t, api);
  await runResetTo(h);
  assert.equal(h.reset().phase, "done");
  assert.equal(h.reset().googleGrantKept, true);
  assert.equal(h.reset().restartBlocked, "sealed");
  assert.equal("onRestart" in h.reset(), false, "no restart action is offered");
  const html = renderToStaticMarkup(React.createElement(h.s.ResetContent, h.reset()));
  assert.ok(html.includes("sealedMode.calendar.googleGrantKept"));
  assert.ok(html.includes("storage.reset.doneSealed"));
  assert.ok(!html.includes("storage.reset.done<"), "never says Loqui is restarting");
  assert.ok(!html.includes("restartNow"));
  assert.ok(!html.includes("<button"), "no button that cannot work");
  await wait(1100);
  assert.deepEqual(calls, [], "no relaunch is attempted while sealed");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(rejections, []);
  const en = require("../../src/locales/en/translation.json").storage.reset;
  assert.doesNotMatch(en.doneSealed, /restarting/i);
  assert.match(en.doneSealed, /quit/i);
});

test("an automatic relaunch that main refuses because Sealed mode came on is caught and explained", async (t) => {
  const rejections = unhandledRejections(t);
  const { api, calls, main } = fakeApi();
  const h = await mount(t, api);
  await runResetTo(h);
  assert.equal(h.reset().phase, "done");
  assert.equal(h.reset().restartBlocked ?? null, null, "unsealed: Loqui restarts on its own");
  main.sealed = true; // sealed between the erase and the relaunch
  const warnings = actWarnings(t);
  await React.act(async () => {
    await wait(1100); // the automatic relaunch timer and its refusal land inside act
  });
  await settle();
  assert.deepEqual(warnings, [], "every state update is wrapped in act");
  assert.deepEqual(calls, [["relaunch"]]);
  assert.equal(h.reset().restartBlocked, "sealed");
  const html = renderToStaticMarkup(React.createElement(h.s.ResetContent, h.reset()));
  assert.ok(html.includes("storage.reset.doneSealed"));
  assert.ok(!html.includes("storage.reset.done<"));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(rejections, [], "the refusal is handled, not left unhandled");
});

test("any other relaunch failure is caught and asks the user to quit and reopen", async (t) => {
  const rejections = unhandledRejections(t);
  const { api } = fakeApi({
    relaunchApp: async () => {
      throw new Error("Error invoking remote method 'relaunch-app': Error: spawn EACCES");
    },
  });
  const h = await mount(t, api);
  await runResetTo(h);
  const warnings = actWarnings(t);
  await React.act(async () => {
    await wait(1100); // the automatic relaunch timer and its failure land inside act
  });
  await settle();
  assert.deepEqual(warnings, [], "every state update is wrapped in act");
  assert.equal(h.reset().restartBlocked, "failed");
  const html = renderToStaticMarkup(React.createElement(h.s.ResetContent, h.reset()));
  assert.ok(html.includes("storage.reset.restartFailed"));
  assert.ok(!html.includes("storage.reset.done<"));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(rejections, []);
});
