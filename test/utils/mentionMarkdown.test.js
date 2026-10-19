const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/utils/mentionMarkdown.ts");

const PEOPLE = [
  { name: "Gabriel Stein", email: "gabe@openwhispr.com" },
  { name: "Michael Chen", email: "michael@acme.com" },
  { name: "Sean", email: null },
];

test("buildMentionMarkdown links the email when present", async () => {
  const { buildMentionMarkdown } = await load();
  assert.equal(
    buildMentionMarkdown({ name: "Michael Chen", email: "michael@acme.com" }),
    "[@Michael Chen](mention:michael%40acme.com)"
  );
});

test("buildMentionMarkdown falls back to the name and escapes link-breaking chars", async () => {
  const { buildMentionMarkdown } = await load();
  assert.equal(buildMentionMarkdown({ name: "Sean", email: null }), "[@Sean](mention:Sean)");
  // Parens would end the markdown link destination early; brackets break the label.
  assert.equal(
    buildMentionMarkdown({ name: "Ana (PM)", email: null }),
    "[@Ana (PM)](mention:Ana%20%28PM%29)"
  );
  assert.equal(
    buildMentionMarkdown({ name: "Bob [ops]", email: null }),
    "[@Bob ops](mention:Bob%20ops)"
  );
});

test("parseMentionEmail extracts emails and rejects everything else", async () => {
  const { parseMentionEmail } = await load();
  assert.equal(parseMentionEmail("mention:michael%40acme.com"), "michael@acme.com");
  assert.equal(parseMentionEmail("mention:Sean"), null);
  assert.equal(parseMentionEmail("https://example.com"), null);
  assert.equal(parseMentionEmail(null), null);
  assert.equal(parseMentionEmail("mention:%E0%A4%A"), null);
});

test("tags a full-name owner on a checkbox line", async () => {
  const { tagActionItemOwners } = await load();
  assert.equal(
    tagActionItemOwners("- [ ] Send the deck — Michael Chen", PEOPLE),
    "- [ ] Send the deck — [@Michael Chen](mention:michael%40acme.com)"
  );
});

test("tags by unique first name, case-insensitively", async () => {
  const { tagActionItemOwners } = await load();
  assert.equal(
    tagActionItemOwners("- [x] Review PR - michael", PEOPLE),
    "- [x] Review PR - [@Michael Chen](mention:michael%40acme.com)"
  );
});

test("leaves ambiguous first names untouched", async () => {
  const { tagActionItemOwners } = await load();
  const people = [
    { name: "Michael Chen", email: "michael@acme.com" },
    { name: "Michael Ross", email: "mross@acme.com" },
  ];
  const line = "- [ ] Review PR — Michael";
  assert.equal(tagActionItemOwners(line, people), line);
});

test("tags multiple owners only when every owner is known", async () => {
  const { tagActionItemOwners } = await load();
  assert.equal(
    tagActionItemOwners("- [ ] Draft the plan — Sean and Michael", PEOPLE),
    "- [ ] Draft the plan — [@Sean](mention:Sean), [@Michael Chen](mention:michael%40acme.com)"
  );
  const partiallyUnknown = "- [ ] Draft the plan — Sean and Priya";
  assert.equal(tagActionItemOwners(partiallyUnknown, PEOPLE), partiallyUnknown);
});

test("ignores unknown owners, non-task lines, and already-tagged lines", async () => {
  const { tagActionItemOwners } = await load();
  const unknown = "- [ ] Follow up — Priya";
  assert.equal(tagActionItemOwners(unknown, PEOPLE), unknown);

  const prose = "We agreed — Michael will follow up.";
  assert.equal(tagActionItemOwners(prose, PEOPLE), prose);

  const tagged = "- [ ] Send the deck — [@Michael Chen](mention:michael%40acme.com)";
  assert.equal(tagActionItemOwners(tagged, PEOPLE), tagged);
});

