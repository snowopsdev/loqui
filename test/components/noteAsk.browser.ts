// Explicit browser regression for the faithful production ControlPanel fixture.
// Boundary supplies only synthetic preload data/provider completion, never hook/composer mocks.
import type { Editor } from "@tiptap/react";

interface NoteAskBoundary {
  unmount(): void;
  mountWorkspace(): void;
  openNote(id: number): Promise<void>;
  completeStream(text?: string): void;
  streamRequests: unknown[];
  savedChatRows: unknown[];
}
interface FixtureHealth {
  calls: Array<[string, ...any[]]>;
  errors: unknown[];
  rejections: unknown[];
  console: unknown[];
}
export async function runNoteAskRegression(
  task16Fixture: NoteAskBoundary,
  fixtureHealth: FixtureHealth
) {
  const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));
  const results: Array<{ name: string; pass: boolean; actual?: unknown }> = [];
  const check = (name: string, pass: boolean, actual?: unknown) =>
    results.push({ name, pass, actual });
  const click = (label: string) => {
    const b = [...document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === label || b.textContent === label
    );
    if (!b) throw Error("missing button " + label);
    b.click();
  };
  const input = () =>
    document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Type a message..."]')!;
  const type = async (text: string) => {
    const e = input();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(e, text);
    e.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
  };
  const enter = async () => {
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true })
    );
    await settle(250);
  };
  const ask = async () => {
    const e = document.querySelector<HTMLElement & { editor: Editor }>(
      ".rich-text-editor-content"
    )!.editor;
    e.commands.focus();
    e.commands.setTextSelection({ from: 56, to: 72 });
    await settle(350);
    const b = [...document.querySelectorAll<HTMLButtonElement>(".bubble-toolbar button")].find(
      (b) => b.textContent === "Ask AI"
    );
    b!.click();
    await settle();
  };
  const sends = () =>
    fixtureHealth.calls
      .filter(
        (c) =>
          /synthetic.textStream|createAgentConversation|textGenerate/.test(c[0]) ||
          (c[0] === "addAgentMessage" && c[2] === "user")
      )
      .map((c) => [c[0], c[0] === "synthetic.textStream" ? c[1].requestId : c[1]]);
  task16Fixture.unmount();
  await settle();
  task16Fixture.mountWorkspace();
  await settle(250);
  document
    .querySelector('nav[aria-label="Main navigation"]')!
    .querySelectorAll("button")[1]
    .click();
  await task16Fixture.openNote(9);
  await settle(300);
  const initial = sends().length;
  const initialRequests = task16Fixture.streamRequests.length;
  await ask();
  const original = input();
  check(
    "hidden Ask opens and focuses the actual visible composer",
    !!original?.getClientRects().length &&
      document.activeElement === original &&
      original.value === "“deliberately lo” ",
    original?.value
  );
  check(
    "Ask causes zero send/create/persistence/provider calls",
    sends().length === initial,
    sends()
  );
  await type("Newer words that must survive docking");
  click("Dock to sidebar");
  await settle();
  check(
    "Dock retains textarea identity and newer words",
    input() === original && original.value === "Newer words that must survive docking",
    original.value
  );
  await ask();
  check(
    "sidebar Ask stays sidebar and holds different old words",
    !!document.querySelector('button[aria-label="Undock from sidebar"]') &&
      document.body.innerText.includes("Your earlier message"),
    document.body.innerText.slice(-900)
  );
  click("Put it back");
  await settle();
  check(
    "Restore preserves both replaced words and quote",
    original.value === "Newer words that must survive docking\n\n“deliberately lo” ",
    original.value
  );
  await type("Latest deliberate edit");
  click("Undock from sidebar");
  await settle();
  check(
    "Undock retains identity and latest edit",
    input() === original && original.value === "Latest deliberate edit",
    original.value
  );
  click("Close chat");
  await settle();
  check(
    "Hide retains inert nonfocusable composer",
    input() === original &&
      !original.getClientRects().length &&
      !!original.closest("[inert]") &&
      document.activeElement !== original
  );
  document.querySelector<HTMLInputElement>('input[placeholder="Ask anything..."]')!.focus();
  await settle();
  check(
    "reopen retains identity and current words without replay",
    input() === original && original.value === "Latest deliberate edit",
    original.value
  );
  await type("Explicit synthetic busy request");
  await enter();
  check(
    "explicit send admitted through real hooks to synthetic boundary",
    task16Fixture.streamRequests.length === initialRequests + 1,
    { requests: task16Fixture.streamRequests.length, rows: task16Fixture.savedChatRows }
  );
  await type("Queued earlier words");
  await enter();
  check(
    "actual busy composer arms its destination queue",
    !!original.getAttribute("aria-describedby"),
    document.body.innerText.slice(-500)
  );
  await ask();
  const baseline = sends().length;
  check(
    "busy Ask disarms queue and holds old draft",
    !original.getAttribute("aria-describedby") &&
      document.body.innerText.includes("Your earlier message"),
    document.body.innerText.slice(-600)
  );
  await type("Newest words before late completion");
  task16Fixture.completeStream();
  await settle(350);
  check(
    "idle/late completion never sends Ask or queue or overwrites new edit",
    sends().length === baseline && original.value === "Newest words before late completion",
    { value: original.value, calls: sends() }
  );
  click("Put it back");
  await settle();
  check(
    "busy replaced draft remains restorable after completion",
    original.value.includes("Queued earlier words") &&
      original.value.includes("Newest words before late completion"),
    original.value
  );
  await type("Second explicit busy request");
  await enter();
  await type("Hidden queued draft");
  await enter();
  const beforeHide = sends().length;
  click("Close chat");
  await settle();
  task16Fixture.completeStream("Second synthetic response");
  await settle(350);
  check(
    "hide before idle disarms without hidden sends or focus",
    sends().length === beforeHide &&
      document.activeElement !== original &&
      original.value === "Hidden queued draft",
    { value: original.value, calls: sends() }
  );
  document.querySelector<HTMLInputElement>('input[placeholder="Ask anything..."]')!.focus();
  await settle();
  check(
    "reopening never rearms or replays old seed",
    sends().length === beforeHide &&
      original.value === "Hidden queued draft" &&
      input() === original
  );
  const panel = original.closest('[class*="absolute"]');
  const content = [...document.querySelectorAll<HTMLElement>("[style]")].find((e) =>
    e.style.getPropertyValue("--floating-inset")
  )!;
  check(
    "floating inset reservation remains on content container",
    !!content.style.getPropertyValue("--floating-inset"),
    {
      inset: content.style.getPropertyValue("--floating-inset"),
      panel: panel?.getBoundingClientRect().toJSON(),
    }
  );
  await task16Fixture.openNote(10);
  await settle(300);
  check("note owner change unmounts old input and clears old chrome", !original.isConnected);
  document.querySelector<HTMLInputElement>('input[placeholder="Ask anything..."]')!.focus();
  await settle();
  check(
    "another note never inherits the old selection seed",
    input() !== original && input()?.value === "",
    { value: input()?.value }
  );
  return {
    pass: results.every((r) => r.pass),
    results,
    health: {
      errors: fixtureHealth.errors,
      rejections: fixtureHealth.rejections,
      console: fixtureHealth.console,
    },
    rows: task16Fixture.savedChatRows,
  };
}
