// Programmatic mounted integration against production TipTap/Suggestion/node views.
// Real pointer and keyboard checks are performed separately through T3 preview.
import React from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import i18next from "i18next";
import { RichTextEditor } from "../../src/components/ui/RichTextEditor";
import {
  WorkspaceNavigationProvider,
  INERT_WORKSPACE_NAVIGATION,
} from "../../src/components/workspaceNavigation";
import en from "../../src/locales/en/translation.json";

export async function runMentionRegression() {
  const i18n = i18next.createInstance();
  await i18n.init({ lng: "en", resources: { en: { translation: en } } });
  const results: string[] = [];
  const check = (condition: unknown, name: string) => {
    if (!condition) throw Error(name);
    results.push(name);
  };
  const wait = () => new Promise((resolve) => setTimeout(resolve, 90));
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const ref = { current: null } as NonNullable<
    React.ComponentProps<typeof RichTextEditor>["editorRef"]
  >;
  const original = {
    searchNotes: window.electronAPI.searchNotes,
    searchContacts: window.electronAPI.searchContacts,
    getNote: window.electronAPI.getNote,
  };
  const requests: Array<{ query: string; resolve: (v: any) => void; reject: (e: Error) => void }> =
    [];
  const previews: Array<{ id: number; resolve: (v: any) => void; reject: (e: Error) => void }> = [];
  const changes: string[] = [];
  const opens: number[] = [];
  const navigation = {
    ...INERT_WORKSPACE_NAVIGATION,
    openNote: (id: number) => {
      opens.push(id);
    },
  };
  let people = [{ name: "Local Maya", email: "maya@fixture.invalid" }];
  const render = async () => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <WorkspaceNavigationProvider value={navigation}>
          <RichTextEditor
            value=""
            editorRef={ref}
            mentionPeople={people}
            onChange={(v) => changes.push(v)}
          />
        </WorkspaceNavigationProvider>
      </I18nextProvider>
    );
    await wait();
  };
  try {
    window.electronAPI.searchContacts = async () => ({ contacts: [] }) as any;
    window.electronAPI.searchNotes = (query) =>
      new Promise((resolve, reject) => requests.push({ query, resolve, reject }));
    window.electronAPI.getNote = (id) =>
      new Promise((resolve, reject) => previews.push({ id, resolve, reject }));
    await render();
    const ed = ref.current!;
    const query = async (text: string) => {
      ed.commands.setContent(text);
      ed.commands.focus("end");
      await wait();
    };
    await query("@a");
    await query("@b");
    const row = (id: number, title: string) => ({
      id,
      title,
      content: "**Thursday**, not Monday.",
      note_type: "meeting",
      created_at: "2026-10-19",
      updated_at: "2026-10-19",
    });
    requests.find((r) => r.query === "b")!.resolve([row(38, "B result")]);
    await wait();
    check(
      document.querySelector('[role="listbox"]')?.textContent?.includes("B result"),
      "B query paints production picker"
    );
    requests.find((r) => r.query === "a")!.resolve([row(17, "A stale")]);
    await wait();
    check(
      !document.querySelector('[role="listbox"]')?.textContent?.includes("A stale"),
      "late A cannot take over B picker"
    );
    await query("@ma");
    requests.find((r) => r.query === "ma")!.reject(Error("synthetic notes failure"));
    await wait();
    check(
      document.querySelector('[role="listbox"]')?.textContent?.includes("Local Maya"),
      "source rejection retains people"
    );
    await query("@pending");
    await render(); // unchanged query + updated ref is deliberately not a visible-list refresh
    people = [{ name: "New owner", email: null }];
    await render();
    await query("@new");
    requests.find((r) => r.query === "new")!.resolve([]);
    await wait();
    check(
      document.querySelector('[role="listbox"]')?.textContent?.includes("New owner"),
      "next invocation consumes current sources ref"
    );
    ed.commands.setContent("Prefix [@A](meeting:17) suffix.");
    await wait();
    const trigger = () => host.querySelector<HTMLButtonElement>("button[data-mention]")!;
    trigger().focus();
    await wait();
    check(previews.at(-1)?.id === 17, "real node view requests preview on focus");
    ed.commands.setContent("Prefix [@B](meeting:38) suffix.");
    await wait();
    trigger().focus();
    await wait();
    previews.find((r) => r.id === 38)!.resolve(row(38, "B ready"));
    await wait();
    previews.find((r) => r.id === 17)!.resolve(row(17, "A stale ready"));
    await wait();
    check(
      host.textContent?.includes("B ready") && !host.textContent?.includes("A stale ready"),
      "deferred A cannot paint B card"
    );
    const buttons = () => [...host.querySelectorAll<HTMLButtonElement>("button")];
    buttons()
      .find((b) => b.textContent === "Insert quote")!
      .click();
    await wait();
    const md = ed.storage.markdown.getMarkdown();
    check(
      md.includes("Prefix [@B](meeting:38) suffix.") && md.includes("> Thursday, not Monday."),
      "quote inserts local block preserving paragraph prefix and suffix"
    );
    check(changes.at(-1) === md, "quote updates only document onChange");
    ed.commands.setContent("[@Failure](meeting:40)");
    await wait();
    trigger().focus();
    await wait();
    previews.at(-1)!.reject(Error("temporary"));
    await wait();
    check(
      host.textContent?.includes("could not be loaded") &&
        !host.textContent?.includes("no longer exists"),
      "rejection is unavailable, not deleted"
    );
    buttons()
      .find((b) => b.textContent === "Retry")!
      .click();
    await wait();
    check(previews.at(-1)?.id === 40, "Retry requests current entity");
    previews.at(-1)!.resolve(null);
    await wait();
    check(
      host.textContent?.includes("no longer exists") &&
        !buttons().some((b) => b.textContent === "Open"),
      "successful null is missing without Open"
    );
    ed.commands.setContent("[@Empty](meeting:41)");
    await wait();
    trigger().focus();
    await wait();
    previews.at(-1)!.resolve({ ...row(41, "Empty"), content: "" });
    await wait();
    check(
      !buttons().some((b) => b.textContent === "Insert quote"),
      "empty excerpt never constructs empty text node"
    );
    buttons()
      .find((b) => b.textContent === "Open")!
      .click();
    await wait();
    check(opens.at(-1) === 41, "production node view uses workspace navigation");
    ed.commands.setContent("[@Huge](note:9007199254740993)");
    await wait();
    const count = previews.length;
    trigger().focus();
    trigger().click();
    await wait();
    check(
      previews.length === count && opens.at(-1) === 41,
      "unsafe entity IDs are inert before numeric IPC/navigation"
    );
    await query("@unmounted");
    root.unmount();
    await wait();
    requests.find((r) => r.query === "unmounted")!.resolve([row(88, "Orphan")]);
    requests.find((r) => r.query === "pending")!.reject(Error("stale rejected query"));
    await wait();
    check(
      !document.querySelector('[role="listbox"]'),
      "unmount cancels pending source lifecycle without orphan portal"
    );
    return {
      results,
      changes: changes.length,
      requests: requests.map((r) => r.query),
      previewIds: previews.map((r) => r.id),
      opens,
    };
  } finally {
    if (ref.current) root.unmount();
    host.remove();
    Object.assign(window.electronAPI, original);
  }
}
