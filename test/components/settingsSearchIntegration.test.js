const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { createRoot } = require("react-dom/client");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");
const { withI18nMock } = require("../lib/i18nTestMock");

function find(node, predicate) {
  if (Array.isArray(node)) return node.map((item) => find(item, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join("|");
  if (node && typeof node === "object") return text(node.props?.children);
  return typeof node === "string" ? node : "";
}

// Actual modal, page, private LlmsTabs/useSubTab and LocalSupportModels all run inside
// mounted probes. Only unrelated hooks/native APIs are fixtures. No host layout is simulated:
// anchor lookup below exposes a fixture only when the actual page/tab tree makes it visible.
async function mount(t, initialSection = "llms/supportModels", assistantEnabled = false) {
  let root;
  const previousTranslate = globalThis.__task16Translate;
  globalThis.__task16Translate = (key) => key;
  t.after(() => {
    globalThis.__task16Translate = previousTranslate;
  });
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  let statusReads = 0;
  let permissionRequests = 0;
  let listenerAdds = 0;
  let listenerRemoves = 0;
  let releaseStatus;
  let releaseDownload;
  const pendingStatus = new Promise((r) => {
    releaseStatus = r;
  });
  const pendingDownload = new Promise((r) => {
    releaseDownload = r;
  });
  installBrowserGlobals(t, {
    initialStorage: {
      transcriptionMode: "providers",
      useLocalWhisper: "false",
      uploadTranscriptionMode: "providers",
      uploadUseLocalWhisper: "false",
    },
    window: {
      electronAPI: {
        onLinuxPttPermissionDenied: () => {
          listenerAdds++;
          return () => {
            listenerRemoves++;
          };
        },
        getAppVersion: async () => ({ version: "fixture" }),
        getDiarizationModelStatus: () => {
          statusReads++;
          return pendingStatus;
        },
        getSearchModelStatus: async () => ({ downloaded: true }),
        downloadDiarizationModels: () => pendingDownload,
      },
    },
  });
  const container = installHookDom(t);
  const queue = new Map();
  let frame = 0;
  globalThis.requestAnimationFrame = (cb) => {
    queue.set(++frame, cb);
    return frame;
  };
  globalThis.cancelAnimationFrame = (id) => queue.delete(id);
  const vite = await createRendererServer(
    t,
    withI18nMock(
      {
        cachePrefix: "loqui-settings-search-integration-",
        resolveAlias: { "@": require("node:path").resolve(__dirname, "../../src") },
        mockModules: {
          "/ui/useToast":
            "const toast = () => {}; export function useToast() { return { toast }; }",
          "/ui/SidebarModal": "export default function SidebarModal() { return null; }",
          "/hooks/useSettings":
            "import { useSettingsStore } from '/stores/settingsStore.ts'; export function useSettings() { return useSettingsStore(); }",
          "/hooks/useWhisper":
            "const checkWhisperInstallation = () => {}; export function useWhisper() { return { checkWhisperInstallation }; }",
          "/hooks/useScreenRecordingPermission":
            "export function useScreenRecordingPermission() { return { supported: true, granted: false, request: () => globalThis.__task16PermissionRequest() }; }",
          "/hooks/usePermissions": "export function usePermissions() { return {}; }",
          "/hooks/useSystemAudioPermission":
            "export function useSystemAudioPermission() { return {}; }",
          "/hooks/useClipboard": "export function useClipboard() {}",
          "/hooks/useStartOnboarding": "export function useStartOnboarding() { return () => {}; }",
          "/hooks/useTheme":
            "export function useTheme() { return { theme: 'light', setTheme() {} }; }",
          "/hooks/useHotkeyRegistration": "export function useHotkeyRegistration() { return {}; }",
          "/hooks/useHotkeyModeInfo": "export function useHotkeyModeInfo() { return {}; }",
        },
      },
      { t: "globalThis.__task16Translate" }
    )
  );
  const previousRequest = globalThis.__task16PermissionRequest;
  globalThis.__task16PermissionRequest = () => {
    permissionRequests++;
  };
  t.after(() => {
    globalThis.__task16PermissionRequest = previousRequest;
  });
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  useSettingsStore.setState({ useDictationAgent: assistantEnabled });
  const beforeRoute = () => {
    const s = useSettingsStore.getState();
    return [s.useDictationAgent, s.voiceAgentScreenContext, s.useDictationAgentVisionModel];
  };
  const { SETTINGS_REGISTRY } = await vite.ssrLoadModule(
    "/components/settings/settingsRegistry.ts"
  );
  const Modal = (await vite.ssrLoadModule("/components/SettingsModal.tsx")).default;
  let modal, page, tabs, support, agent;
  let pageMounts = 0,
    supportMounts = 0,
    supportUnmounts = 0;
  let props = { open: true, onOpenChange() {}, initialSection };
  function SupportProbe({ node }) {
    support = node.type(node.props);
    React.useEffect(() => {
      supportMounts++;
      return () => {
        supportUnmounts++;
      };
    }, []);
    return null;
  }
  function AgentProbe({ node }) {
    agent = node.type(node.props);
    return null;
  }
  function TabsProbe({ node }) {
    tabs = node.type(node.props);
    const supportNode = find(tabs, (n) => n.type?.name === "LocalSupportModels");
    const agentNode = find(tabs, (n) => n.type?.name === "DictationAgentSettings");
    return React.createElement(
      React.Fragment,
      null,
      supportNode ? React.createElement(SupportProbe, { node: supportNode }) : null,
      agentNode ? React.createElement(AgentProbe, { node: agentNode }) : null
    );
  }
  function PageProbe({ node }) {
    page = node.type(node.props);
    React.useEffect(() => {
      pageMounts++;
    }, []);
    const tabNode = find(page, (n) => n.type?.name === "LlmsTabs");
    return tabNode ? React.createElement(TabsProbe, { node: tabNode }) : null;
  }
  function Probe() {
    modal = Modal(props);
    const pageNode = find(modal, (n) => "onNavigateToSection" in (n.props ?? {}));
    return pageNode ? React.createElement(PageProbe, { node: pageNode }) : null;
  }
  const anchorListeners = new Map();
  const anchor = {
    dataset: {},
    scrolled: [],
    scrollIntoView(o) {
      this.scrolled.push(o);
    },
    addEventListener(type, listener) {
      anchorListeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (anchorListeners.get(type) === listener) anchorListeners.delete(type);
    },
  };
  const agentAnchors = Object.fromEntries(
    ["assistantEnabled", "screenContext"].map((id) => [
      id,
      { ...anchor, dataset: {}, scrolled: [] },
    ])
  );
  const selected = () => find(tabs, (n) => "selectedId" in (n.props ?? {})).props;
  globalThis.document.querySelector = (selector) => {
    if (
      selector === '[data-setting-id="supportModels"]' &&
      selected().selectedId === "supportModels" &&
      !modal.props.search?.props.value
    )
      return anchor;
    if (tabs && selected().selectedId === "dictationAgent" && !modal.props.search?.props.value) {
      for (const id of ["assistantEnabled", "screenContext"]) {
        if (
          selector === `[data-setting-id="${id}"]` &&
          find(agent, (n) => n.props?.settingId === id)
        )
          return agentAnchors[id];
      }
    }
    return null;
  };
  root = createRoot(container);
  const render = () => React.act(async () => root.render(React.createElement(Probe)));
  await render();
  return {
    modal: () => modal.props,
    page: () => page,
    selected,
    support: () => support,
    anchor,
    anchorListeners,
    pendingFrames: () => queue.size,
    agentAnchors,
    beforeRoute,
    permissions: () => permissionRequests,
    stats: () => ({
      pageMounts,
      supportMounts,
      supportUnmounts,
      statusReads,
      listenerAdds,
      listenerRemoves,
    }),
    releaseStatus,
    releaseDownload,
    query: (q) => React.act(async () => modal.props.search.props.onChange(q)),
    jump: (id = "supportModels") =>
      React.act(async () =>
        find(modal, (n) => "onJump" in (n.props ?? {})).props.onJump(
          SETTINGS_REGISTRY.find((entry) => entry.id === id)
        )
      ),
    frames: (count = 24) =>
      React.act(async () => {
        for (let i = 0; i < count; i++) {
          const pending = [...queue];
          queue.clear();
          for (const [, cb] of pending) cb();
        }
      }),
    unmount: async () => {
      await React.act(async () => root.unmount());
      root = null;
    },
    close: async () => {
      props = { ...props, open: false };
      await render();
    },
  };
}

test("[change-driving] repeated search activation restores the actual hand-switched sub-tab and lands again", async (t) => {
  const h = await mount(t);
  assert.equal(h.selected().selectedId, "supportModels");
  for (let i = 0; i < 2; i++) {
    await React.act(async () => h.selected().onSelect("dictationCleanup"));
    assert.equal(h.selected().selectedId, "dictationCleanup");
    await h.query("speaker");
    await h.jump();
    assert.equal(
      h.selected().selectedId,
      "supportModels",
      "actual useSubTab must consume every activation"
    );
    await h.frames();
    assert.equal(h.anchor.scrolled.length, i + 1);
    assert.equal(h.anchor.dataset.flash, "true");
  }
  await h.close();
  assert.equal(h.anchor.dataset.flash, undefined, "close cancels the owned flash");
});

test("[change-driving] actual query toggles preserve mounted support-model status and pending download state", async (t) => {
  const h = await mount(t);
  assert.match(text(h.support()), /supportModels.checking/);
  assert.ok(h.modal().search, "the modal supplies search");
  await h.query("mic");
  const hiddenPage = find(h.modal().children, (n) => n.props?.className === "hidden");
  assert.ok(hiddenPage, "the existing page is hidden while results show");
  assert.deepEqual(h.stats(), {
    pageMounts: 1,
    supportMounts: 1,
    supportUnmounts: 0,
    // One LocalSupportModels read plus Agent's real useResolvedRoute facts subscription.
    statusReads: 2,
    listenerAdds: 1,
    listenerRemoves: 0,
  });
  await React.act(async () => h.releaseStatus({ modelsDownloaded: false }));
  await h.query("");
  const button = find(h.support(), (n) => typeof n.props?.onClick === "function");
  await React.act(async () => button.props.onClick());
  assert.match(text(h.support()), /personal.downloading/);
  await h.query("mic");
  await h.query("");
  assert.match(
    text(h.support()),
    /personal.downloading/,
    "pending fixture operation survives the actual query transitions"
  );
  assert.deepEqual(h.stats(), {
    pageMounts: 1,
    supportMounts: 1,
    supportUnmounts: 0,
    // One LocalSupportModels read plus Agent's real useResolvedRoute facts subscription.
    statusReads: 2,
    listenerAdds: 1,
    listenerRemoves: 0,
  });
  await React.act(async () => h.releaseDownload({ success: true }));
  assert.match(text(h.support()), /supportModels.downloaded/);
});

test("[change-driving] latest jump and unmount cancel stale landing frames and owned cues", async (t) => {
  const h = await mount(t);
  await h.query("speaker");
  await h.jump();
  await h.query("speaker");
  await h.jump();
  await h.frames();
  assert.equal(h.anchor.scrolled.length, 1, "only the latest queued landing runs");
  assert.equal(h.anchor.dataset.flash, "true");
  await h.unmount();
  assert.equal(h.anchor.dataset.flash, undefined);
  assert.equal(h.stats().listenerRemoves, 1);
  await h.frames();
  assert.equal(h.anchor.scrolled.length, 1);
});

test("[change-driving] actual rehomed Dictation anchors identify their own labelled rows", async (t) => {
  const h = await mount(t, "hotkeys");
  for (const [id, label] of [
    ["autoLearn", "settingsPage.dictionary.autoLearnTitle"],
    ["autoPaste", "settingsPage.general.clipboard.autoPaste"],
    ["keepInClipboard", "settingsPage.general.clipboard.keepInClipboard"],
    ["transcriptionLanguage", "settings.language.transcriptionLabel"],
  ]) {
    const row = find(h.page(), (node) => node.props?.settingId === id);
    assert.ok(row, id);
    assert.ok(
      find(row, (node) => node.props?.label === label),
      `${id} anchors the matching row`
    );
  }
  for (const id of ["dictationHotkey", "microphone"])
    assert.ok(
      find(h.page(), (node) => node.props?.["data-setting-id"] === id),
      id
    );
});

test("[change-driving] gated screen-context result cues the real assistant prerequisite only after 24 frames", async (t) => {
  const h = await mount(t, "llms/dictationAgent", false);
  const before = h.beforeRoute();
  await h.query("screen");
  await h.jump("screenContext");
  await h.frames(23);
  assert.equal(h.agentAnchors.assistantEnabled.scrolled.length, 0);
  await h.frames(1);
  assert.equal(h.agentAnchors.assistantEnabled.scrolled.length, 1);
  assert.equal(h.agentAnchors.assistantEnabled.dataset.flash, "true");
  assert.equal(h.agentAnchors.screenContext.scrolled.length, 0);
  assert.deepEqual(h.beforeRoute(), before);
  assert.equal(h.permissions(), 0);
  await h.close();
  assert.equal(h.agentAnchors.assistantEnabled.dataset.flash, undefined);
});

test("[baseline guard] enabled assistant lands on the real screen-context row without fallback or writes", async (t) => {
  const h = await mount(t, "llms/dictationAgent", true);
  const before = h.beforeRoute();
  await h.query("screen");
  await h.jump("screenContext");
  await h.frames();
  assert.equal(h.agentAnchors.screenContext.scrolled.length, 1);
  assert.equal(h.agentAnchors.screenContext.dataset.flash, "true");
  assert.equal(h.agentAnchors.assistantEnabled.scrolled.length, 0);
  assert.deepEqual(h.beforeRoute(), before);
  assert.equal(h.permissions(), 0);
});

test("[baseline guard] closing during the gated-row wait cancels the prerequisite fallback", async (t) => {
  const h = await mount(t, "llms/dictationAgent", false);
  await h.query("screen");
  await h.jump("screenContext");
  await h.frames(10);
  await h.close();
  await h.frames();
  assert.equal(h.agentAnchors.assistantEnabled.scrolled.length, 0);
  assert.equal(h.agentAnchors.assistantEnabled.dataset.flash, undefined);
});

test("[change-driving FIX1] actual modal query hiding and direct clearing retire its landed cue without remounting", async (t) => {
  const h = await mount(t);
  await h.query("speaker");
  await h.jump();
  await h.frames();
  assert.equal(h.anchor.dataset.flash, "true");
  assert.equal(h.anchorListeners.size, 1);
  await h.query("mic");
  assert.ok(find(h.modal().children, (node) => node.props?.className === "hidden"));
  assert.equal(
    h.anchor.dataset.flash,
    undefined,
    "the actual hidden wrapper has no owned cue to replay"
  );
  assert.equal(h.anchorListeners.size, 0);
  await h.query("");
  await h.frames();
  assert.equal(h.anchor.dataset.flash, undefined);
  assert.equal(h.anchor.scrolled.length, 1);
  assert.equal(h.stats().pageMounts, 1);
  assert.equal(h.stats().supportMounts, 1);
  assert.equal(h.stats().supportUnmounts, 0);
});

test("[change-driving FIX1] actual modal query hides before pending landing and direct clear never relands", async (t) => {
  const h = await mount(t);
  await h.query("speaker");
  await h.jump();
  assert.equal(h.pendingFrames(), 1);
  await h.query("mic");
  assert.equal(h.pendingFrames(), 0);
  await h.query("");
  await h.frames();
  assert.equal(h.anchor.scrolled.length, 0);
  assert.equal(h.anchor.dataset.flash, undefined);
  assert.equal(h.anchorListeners.size, 0);
});
