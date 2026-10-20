// Explicit browser companion: production ChatView/composer/sources/stream/persistence.
// The fixture supplies typed, in-memory preload IPC. Every send is deliberate.
export async function runChatContextRegression(f: any) {
  const results: string[] = [];
  f.lastResults = results;
  const check = (ok: unknown, name: string) => {
    if (!ok) throw Error(name);
    results.push(name);
  };
  const wait = () => new Promise((r) => setTimeout(r, 65));
  const box = () => document.querySelector("textarea")!;
  const picker = () => document.querySelector("[data-chat-context-picker]");
  const button = (name: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.getAttribute("aria-label") === name || b.textContent?.trim() === name
    )!;
  const type = async (text: string, caret = text.length) => {
    const el = box();
    el.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, text);
    el.setSelectionRange(caret, caret);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("select", { bubbles: true }));
    await wait();
  };
  const press = async (key: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    box().dispatchEvent(event);
    await wait();
    return event.defaultPrevented;
  };
  const add = async (kind: string) => {
    button("Add context").click();
    await wait();
    const option = document.querySelector<HTMLElement>(`[role=option][data-kind=${kind}]`);
    check(!!option, `Add context offers ${kind}`);
    option!.click();
    await wait();
  };
  const fakeSend = async () => {
    button("Send").click();
    await wait();
  };
  f.request("new", "");
  await wait();
  const initial = f.stats().requests;
  await type("@");
  check(
    document.querySelectorAll("[data-kind=person]").length === 0,
    "chat picker excludes people"
  );
  await press("Enter", { isComposing: true });
  await press("Enter", { keyCode: 229 } as KeyboardEventInit);
  check(box().value === "@" && !!picker(), "IME and 229 leave query and picker untouched");
  check(await press("Enter"), "selected Enter prevents native default");
  check(box().value === "" && !picker(), "typed note pick is a local edit");
  check(f.stats().requests === initial, "typed context pick never sends");
  const multiline = "  leading\n    code  stays\ntext  \ncompare @Syn with  tail\n    end  \n  ";
  const caret = multiline.indexOf("@Syn") + 4;
  await type(multiline, caret);
  check(await press("Tab"), "Tab selects a context option");
  check(
    box().value === multiline.replace("@Syn ", ""),
    "exact multiline splice preserves all unrelated whitespace"
  );
  check(box().selectionStart === multiline.indexOf("@Syn"), "local edit returns caret to splice");
  const before = box().value,
    beforeCaret = box().selectionStart;
  await add("meeting");
  await add("folder");
  await add("dictation");
  check(
    box().value === before && box().selectionStart === beforeCaret,
    "button picks preserve exact draft and caret"
  );
  check(f.stats().requests === initial, "all four entity picks send nothing");
  await type("@NO_MATCH_FOR_CONTEXT_22");
  check(await press("Enter"), "empty picker Enter is consumed");
  check(f.stats().requests === initial, "empty Enter never falls through to Send");
  check(!(await press("Tab")), "empty Tab can leave focus naturally");
  check(await press("Escape"), "Escape is consumed");
  check(!picker(), "Escape closes the picker");
  f.gate("search:synthetic");
  await type("@synthetic");
  check(await press("Enter"), "loading picker Enter is consumed");
  check(!document.querySelector("[role=option]"), "loading current query has no old eligible rows");
  await press("Escape");
  f.resolve("search:synthetic");
  await wait();
  check(!picker(), "late same-query results cannot revive a closed picker");
  const oldSameQuery = f.gate("search:synthetic");
  await type("");
  await type("@synthetic");
  await press("Escape");
  f.gate("search:synthetic");
  await type("");
  await type("@synthetic");
  oldSameQuery();
  await wait();
  check(
    !document.querySelector("[role=option]"),
    "old same-query intent cannot populate a reopened pending picker"
  );
  f.resolve("search:synthetic");
  await wait();
  check(!!document.querySelector("[role=option]"), "new same-query intent owns its own result");
  await press("Escape");
  f.gate("search:standup");
  await type("@standup");
  f.request("open", 22);
  await wait();
  f.resolve("search:standup");
  await wait();
  check(!picker(), "conversation selection rejects old query results");
  check(
    !document.querySelector('[aria-label^="Remove "]'),
    "explicit navigation clears all current pins"
  );
  f.request("new", "");
  await wait();
  await add("note");
  f.gate("note:9");
  f.gate("write:user");
  f.gate("rag");
  await type("deliberate pinned A question");
  const beforeSend = f.stats();
  await fakeSend();
  check(f.stats().requests === beforeSend.requests, "user-save and pin waits do not dispatch");
  check(
    !!document.querySelector('[aria-label="Remove Synthetic typography note from context"]'),
    "initial creation retains its pins"
  );
  const a = f.health.calls.filter((c: any[]) => c[0] === "createAgentConversation").length;
  check(a > 0, "actual production sender created A");
  f.replaceNote(9, { content: "Q later content must not replace admitted body" });
  button("Remove Synthetic typography note from context").click();
  await wait();
  await add("meeting");
  f.chatRoute("network", "ready", "route-B-1b");
  await wait();
  f.request("open", 22);
  await wait();
  await type("B newer unsent words");
  const visibleB = document.querySelector(".agent-chat-scroll")!.textContent;
  f.resolve("write:user");
  await wait();
  f.resolve("rag");
  await wait();
  check(f.stats().requests === beforeSend.requests, "pins still pending after saved user and RAG");
  f.resolve("note:9");
  await wait();
  const request = f.streamRequests.at(-1);
  check(
    request.model === "qwen-1b" && request.baseUrl.includes("127.0.0.1"),
    "actual IPC keeps admitted route A"
  );
  check(
    request.systemPrompt.includes('<note id="9"') &&
      !request.systemPrompt.includes("Q later content"),
    "actual IPC contains admission P content only"
  );
  check(!request.systemPrompt.includes('<note id="11"'), "A payload excludes later meeting pin Q");
  check(
    request.systemPrompt.includes("[note:ID]"),
    "pinned-only source lane enables citation instruction without RAG/tools"
  );
  f.completeStream("Saved A answer [note:9]. Unknown [note:999]. `code [note:9]`");
  await wait();
  const saved = f.savedChatRows.at(-1);
  const aId = saved.conversation_id;
  check(
    saved.role === "assistant" && saved.metadata.context.pinnedNotes[0].id === 9,
    "actual fourth-argument metadata persists A pins"
  );
  check(saved.metadata.context.route.model === "qwen-1b", "actual saved A route matches IPC");
  check(
    box().value === "B newer unsent words" &&
      document.querySelector(".agent-chat-scroll")!.textContent === visibleB,
    "late A completion preserves B rows and newer draft"
  );
  check(
    f.savedChatRows.filter((r: any) => r.conversation_id === 22).length === 0,
    "B receives no admitted A persistence"
  );
  f.request("open", aId);
  await wait();
  check(
    document.querySelector(".agent-chat-scroll")!.textContent!.includes("Sources"),
    "reopening actual A renders pinned-only Sources"
  );
  check(
    !!document.querySelector('[data-source-id="9"]') && !!document.querySelector("sup"),
    "reopening A renders actual citation control"
  );
  check(
    document.querySelectorAll("sup").length === 1 &&
      !document.querySelector('[data-source-id="999"]'),
    "unknown source marker creates no citation or source"
  );
  check(
    document.querySelector("code")?.textContent?.includes("[note:9]"),
    "code source marker stays literal"
  );
  // Next current admission receives the currently chosen pin and actual next route.
  await type("next current question");
  await add("meeting");
  await fakeSend();
  check(
    f.streamRequests.at(-1).systemPrompt.includes('<note id="11"') &&
      !f.streamRequests.at(-1).systemPrompt.includes('<note id="9"'),
    "next current admission receives Q only"
  );
  f.completeStream("Next answer [note:11]");
  await wait();
  // Queue remains owned by the user through a typed local mention edit.
  await type("busy request");
  await fakeSend();
  await type("queued draft");
  await press("Enter");
  check(
    document.body.textContent!.includes("Sends when the reply finishes"),
    "user can arm an actual destination queue"
  );
  await type("queued draft @");
  await press("Enter");
  check(
    document.body.textContent!.includes("Sends when the reply finishes"),
    "mention edit preserves armed queue"
  );
  const queuedRequests = f.stats().requests;
  f.completeStream("busy complete");
  await wait();
  await wait();
  check(
    f.stats().requests === queuedRequests + 1 &&
      f.streamRequests.at(-1).messages.at(-1).content === "queued draft",
    "queue sends the edited draft once on idle"
  );
  f.completeStream("queued complete");
  await wait();
  // External request identity and internal edit seeds cannot collide.
  const onlyDeliberateSends = f.stats().requests;
  f.request("new", "@", 1);
  await wait();
  await press("Enter");
  check(
    f.stats().requests === onlyDeliberateSends &&
      !!document.querySelector('[aria-label^="Remove "]'),
    "new external @ seed opens the picker without accidental send"
  );
  f.request("new", "external seed survives local edit", 2);
  await wait();
  check(
    box().value === "external seed survives local edit",
    "external seed nonce cannot collide with mention edit seed"
  );
  await type("newer words");
  f.request("new", "ignored replay", 2);
  await wait();
  check(box().value === "newer words", "external request dedupe identity remains intact");
  f.request("new", "replacement for Restore", 3);
  await wait();
  button("Put it back").click();
  await wait();
  check(
    box().value.includes("newer words") && box().value.includes("replacement for Restore"),
    "Restore updates the authoritative composer"
  );
  await type("@");
  await press("Enter");
  check(box().value === "", "Restore followed by a mention never resurrects old mirrored text");
  return {
    results,
    stats: f.stats(),
    saved: f.savedChatRows,
    health: { errors: f.health.errors, rejections: f.health.rejections, console: f.health.console },
  };
}