test("handles multi-line markdown and empty people", async () => {
  const { tagActionItemOwners } = await load();
  const markdown = ["## Action Items", "- [ ] Ship it — Sean", "- [ ] Untouched text"].join("\n");
  assert.equal(
    tagActionItemOwners(markdown, PEOPLE),
    ["## Action Items", "- [ ] Ship it — [@Sean](mention:Sean)", "- [ ] Untouched text"].join("\n")
  );
  assert.equal(tagActionItemOwners(markdown, []), markdown);
});

test("entity mentions round-trip as readable links", async () => {
  const { buildEntityMentionMarkdown, parseMentionHref } = await load();
  const cases = [
    [
      { kind: "note", label: "Pricing FAQ draft", entityId: "17", email: null },
      "[@Pricing FAQ draft](note:17)",
    ],
    [
      { kind: "meeting", label: "Pricing review", entityId: "38", email: null },
      "[@Pricing review](meeting:38)",
    ],
    [
      { kind: "dictation", label: "Draft a reply to Maya…", entityId: "311", email: null },
      "[@Draft a reply to Maya…](dictation:311)",
    ],
    [{ kind: "folder", label: "Work", entityId: "2", email: null }, "[@Work](folder:2)"],
  ];
  for (const [entity, markdown] of cases) {
    assert.equal(buildEntityMentionMarkdown(entity), markdown);
    const href = markdown.match(/\]\(([^)]+)\)$/)[1];
    assert.deepEqual(parseMentionHref(href), {
      kind: entity.kind,
      entityId: entity.entityId,
      email: null,
    });
  }
});

test("people keep the existing mention: scheme", async () => {
  const { buildEntityMentionMarkdown, parseMentionHref } = await load();
  assert.equal(
    buildEntityMentionMarkdown({
      kind: "person",
      label: "Michael Chen",
      entityId: null,
      email: "michael@acme.com",
    }),
    "[@Michael Chen](mention:michael%40acme.com)"
  );
  assert.deepEqual(parseMentionHref("mention:michael%40acme.com"), {
    kind: "person",
    entityId: null,
    email: "michael@acme.com",
  });
  assert.deepEqual(parseMentionHref("mention:Sean"), {
    kind: "person",
    entityId: null,
    email: null,
  });
});

test("malformed or foreign hrefs are not mentions", async () => {
  const { parseMentionHref, buildEntityMentionMarkdown } = await load();
  for (const href of [
    "note:abc",
    "note:-1",
    "note:1.5",
    "note:0",
    "meeting:",
    "note:12x",
    "note:17\n",
    "https://x.y",
    "javascript:alert(1)",
    null,
    "",
  ]) {
    assert.equal(parseMentionHref(href), null, String(href));
  }
  assert.equal(
    buildEntityMentionMarkdown({ kind: "note", label: "Ghost", entityId: "nope", email: null }),
    "@Ghost"
  );
  assert.equal(
    buildEntityMentionMarkdown({ kind: "note", label: "Ghost", entityId: "17\n", email: null }),
    "@Ghost"
  );
});

test("labels cannot break out of the link", async () => {
  const { buildEntityMentionMarkdown } = await load();
  assert.equal(
    buildEntityMentionMarkdown({
      kind: "note",
      label: "Q3 [draft]\nplan",
      entityId: "4",
      email: null,
    }),
    "[@Q3 draft plan](note:4)"
  );
});

test("labels survive a real Markdown parse: backslashes, emphasis and punctuation (M02)", async () => {
  const { buildEntityMentionMarkdown, buildMentionMarkdown, parseMentionHref } = await load();
  const MarkdownIt = require("markdown-it"); // the parser tiptap-markdown uses
  const md = new MarkdownIt({ html: false });
  const unescape = (html) => html.replace(/&amp;/g, "&");
  for (const label of [
    "Trailing\\",
    "A\\B",
    "Q&A: pricing (v2)!",
    "50% *bold* _x_",
    "`code` ~strike~",
  ]) {
    const html = md.renderInline(
      buildEntityMentionMarkdown({ kind: "note", label, entityId: "17", email: null })
    );
    const link = html.match(/^<a href="([^"]+)">@(.*)<\/a>$/);
    assert.ok(link, `${label} → ${html}`);
    assert.equal(unescape(link[2]), label, "the label comes back verbatim");
    assert.deepEqual(parseMentionHref(link[1]), { kind: "note", entityId: "17", email: null });
  }
  assert.equal(
    md.renderInline(buildMentionMarkdown({ name: "Ops\\", email: "ops@acme.co" })),
    '<a href="mention:ops%40acme.co">@Ops\\</a>'
  );
});

