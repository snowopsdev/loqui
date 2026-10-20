// Mounted browser regression. Import into the production-CSS fixture and await
// runSlashContextRegression(); no mocked editor, suggestion plugin or popup.
import React from "react";
import { createRoot } from "react-dom/client";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import { RichTextEditor, type RichTextEditorProps } from "../../src/components/ui/RichTextEditor";
import { SLASH_PLUGIN_KEY } from "../../src/components/ui/editor/SlashCommand";
import { slashReadiness } from "../../src/components/ui/editor/slashItems";
import en from "../../src/locales/en/translation.json";
import ar from "../../src/locales/ar/translation.json";

export async function runSlashContextRegression() {
  const i18n = i18next.createInstance();
  await i18n.init({ lng: "en", resources: { en: { translation: en }, ar: { translation: ar } } });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const editorRef: NonNullable<RichTextEditorProps["editorRef"]> = { current: null };
  const calls: unknown[] = [];
  const results: Array<{ name: string; pass: boolean; before: unknown; after: unknown }> = [];
  const actions = [
    {
      id: 7,
      name: "Pricing digest",
      prompt: "Synthetic only",
      sort_order: 0,
      description: "Synthetic action",
      icon: "",
      is_builtin: 0,
      translation_key: null,
      created_at: "2026-10-19",
      updated_at: "2026-10-19",
    },
  ];
  let slash: NonNullable<RichTextEditorProps["slash"]> = {
    actions,
    ...slashReadiness({ status: "ready" }, i18n.t.bind(i18n)),
    onRunAction: (id) => calls.push(["action", id]),
    onSetupAi: () => calls.push(["setup"]),
    onManageActions: () => calls.push(["manage"]),
    onDictateHere: () => calls.push(["dictate"]),
  };
  let draft = "Owner 9 draft";
  const settle = () => new Promise((resolve) => setTimeout(resolve, 80));
  const render = async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <RichTextEditor
          value={draft}
          editorRef={editorRef}
          slash={slash}
          onChange={(value) => {
            draft = value;
            calls.push(["change", value]);
          }}
        />
      </I18nextProvider>
    );
    await settle();
  };
  try {
    await render();
    const editor = editorRef.current!;
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(" /ai");
    await settle();
    const snapshot = () => ({
      doc: editor.getJSON(),
      draft,
      selection: editor.state.selection.toJSON(),
      sameEditor: editorRef.current === editor,
      queryText: editor.state.doc.textContent,
      plugin: SLASH_PLUGIN_KEY.getState(editor.state),
      rows: [...document.querySelectorAll('[data-editor-chrome] [role="option"]')].map((row) => ({
        text: row.textContent,
        disabled: row.getAttribute("aria-disabled"),
      })),
      portals: document.querySelectorAll("[data-editor-chrome]").length,
      calls: [...calls],
    });
    // Reinvoke the existing query by moving the caret out/back; never edit the draft.
    const reopen = async () => {
      const pos = editor.state.selection.from;
      editor.commands.setTextSelection(1);
      editor.commands.setTextSelection(pos);
      await settle();
    };
    const change = async (name: string, update: () => void | Promise<unknown>) => {
      await reopen();
      const before = snapshot();
      const oldRow = document.querySelector<HTMLElement>(
        '[data-editor-chrome] [role="option"]:not([aria-disabled])'
      );
      const propsKey = oldRow && Object.keys(oldRow).find((key) => key.startsWith("__reactProps$"));
      const lateClick = propsKey ? oldRow[propsKey].onClick : null;
      await update();
      await render();
      const after = snapshot();
      const preserved =
        after.sameEditor &&
        JSON.stringify(before.doc) === JSON.stringify(after.doc) &&
        JSON.stringify(before.selection) === JSON.stringify(after.selection) &&
        before.draft === after.draft &&
        JSON.stringify(before.calls) === JSON.stringify(after.calls);
      results.push({
        name,
        pass:
          preserved &&
          before.plugin.active &&
          before.portals === 1 &&
          !after.plugin.active &&
          after.portals === 0,
        before,
        after,
      });
      if (name === "action removal" || (name === "route -> unknown" && lateClick)) {
        lateClick?.();
        await settle();
        const late = snapshot();
        results.push({
          name: `${name}: dequeued old callback stays safe after dismissal`,
          pass:
            !!lateClick &&
            JSON.stringify(late.doc) === JSON.stringify(after.doc) &&
            JSON.stringify(late.calls) === JSON.stringify(after.calls),
          before: after,
          after: late,
        });
      }
      await reopen();
      const reopened = snapshot();
      const expected = slashReadiness(
        slash.aiAvailable
          ? { status: "ready" }
          : slash.aiNeedsSetup
            ? { status: "needsKey", provider: "openai" }
            : { status: "unknown" },
        i18n.t.bind(i18n)
      );
      results.push({
        name: `${name}: reopen current without editing draft`,
        pass:
          reopened.sameEditor &&
          reopened.plugin.active &&
          reopened.plugin.query === "ai" &&
          reopened.draft === before.draft &&
          JSON.stringify(reopened.doc) === JSON.stringify(before.doc) &&
          reopened.rows.length === slash.actions.length + Number(slash.aiNeedsSetup) &&
          slash.actions.every((action) =>
            reopened.rows.some(
              (row) =>
                row.text ===
                  action.name + (slash.aiAvailable ? "" : expected.aiUnavailableReason) &&
                (slash.aiAvailable ? !row.disabled : row.disabled === "true")
            )
          ) &&
          reopened.rows.some((row) => row.text === i18n.t("notes.slash.setupAi")) ===
            slash.aiNeedsSetup,
        before: after,
        after: reopened,
      });
    };
    for (const status of ["unknown", "needsKey", "unknown", "needsKey", "ready"] as const) {
      await change(`route -> ${status}`, () => {
        slash = {
          ...slash,
          ...slashReadiness(
            status === "needsKey" ? { status, provider: "openai" } : { status },
            i18n.t.bind(i18n)
          ),
        };
      });
    }
    await change("action edit", () => {
      slash = {
        ...slash,
        actions: [{ ...actions[0], name: "Edited digest", prompt: "Edited synthetic" }],
      };
    });
    await change("action removal", () => {
      slash = { ...slash, actions: [] };
    });
    await change("restore action", () => {
      slash = { ...slash, actions };
    });
    await change("prepare unavailable locale", () => {
      slash = {
        ...slash,
        ...slashReadiness({ status: "needsKey", provider: "openai" }, i18n.t.bind(i18n)),
      };
    });
    await change("locale change", async () => {
      await i18n.changeLanguage("ar");
      // The parent Notes boundary supplies the translated readiness reason.
      slash = {
        ...slash,
        ...slashReadiness({ status: "needsKey", provider: "openai" }, i18n.t.bind(i18n)),
      };
    });
    await change("restore ready after locale", () => {
      slash = { ...slash, ...slashReadiness({ status: "ready" }, i18n.t.bind(i18n)) };
    });
    await reopen();
    const before = snapshot();
    slash = {
      ...slash,
      actions: [...slash.actions],
      onRunAction: (id) => calls.push(["latest", id]),
    };
    await render();
    const after = snapshot();
    results.push({
      name: "equivalent context rerender keeps popup usable",
      pass:
        after.plugin.active &&
        after.portals === 1 &&
        after.sameEditor &&
        JSON.stringify(after.doc) === JSON.stringify(before.doc),
      before,
      after,
    });
    const selected = document.querySelector('[data-editor-chrome] [role="option"]');
    selected?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    results.push({
      name: "only explicit ready choice invokes latest callback once",
      pass:
        calls.filter((call) => Array.isArray(call) && call[0] === "latest").length === 1 &&
        !editor.state.doc.textContent.includes("/ai"),
      before: after,
      after: snapshot(),
    });
    // Change context immediately after triggering, then settle the asynchronous
    // suggestion/portal lifecycle. No delayed provider request is simulated.
    editor.commands.insertContent(" /ai");
    slash = { ...slash, ...slashReadiness({ status: "unknown" }, i18n.t.bind(i18n)) };
    await render();
    results.push({
      name: "immediate context change leaves no late popup",
      pass:
        !SLASH_PLUGIN_KEY.getState(editor.state).active &&
        document.querySelectorAll("[data-editor-chrome]").length === 0,
      before: null,
      after: snapshot(),
    });
    await reopen();
    const beforeRemoval = snapshot();
    const savedSlash = slash;
    slash = undefined;
    await render();
    const afterRemoval = snapshot();
    results.push({
      name: "context removal dismisses without document change",
      pass:
        afterRemoval.sameEditor &&
        !afterRemoval.plugin.active &&
        afterRemoval.portals === 0 &&
        JSON.stringify(beforeRemoval.doc) === JSON.stringify(afterRemoval.doc) &&
        JSON.stringify(beforeRemoval.selection) === JSON.stringify(afterRemoval.selection) &&
        JSON.stringify(beforeRemoval.calls) === JSON.stringify(afterRemoval.calls),
      before: beforeRemoval,
      after: afterRemoval,
    });
    slash = savedSlash;
    await render();
    await reopen();
    root.unmount();
    await settle();
    results.push({
      name: "unmount cleans popup and editor",
      pass:
        editor.isDestroyed &&
        editorRef.current === null &&
        document.querySelectorAll("[data-editor-chrome]").length === 0,
      before: after,
      after: {
        destroyed: editor.isDestroyed,
        portals: document.querySelectorAll("[data-editor-chrome]").length,
        calls,
      },
    });
    return { pass: results.every((result) => result.pass), results };
  } finally {
    root.unmount();
    host.remove();
  }
}
