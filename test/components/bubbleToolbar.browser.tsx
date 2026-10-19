// Run explicitly in the production-CSS browser fixture; npm does not discover this module.
import React from "react";
import { createRoot } from "react-dom/client";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import { RichTextEditor, type RichTextEditorProps } from "../../src/components/ui/RichTextEditor";
import en from "../../src/locales/en/translation.json";

export async function runBubbleToolbarRegression() {
  const i18n = i18next.createInstance();
  await i18n.init({ lng: "en", resources: { en: { translation: en } } });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const editorRef: NonNullable<RichTextEditorProps["editorRef"]> = { current: null };
  const results: Array<{ name: string; pass: boolean; actual?: unknown }> = [];
  const asks: string[] = [];
  let markdown = "";
  let disabled = false;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 350));
  const render = async (value: string) => {
    root.render(
      <I18nextProvider i18n={i18n}>
        <RichTextEditor
          value={value}
          editorRef={editorRef}
          mentionPeople={[]}
          disabled={disabled}
          onChange={(value) => {
            markdown = value;
          }}
          onAskAi={(text) => asks.push(text)}
        />
      </I18nextProvider>
    );
    await settle();
  };
  const check = (name: string, pass: boolean, actual?: unknown) =>
    results.push({ name, pass, actual });
  const bubble = () => document.querySelector<HTMLElement>(".bubble-toolbar");
  const visible = () => !!bubble() && getComputedStyle(bubble()!).visibility !== "hidden";
  const button = (name: string) =>
    [...bubble()!.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.getAttribute("aria-label") === name || b.textContent === name
    )!;
  const select = async (from = 1, to = 11) => {
    editorRef.current!.commands.focus();
    editorRef.current!.commands.setTextSelection({ from, to });
    await settle();
  };
  const click = async (name: string) => {
    button(name).click();
    await settle();
  };
  const field = () => bubble()!.querySelector<HTMLInputElement>("input")!;
  const enterHref = async (href: string) => {
    const input = field();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, href);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    field().form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
  };
  try {
    await render("Hello safe selection");
    await select();
    check("nonempty selection shows the real BubbleMenu", visible());
    await click("Bold");
    await click("Italic");
    check(
      "bold and italic pressed states follow real transactions",
      button("Bold").getAttribute("aria-pressed") === "true" &&
        button("Italic").getAttribute("aria-pressed") === "true"
    );
    check(
      "formatting serializes to Markdown",
      /\*\*|__/.test(markdown) && /\*/.test(markdown),
      markdown
    );
    const formatted = markdown;
    editorRef.current!.commands.setContent(formatted);
    await select();
    check(
      "formatting survives Markdown reload",
      editorRef.current!.isActive("bold") && editorRef.current!.isActive("italic")
    );
    await click("Link");
    check(
      "URL field is LTR with both required focus classes",
      field().dir === "ltr" &&
        field().classList.contains("focus-visible:ring-2") &&
        field().classList.contains("focus-visible:ring-ring")
    );
    await enterHref("java\tscript:alert(1)");
    check(
      "unsafe href is refused with localized error and retained field focus",
      field().getAttribute("aria-invalid") === "true" &&
        bubble()!.textContent!.includes("Use a web or email address") &&
        document.activeElement === field()
    );
    await enterHref("example.invalid/path");
    check(
      "bare domain applies only a safe normalized href",
      editorRef.current!.getAttributes("link").href === "https://example.invalid/path",
      markdown
    );
    await click("Link");
    await enterHref("");
    check("empty URL removes link", !editorRef.current!.isActive("link"), markdown);
    await click("Ask AI");
    check("Ask hands selected text to caller once", asks.length === 1 && !!asks[0].trim(), asks);
    const legacy = [
      "../relative",
      "#anchor",
      "tel:+12345",
      "ftp://example.invalid/file",
      "mention:ada%40fixture.invalid",
    ];
    editorRef.current!.commands.setContent(
      legacy
        .map((href, i) => `[${href.startsWith("mention:") ? "@Ada" : `legacy${i}`}](${href})`)
        .join("\n\n")
    );
    await settle();
    const saved = (editorRef.current!.storage as any).markdown.getMarkdown();
    check(
      "default Link load/save policy preserves all legacy hrefs",
      legacy.every((href) => saved.includes(`](${href})`)),
      saved
    );
    editorRef.current!.commands.setContent("````\ncode selection\n````");
    await select(1, 5);
    check("code block selection shows no toolbar", !visible());
    editorRef.current!.commands.setContent("Hello safe selection");
    await select(1, 1);
    check("empty selection shows no toolbar", !visible());
    await select();
    disabled = true;
    await render("Hello safe selection");
    check("disabled editor unmounts toolbar", !bubble());
    const editor = editorRef.current!;
    root.unmount();
    await settle();
    check(
      "unmount destroys editor, BubbleMenu and chrome",
      editor.isDestroyed &&
        editorRef.current === null &&
        !document.querySelector("[data-editor-chrome]")
    );
    return { pass: results.every((r) => r.pass), results };
  } finally {
    root.unmount();
    host.remove();
  }
}
