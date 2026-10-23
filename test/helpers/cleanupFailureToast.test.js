const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  createRendererServer,
  installBrowserGlobals,
  installHookDom,
} = require("../lib/rendererTestHarness");

test("cleanup notice localizes AWS details and links to the actual cleanup section", async (t) => {
  let root = null;
  t.after(async () => {
    if (root) await React.act(async () => root.unmount());
  });
  const settingsLinks = [],
    copied = [];
  let copySuccess = false;
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        writeClipboard: async (text) => {
          copied.push(text);
          return { success: copySuccess };
        },
        openSettingsAt: async (path) => {
          settingsLinks.push(path);
          return { delivered: true };
        },
      },
    },
  });
  const container = installHookDom(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-cleanup-failure-toast-",
    mockModules: {
      "/lib/routes": `export const useResolvedRoute = () => ({ settingsPath: "llms/dictationCleanup" });`,
      "/utils/windowContext": `
        export const isDictationPanelWindow = () => false;
      `,
    },
  });
  const { default: CleanupFailureNoticeListener } = await vite.ssrLoadModule(
    "/components/CleanupFailureNoticeListener.tsx"
  );
  const notices = await vite.ssrLoadModule("/components/ui/notices.ts");
  notices.__setNoticeClockForTests();
  t.after(() => notices.__setNoticeClockForTests());
  const { default: i18n } = await vite.ssrLoadModule("/i18n.ts");
  await i18n.changeLanguage("es");
  const { recordCleanupFailure, useCleanupFailureStore } = await vite.ssrLoadModule(
    "/stores/cleanupFailureStore.ts"
  );
  useCleanupFailureStore.setState({ pending: 0, lastMessage: "", lastFailure: null });

  root = createRoot(container);
  await React.act(async () => root.render(React.createElement(CleanupFailureNoticeListener)));

  const failure = {
    message:
      "AWS Bedrock is temporarily unavailable due to high demand. Please try again in a few minutes.",
    messageKey: "reasoning.enterprise.errors.bedrock.serviceUnavailable",
    action: "Run the command below in your terminal to re-authenticate:",
    actionKey: "reasoning.enterprise.errors.bedrock.actions.reauthenticate",
    copyCommand: "aws sso login --profile company-sso",
    technicalDetails: {
      status: 503,
      exceptionType: "ServiceUnavailableException",
      requestId: "aws-request-503",
      underlyingError: "Bedrock overloaded",
    },
  };
  await React.act(async () => recordCleanupFailure(failure));

  const [notice] = notices.getNotices();
  assert.equal(notice.kind, "notice");
  assert.equal(notice.title, "Pegado sin limpieza");
  assert.match(notice.body, /AWS Bedrock no está disponible/);
  assert.deepEqual(notice.details, failure.technicalDetails);
  assert.equal(
    notice.actions.length,
    2,
    "no raw words means Settings and command Copy, never Retry"
  );
  assert.match(notice.body, /Ejecuta el siguiente comando/);
  assert.ok(
    notice.body.includes(failure.copyCommand),
    "the exact command remains selectable in More"
  );
  const commandAction = notice.actions.find(
    (a) => a.label === i18n.t("reasoning.enterprise.technicalDetails.copyCommand")
  );
  assert.equal(commandAction.keepOpen, true);
  await notices.runNoticeAction(notice.id, commandAction);
  assert.ok(
    notices.getNotices().some((n) => n.id === notice.id),
    "failed command Copy keeps the source notice"
  );
  assert.equal(notices.getNotices().find((n) => n.id === "cleanup-command-copy").kind, "alert");
  copySuccess = true;
  await notices.runNoticeAction(notice.id, commandAction);
  assert.ok(
    notices.getNotices().some((n) => n.id === notice.id),
    "successful command Copy also keeps the source notice"
  );
  assert.equal(notices.getNotices().find((n) => n.id === "cleanup-command-copy").kind, "receipt");
  assert.deepEqual(
    copied,
    [failure.copyCommand, failure.copyCommand],
    "command text is copied exactly and never executed"
  );
  await notices.runNoticeAction(notice.id, notice.actions[0]);
  assert.deepEqual(settingsLinks, ["llms/dictationCleanup"]);
  assert.equal(useCleanupFailureStore.getState().pending, 0);
  notices.__setNoticeClockForTests();
  copied.length = 0;
  const received = [];
  const capturedFailure = {
    message: "timed out",
    rawText: "original raw words",
    retryCleanup: async (raw) => {
      received.push(raw);
      return "Cleaned original words";
    },
  };
  await React.act(async () => recordCleanupFailure(capturedFailure));
  capturedFailure.rawText = "new recording words";
  capturedFailure.retryCleanup = async () => {
    throw new Error("live operation must not run");
  };
  const [retryNotice] = notices.getNotices();
  await notices.runNoticeAction(retryNotice.id, retryNotice.actions[0]);
  assert.deepEqual(
    received,
    ["original raw words"],
    "the listener captures raw words and operation together before Retry yields"
  );
  assert.deepEqual(copied, ["Cleaned original words"]);
  assert.equal(notices.getNotices()[0].kind, "receipt");
});

test("technical AWS details use the selected UI language", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-technical-error-details-",
  });
  const { TechnicalErrorDetails } = await vite.ssrLoadModule(
    "/components/ui/TechnicalErrorDetails.tsx"
  );
  const { default: i18n } = await vite.ssrLoadModule("/i18n.ts");
  await i18n.changeLanguage("es");

  const markup = renderToStaticMarkup(
    React.createElement(TechnicalErrorDetails, {
      details: {
        status: 503,
        exceptionType: "ServiceUnavailableException",
        requestId: "request-123",
        underlyingError: "Bedrock overloaded",
      },
    })
  );

  assert.match(markup, /Detalles técnicos/);
  assert.match(markup, /Estado HTTP: 503/);
  assert.match(markup, /Excepción de AWS: ServiceUnavailableException/);
  assert.match(markup, /ID de solicitud de AWS: request-123/);
  assert.match(markup, /Error subyacente: Bedrock overloaded/);
  assert.match(markup, /aria-label="Copiar detalles técnicos"/);
});
