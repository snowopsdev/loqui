const assert = require("node:assert/strict");
const test = require("node:test");

const load = () => import("../../src/components/chat/remarkCitations.ts");
const paragraph = (value) => ({
  type: "root",
  children: [{ type: "paragraph", children: [{ type: "text", value }] }],
});

test("known markers become numbered superscripts; unknown markers vanish", async () => {
  const { transformCitations } = await load();
  const tree = paragraph("Thursday, not Monday [note:38]. Invented [note:999].");
  transformCitations(tree, new Map([[38, 1]]));
  const children = tree.children[0].children;
  assert.deepEqual(
    children.map((c) => c.type),
    ["text", "citation", "text"]
  );
  assert.equal(children[0].value, "Thursday, not Monday ");
  assert.equal(children[1].data.hName, "sup");
  assert.equal(children[1].data.hProperties.dataCitation, 1);
  assert.equal(children[1].children[0].value, "1");
  assert.equal(children[2].value, ". Invented .");
});

test("markers inside code stay literal", async () => {
  const { transformCitations } = await load();
  const tree = {
    type: "root",
    children: [{ type: "paragraph", children: [{ type: "inlineCode", value: "[note:38]" }] }],
  };
  transformCitations(tree, new Map([[38, 1]]));
  assert.equal(tree.children[0].children[0].value, "[note:38]");
});

test("the shared eligibility walker preserves fenced, inline, reference and ordinary link literals", async () => {
  const { transformCitations } = await load();
  const { parseCitationMarkdown } = await import("../../src/components/chat/citationMarkdown.ts");
  const tree = parseCitationMarkdown(
    "`[note:17]` [literal [note:5]](https://example.test)\n\n```txt\n[note:9]\n```\n\n[ref [note:8]][r]\n\n[r]: https://example.test\n\nReal [note:38] [note:999] again [note:38]."
  );
  transformCitations(tree, new Map([[38, 1]]));
  const json = JSON.stringify(tree);
  for (const id of [17, 5, 9, 8]) assert.ok(json.includes(`[note:${id}]`));
  assert.ok(!json.includes("[note:999]"));
  assert.equal((json.match(/"type":"citation"/g) ?? []).length, 2);
});
