const path = require("node:path");
const React = require("react");
const { createRendererServer } = require("./rendererTestHarness");
const { withI18nMock } = require("./i18nTestMock");

const SRC = path.resolve(__dirname, "../../src");
const CREDENTIAL_IDS = [
  "custom:transcription",
  "custom:dictationCleanup",
  "custom:noteFormatting",
  "custom:dictationAgent",
  "custom:dictationAgentVision",
  "custom:chatIntelligence",
  "custom:dictationTranslation",
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

// A preload stand-in that answers only what route facts need: main-confirmed
// credential presence (Task 2). Everything else stays unknown (null facts).
// `saves` records [slot, field] for every acknowledged save (never the value).
function routeTestApi({ present = [], saves = [], extra = {} } = {}) {
  const fieldsFor = (id) =>
    id === "corti:speech"
      ? ["clientId", "clientSecret"]
      : id === "bedrock"
        ? ["accessKeyId", "secretAccessKey", "sessionToken"]
        : ["key"];
  const rows = new Map(
    CREDENTIAL_IDS.map((id) => [
      id,
      {
        id,
        present: present.includes(id),
        generation: 1,
        unknown: false,
        fields: Object.fromEntries(fieldsFor(id).map((field) => [field, present.includes(id)])),
      },
    ])
  );
  const listeners = new Set();
  return {
    credentials: {
      list: async () => [...rows.values()].map((row) => ({ ...row, fields: { ...row.fields } })),
      save: async (id, field, value) => {
        saves.push([id, field]);
        const before = rows.get(id);
        const fields = { ...before.fields, [field]: !!value.trim() };
        const required = fieldsFor(id).filter((name) => name !== "sessionToken");
        const row = {
          ...before,
          fields,
          present: required.every((name) => fields[name]),
          generation: before.generation + 1,
        };
        rows.set(id, row);
        for (const listener of listeners) listener({ ...row, fields: { ...fields } });
        return { ok: true, generation: row.generation };
      },
      remove: async () => ({ ok: false, error: "unused in this test" }),
      undoRemove: async () => ({ ok: false, reason: "unknown" }),
      onChanged: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    getEnterpriseRouteState: async () => ({
      current: {
        bedrockRegion: "us-east-1",
        azureEndpoint: "",
        vertexProject: "",
        vertexLocation: "us-central1",
        vertexAuthSource: "apiKey",
      },
      version: 1,
      facts: {
        bedrockEndpoint: { set: false, host: null },
        bedrockProfile: false,
        vertexApiKeyEnv: false,
        vertexProjectEnv: false,
      },
    }),
    onEnterpriseRouteChanged: () => () => {},
    ...extra,
  };
}

async function primeRouteFacts(vite) {
  const { loadRouteFacts } = await vite.ssrLoadModule("/stores/routeFactsStore.ts");
  await loadRouteFacts(globalThis.window.electronAPI);
}

async function toastCapture(vite) {
  const { ToastContext } = await vite.ssrLoadModule("/components/ui/useToast.ts");
  const toasts = [];
  const value = {
    toast: (props) => {
      toasts.push(props);
      return String(toasts.length);
    },
    dismiss() {},
    toastCount: 0,
    dictationErrorActionCount: 0,
    dismissByPresentation() {},
  };
  return {
    toasts,
    wrap: (children) => React.createElement(ToastContext.Provider, { value }, children),
  };
}

function rendererServer(t, cachePrefix, extra = {}) {
  return createRendererServer(
    t,
    withI18nMock({ cachePrefix, resolveAlias: { "@": SRC }, ...extra }, { withOptions: true })
  );
}

module.exports = { SRC, routeTestApi, primeRouteFacts, toastCapture, rendererServer };
