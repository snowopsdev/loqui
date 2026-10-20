const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

async function render(t, content, inspect = () => {}) {
  installBrowserGlobals(t);
  globalThis.window.workspaceLinkCalls = [];
  globalThis.window.workspaceLinkFolders = [];
  const vite = await createRendererServer(t, {
    cachePrefix: "loqui-markdown-workspace-links-",
    mockModules: {
      "/workspaceNavigation": `
        export const useWorkspaceNavigation = () => ({
          openNote: (id) => globalThis.window.workspaceLinkCalls.push(["note", id]),
          openTranscript: (id) => globalThis.window.workspaceLinkCalls.push(["dictation", id]),
          openFolder: (spaceId, folderId) => globalThis.window.workspaceLinkCalls.push(["folder", spaceId, folderId]),
          openView: (view) => globalThis.window.workspaceLinkCalls.push(["view", view]),
        });
      `,
      "stores/noteStore": `export const getFoldersValue = () => globalThis.window.workspaceLinkFolders;`,
    },
  });
  const mod = await vite.ssrLoadModule("/components/ui/MarkdownRenderer.tsx");
  function InspectMarkdown(props) {
    const element = mod.MarkdownRenderer(props);
    inspect(element.props.children.props.children.props.components.a);
    return element;
  }
  return renderToStaticMarkup(createElement(InspectMarkdown, { content }));
}

test("workspace mentions open inside Loqui, never in the browser", async (t) => {
  const html = await render(t, "See [@Design sync](meeting:42) and [@Roadmap](note:17).");
  assert.match(html, /<button[^>]*data-mention-kind="meeting"[^>]*>@Design sync<\/button>/);
  assert.match(html, /<button[^>]*data-mention-kind="note"[^>]*>@Roadmap<\/button>/);
  assert.doesNotMatch(html, /href="(meeting|note):/);
  assert.doesNotMatch(html, /target="_blank"[^>]*>@/);
});

test("folder mentions select the referenced folder and its space using current store data", async (t) => {
  let Link;
  const html = await render(t, "See [@Work](folder:2).", (component) => {
    Link = component;
  });
  assert.match(html, /<button[^>]*data-mention-kind="folder"[^>]*>@Work<\/button>/);
  assert.doesNotMatch(html, /href="folder:|target="_blank"/);
  let activate;
  function InspectLink() {
    const button = Link({ href: "folder:2", children: "@Work" });
    activate = button.props.onClick;
    return button;
  }
  renderToStaticMarkup(createElement(InspectLink));
  // Populate after render: the click must read the current store, not capture a list.
  globalThis.window.workspaceLinkFolders = [{ id: 2, space_id: 7 }];
  activate();
  assert.deepEqual(globalThis.window.workspaceLinkCalls, [["folder", 7, 2]]);
  globalThis.window.workspaceLinkFolders = [];
  activate();
  assert.deepEqual(
    globalThis.window.workspaceLinkCalls,
    [["folder", 7, 2]],
    "a removed folder does not open another location"
  );
});

test("web links still open externally; script and file links are inert text", async (t) => {
  const html = await render(
    t,
    "[site](https://loqui.app) [x](javascript:alert(1)) [f](file:///etc/passwd)"
  );
  assert.match(html, /<a[^>]*href="https:\/\/loqui\.app"[^>]*target="_blank"/);
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /href="file:/);
  assert.match(html, />x</);
});

test("dictations use transcript navigation and invalid or unsafe numeric workspace IDs stay inert", async (t) => {
  let Link;
  const html = await render(
    t,
    "[dictation](dictation:8) [person](mention:a%40b.test) [huge](note:9007199254740993) [zero](note:0) [leading](note:02) [foreign](loqui:4)",
    (component) => {
      Link = component;
    }
  );
  assert.equal((html.match(/data-mention-kind=/g) ?? []).length, 1);
  let activate;
  function Inspect() {
    const el = Link({ href: "dictation:8", children: "dictation" });
    activate = el.props.onClick;
    return el;
  }
  renderToStaticMarkup(createElement(Inspect));
  activate();
  assert.deepEqual(globalThis.window.workspaceLinkCalls, [["dictation", 8]]);
  assert.doesNotMatch(html, /href="(?:mention|note|loqui):/);
});

test("links retain author URLs, mail and anchors with opaque native focus styles", async (t) => {
  const html = await render(
    t,
    "[site](https://example.test/a%20b?q=1#frag) [mail](mailto:a@example.test) [anchor](#heading)"
  );
  assert.match(html, /href="https:\/\/example.test\/a%20b\?q=1#frag"/);
  assert.match(html, /href="mailto:a@example.test"/);
  assert.match(html, /href="#heading"/);
  assert.equal((html.match(/focus-visible:ring-2/g) ?? []).length, 3);
  assert.doesNotMatch(html, /ring-ring\//);
});

test("folder activation ignores soft-deleted records and follows the current owning space", async (t) => {
  let Link;
  await render(t, "[@Work](folder:2)", (component) => {
    Link = component;
  });
  let activate;
  function Inspect() {
    const button = Link({ href: "folder:2", children: "Work" });
    activate = button.props.onClick;
    return button;
  }
  renderToStaticMarkup(createElement(Inspect));
  globalThis.window.workspaceLinkFolders = [{ id: 2, space_id: 7, deleted_at: "2026-10-19" }];
  activate();
  assert.deepEqual(globalThis.window.workspaceLinkCalls, [], "soft-deleted folder stays inert");
  globalThis.window.workspaceLinkFolders = [{ id: 2, space_id: 9, deleted_at: null }];
  activate();
  assert.deepEqual(
    globalThis.window.workspaceLinkCalls,
    [["folder", 9, 2]],
    "reads the owning space at activation"
  );
});
