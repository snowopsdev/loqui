const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { DOMParser } = require("@xmldom/xmldom");
const { createInstance } = require("i18next");
const { createRendererServer } = require("../lib/rendererTestHarness");
const Icon = () => null;
async function cards(t) {
  const vite = await createRendererServer(t);
  const { MetricCard } = await vite.ssrLoadModule("/components/insights/MetricCard.tsx");
  return (props) => React.createElement(MetricCard, { icon: Icon, ...props });
}

async function metrics(locale) {
  const i18n = createInstance();
  await i18n.init({
    lng: locale,
    resources: {
      [locale]: { translation: require(`../../src/locales/${locale}/translation.json`) },
    },
  });
  const t = i18n.t.bind(i18n);
  const number = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  return [
    {
      label: t("insights.wordsSpoken"),
      value: number.format(12840),
      detail: t("insights.allTime"),
      selectLabel: t("insights.openHistory"),
    },
    {
      label: t("insights.wordsPerMinute"),
      value: number.format(126),
      detail: t("insights.wpmCoverage", { count: 90 }),
      selectLabel: t("insights.openHistory"),
    },
    {
      label: t("insights.dictations"),
      value: number.format(214),
      detail: t("insights.allTime"),
      selectLabel: t("insights.openDictations"),
    },
    {
      label: t("insights.currentStreak"),
      value: t("insights.days", { count: 3 }),
      detail: t("insights.longestStreak", { count: 7 }),
      selectLabel: t("insights.focusHeatmap"),
    },
  ];
}

function documentOf(html) {
  return new DOMParser().parseFromString(`<main>${html}</main>`, "text/html");
}

// Resolve the actual SSR ID references, including their order and visible targets.
// Browser accessibility snapshots separately check the platform-computed names.
function referencedText(document, button, attribute) {
  const refs = button.getAttribute(attribute);
  assert.ok(refs, `${attribute} supplies metric references`);
  return refs.split(/\s+/).map((id) => {
    const target = document.getElementById(id);
    assert.ok(target, `${attribute} target ${id} exists`);
    let ancestor = target.parentNode;
    while (ancestor && ancestor !== button) ancestor = ancestor.parentNode;
    assert.equal(ancestor, button, "each reference belongs to this card");
    return target;
  });
}

function assertIdentity(document, button, metric) {
  assert.equal(button.getAttribute("type"), "button");
  assert.equal(
    button.hasAttribute("aria-label"),
    false,
    "destination must not override the metric name"
  );
  const name = referencedText(document, button, "aria-labelledby");
  assert.deepEqual(
    name.map((target) => target.textContent),
    [metric.label, metric.value]
  );
  assert.ok(name.every((target) => !target.getAttribute("class").includes("sr-only")));
  const description = referencedText(document, button, "aria-describedby");
  assert.deepEqual(
    description.map((target) => target.textContent),
    [metric.detail, metric.selectLabel].filter(Boolean)
  );
  assert.ok(!description[0].getAttribute("class").includes("sr-only"));
  if (metric.selectLabel) assert.equal(description[1].getAttribute("class"), "sr-only");
  assert.match(button.getAttribute("class"), /focus-visible:ring-2 focus-visible:ring-ring/);
}

for (const [index, label] of [
  "Words 12.8K",
  "WPM 126",
  "Dictations 214",
  "Streak 3 days",
].entries()) {
  test(`${label} names the visible metric/value and describes detail/destination`, async (t) => {
    const card = await cards(t);
    const metric = (await metrics("en"))[index];
    const document = documentOf(renderToStaticMarkup(card({ ...metric, onSelect() {} })));
    assertIdentity(document, document.getElementsByTagName("button")[0], metric);
  });
}

test("all four Arabic cards retain localized labels, numbers, plurals and destinations", async (t) => {
  const card = await cards(t);
  const localized = await metrics("ar");
  const document = documentOf(
    renderToStaticMarkup(
      React.createElement(
        "div",
        { dir: "rtl" },
        localized.map((metric) => card({ ...metric, key: metric.label, onSelect() {} }))
      )
    )
  );
  const buttons = Array.from(document.getElementsByTagName("button"));
  assert.equal(buttons.length, 4);
  buttons.forEach((button, index) => assertIdentity(document, button, localized[index]));
  assert.equal(
    new Set(
      buttons.map((button) =>
        referencedText(document, button, "aria-labelledby")
          .map((target) => target.textContent)
          .join(" ")
      )
    ).size,
    4
  );
});

test("multiple card sets have unique IDs and deterministic SSR references", async (t) => {
  const card = await cards(t);
  const english = await metrics("en");
  const render = () =>
    renderToStaticMarkup(
      React.createElement(
        "div",
        null,
        [0, 1].map((set) =>
          React.createElement(
            "section",
            { key: set },
            english.map((metric) => card({ ...metric, key: metric.label, onSelect() {} }))
          )
        )
      )
    );
  const html = render();
  assert.equal(render(), html);
  const document = documentOf(html);
  const ids = Array.from(document.getElementsByTagName("*"))
    .filter((node) => node.hasAttribute("id"))
    .map((node) => node.getAttribute("id"));
  assert.ok(ids.length >= 32, "each of eight cards supplies its own name and description targets");
  assert.equal(new Set(ids).size, ids.length, "no duplicate IDs across card sets");
  Array.from(document.getElementsByTagName("button")).forEach((button, index) =>
    assertIdentity(document, button, english[index % 4])
  );
});

test("a button without an optional destination still exposes metric and detail", async (t) => {
  const card = await cards(t);
  const metric = { label: "Words per minute", value: "—", detail: "All time" };
  const document = documentOf(renderToStaticMarkup(card({ ...metric, onSelect() {} })));
  assertIdentity(document, document.getElementsByTagName("button")[0], metric);
});

test("metadata is full secondary colour at caption size and static cards stay divs", async (t) => {
  const card = await cards(t);
  const html = renderToStaticMarkup(
    card({
      label: "Words",
      value: "12,840",
      detail: "≈ 5.4 hours of typing",
      largeValue: true,
      selectLabel: "Open History",
    })
  );
  assert.match(html, /^<div/);
  assert.match(html, /text-caption text-muted-foreground">≈ 5\.4 hours/);
  assert.match(html, /text-3xl/);
  assert.doesNotMatch(html, /text-\[11px\]|muted-foreground\/70|tabindex/);
  assert.doesNotMatch(html, /<button|role=|aria-label|aria-describedby|Open History|sr-only/);
});