export async function runChatContextShortcutRegression() {
  const results: string[] = [];
  const wait = () => new Promise((r) => setTimeout(r, 40));
  const open = () => !!document.querySelector('aside[aria-label="Context"]');
  const original = open();
  for (const [name, options] of Object.entries({
    composing: { ctrlKey: true, isComposing: true },
    key229: { ctrlKey: true, keyCode: 229 },
    alt: { ctrlKey: true, altKey: true },
    repeated: { ctrlKey: true, repeat: true },
    wrongPlatform: { metaKey: true },
    prevented: { ctrlKey: true },
  })) {
    const event = new KeyboardEvent("keydown", {
      key: ".",
      bubbles: true,
      cancelable: true,
      ...options,
    });
    if (name === "prevented") event.preventDefault();
    window.dispatchEvent(event);
    await wait();
    if (open() !== original) throw Error(name + " changed rail");
    results.push(name + " does not toggle rail");
  }
  const event = new KeyboardEvent("keydown", {
    key: ".",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  await wait();
  if (open() === original || !event.defaultPrevented)
    throw Error("shortcut did not consume and toggle");
  results.push("platform shortcut consumes and toggles");
  const saved = localStorage.getItem("chat.contextRailOpen");
  if (saved !== String(!original)) throw Error("preference not saved");
  results.push("shortcut saves the user preference");
  return { results };
}

export function inspectChatContextGeometry() {
  const rail = document.querySelector("aside")!;
  const box = document.querySelector("textarea")!;
  const popup = document.querySelector("[data-chat-context-picker]");
  const r = rail.getBoundingClientRect(),
    b = box.getBoundingClientRect(),
    p = popup?.getBoundingClientRect();
  const checks = {
    documentFits: document.documentElement.scrollWidth <= innerWidth,
    railTextWraps: rail.scrollWidth <= rail.clientWidth,
    composerReachable:
      b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth,
    railDoesNotCoverComposer: r.top >= b.bottom || r.left >= b.right || r.right <= b.left,
    pickerFits:
      !p || (p.left >= 0 && p.right <= innerWidth && p.top >= 0 && p.bottom <= innerHeight),
    noFakeToggles: !rail.querySelector("input,[role=switch]"),
  };
  if (Object.values(checks).some((x) => !x)) throw Error(JSON.stringify(checks));
  return { checks, rail: r.toJSON(), composer: b.toJSON(), popup: p?.toJSON() };
}