test("person display escaping preserves its existing fallback href identity", async () => {
  const { buildMentionMarkdown, buildEntityMentionMarkdown, mentionHref } = await load();
  const { default: MarkdownIt } = await import("markdown-it");
  const md = new MarkdownIt({ html: false });
  for (const label of ["A\\B", "50% *bold* _x_"]) {
    const person = { kind: "person", label, entityId: null, email: null };
    const markdown = buildMentionMarkdown({ name: label, email: null });
    const entityMarkdown = buildEntityMentionMarkdown(person);
    assert.equal(entityMarkdown, markdown);
    const href = markdown.match(/\]\(([^)]+)\)$/)[1];
    assert.equal(
      href,
      mentionHref(person),
      "display escaping does not change the encoded identity"
    );
    const html = md.renderInline(markdown);
    const link = html.match(/^<a href="([^"]+)">@(.*)<\/a>$/);
    assert.ok(link, `${label} → ${html}`);
    assert.equal(link[1], href);
    assert.equal(link[2], label);
  }
});

test("production TipTap mention nodes parse and serialize entity and person links", async (t) => {
  const { createRendererServer } = require("../lib/rendererTestHarness");
  const vite = await createRendererServer(t);
  const { createMentionExtension } = await vite.ssrLoadModule(
    "/components/ui/RichTextEditorMention.tsx"
  );
  const { getSchema } = await import("@tiptap/core");
  const { default: StarterKit } = await import("@tiptap/starter-kit");
  const { Markdown } = await import("tiptap-markdown");
  const { DOMParser: HtmlParser } = require("@xmldom/xmldom");
  const { DOMParser: TipTapDOMParser } = await import("@tiptap/pm/model");
  const { mentionHref } = await load();
  const mention = createMentionExtension(() => []);
  const schema = getSchema([
    mention,
    StarterKit.configure({ link: { openOnClick: false } }),
    Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: true }),
  ]);
  assert.deepEqual(Object.keys(schema.nodes.mention.spec.attrs), [
    "label",
    "email",
    "kind",
    "entityId",
  ]);
  assert.deepEqual(
    schema.nodes.mention.spec.parseDOM.map(({ tag, priority }) => [tag, priority]),
    ["mention:", "note:", "meeting:", "dictation:", "folder:"].map((prefix) => [
      `a[href^="${prefix}"]`,
      100,
    ])
  );
  assert.ok(schema.nodes.mention.spec.parseDOM.every((rule) => rule.priority === 100));
  assert.ok(
    schema.marks.link.spec.parseDOM.every((rule) => (rule.priority ?? 50) === 50),
    "the mention node rules outrank StarterKit's Link mark rules"
  );
  const markdownIt = new (await import("markdown-it")).default({ html: false });
  const parseMarkdown = (markdown) => {
    const html = markdownIt.render(markdown);
    const dom = new HtmlParser().parseFromString(html, "text/html");
    const addMatches = (element) => {
      if (element.nodeType === 1 && !element.matches) {
        const getAttribute = element.getAttribute.bind(element);
        element.getAttribute = (name) => (element.hasAttribute(name) ? getAttribute(name) : null);
        element.matches = (selector) =>
          selector.split(",").some((part) => {
            const match = part
              .trim()
              .match(/^([\w-]+)?(?:\[([\w-]+)(\^=|=)?["']?([^\]"']*)["']?\])?$/);
            if (!match) return false;
            const [, tag, attribute, operator, value] = match;
            if (tag && element.nodeName.toLowerCase() !== tag.toLowerCase()) return false;
            if (!attribute) return true;
            const actual = element.getAttribute(attribute);
            if (actual == null) return false;
            return operator === "^=" ? actual.startsWith(value) : !operator || actual === value;
          });
      }
      for (let child = element.firstChild; child; child = child.nextSibling) addMatches(child);
    };
    addMatches(dom);
    if (markdown.startsWith("[@Legacy")) {
      const anchor = dom.getElementsByTagName("a")[0];
      assert.equal(anchor.getAttribute("href"), "mention:michael%40acme.com");
      assert.deepEqual(schema.nodes.mention.spec.parseDOM[0].getAttrs(anchor), {
        label: "Legacy person",
        email: "michael@acme.com",
        kind: "person",
        entityId: null,
      });
    }
    return TipTapDOMParser.fromSchema(schema).parse(dom);
  };
  const serializeMention = (node) => {
    let markdown = "";
    const config = mention.config.addStorage.call(mention);
    config.markdown.serialize({ write: (value) => (markdown += value) }, node);
    return markdown;
  };

  const source = [
    "[@Legacy person](mention:michael%40acme.com)",
    "[@Pricing FAQ](note:17)",
    "[@Pricing review](meeting:38)",
    "[@Draft a reply](dictation:311)",
    "[@Work](folder:2)",
  ].join(" ");
  const parsed = parseMarkdown(source);
  const mentions = [];
  parsed.descendants((node) => {
    if (node.type.name === "mention") mentions.push(node);
  });
  assert.deepEqual(
    mentions.map((node) => [
      node.attrs.kind,
      node.attrs.entityId,
      node.attrs.email,
      node.attrs.label,
    ]),
    [
      ["person", null, "michael@acme.com", "Legacy person"],
      ["note", "17", null, "Pricing FAQ"],
      ["meeting", "38", null, "Pricing review"],
      ["dictation", "311", null, "Draft a reply"],
      ["folder", "2", null, "Work"],
    ]
  );
  for (const mentionNode of mentions) {
    const markdown = serializeMention(mentionNode);
    const reloaded = parseMarkdown(markdown);
    const roundTripped = [];
    reloaded.descendants((node) => {
      if (node.type.name === "mention") roundTripped.push(node);
    });
    assert.equal(roundTripped.length, 1, markdown);
    assert.deepEqual(roundTripped[0].attrs, mentionNode.attrs);
    const rendered = mention.config.renderHTML.call(mention, {
      node: mentionNode,
      HTMLAttributes: {},
    });
    assert.deepEqual(rendered[1], {
      href: mentionHref(mentionNode.attrs),
      "data-mention": "",
      "data-mention-kind": mentionNode.attrs.kind,
    });
  }

  const malformed = parseMarkdown("[@Malformed](note:abc) [@Foreign](https://example.com)");
  const malformedMentions = [];
  const foreignLinks = [];
  malformed.descendants((node) => {
    if (node.type.name === "mention") malformedMentions.push(node);
    if (node.marks.some((mark) => mark.type.name === "link")) foreignLinks.push(node.text);
  });
  assert.deepEqual(malformedMentions, []);
  assert.ok(foreignLinks.includes("@Foreign"), "foreign href stays a normal link");

  const legacyLinks = parseMarkdown(
    "[relative](./relative) [anchor](#section) [phone](tel:+123456) [ftp](ftp://files.example) [person](mention:Sean)"
  );
  const legacyMention = [];
  let linkMarks = 0;
  legacyLinks.descendants((node) => {
    if (node.type.name === "mention") legacyMention.push(node);
    linkMarks += node.marks.filter((mark) => mark.type.name === "link").length;
  });
  assert.equal(legacyMention.length, 1);
  assert.equal(legacyMention[0].attrs.kind, "person");
  assert.ok(
    linkMarks >= 4,
    "default Link parser continues to keep relative, anchor, tel and ftp links"
  );
});
