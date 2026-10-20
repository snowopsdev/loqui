const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const postcss = require("postcss");
const { resolveTokens } = require("../helpers/harness/cssTokens");

const read = (file) => fs.readFileSync(path.join(__dirname, "../..", file), "utf8");
const sheet = postcss.parse(read("src/styles/onboarding.css"));
const themes = resolveTokens(read("src/index.css"));
const group = '.onb-radio-group[data-variant="segmented"]';

// Apply the shipped resting-state rules in source order. Focus rules are
// deliberately excluded: selection must remain identifiable after Tab leaves.
function restingStyle(selectors, tokens) {
  const style = {};
  sheet.walkRules((rule) => {
    if (!selectors.includes(rule.selector)) return;
    rule.walkDecls((decl) => {
      style[decl.prop] = decl.value.replace(/var\((--[\w-]+)\)/g, (_, token) => {
        assert.ok(tokens[token], `missing theme token ${token}`);
        return tokens[token];
      });
    });
  });
  return style;
}

for (const theme of ["light", "dark"]) {
  test(`segmented selection has a persistent 3:1 boundary in ${theme}`, async () => {
    const { contrastRatio } = await import("../../src/utils/contrast.ts");
    const tokens = themes[theme];
    const track = restingStyle([group], tokens);
    const baseSelectors = [".onb-radio", `${group} .onb-radio`];
    const unchecked = restingStyle(baseSelectors, tokens);
    const checked = restingStyle(
      [
        ...baseSelectors,
        '.onb-radio[aria-checked="true"]',
        `${group} .onb-radio[aria-checked="true"]`,
      ],
      tokens
    );
    const fillContrast = contrastRatio(checked.background, track.background);

    // Score a crisp, opaque inset edge, not the blurred translucent drop
    // shadow. Read its actual resolved colour rather than assuming a token.
    const edge = postcss.list.comma(checked["box-shadow"] || "").find((shadow) => {
      const geometry = shadow
        .replace(/#[\da-f]{6}\b/gi, "")
        .trim()
        .split(/\s+/);
      return (
        geometry.includes("inset") &&
        geometry.filter((part) => part !== "inset").length === 4 &&
        geometry
          .filter((part) => part !== "inset")
          .slice(0, 3)
          .every((n) => /^0(px)?$/.test(n)) &&
        parseFloat(geometry.at(-1)) >= 1
      );
    });
    assert.ok(
      edge,
      `${theme}: resting fill is only ${fillContrast.toFixed(4)}:1; no crisp persistent edge`
    );
    const colour = edge.match(/#[\da-f]{6}\b/i)?.[0];
    assert.ok(colour, "selected edge must resolve to an opaque theme colour");
    for (const adjacent of [checked.background, track.background]) {
      const ratio = contrastRatio(colour, adjacent);
      assert.ok(ratio >= 3, `${theme}: selected edge ${colour} on ${adjacent} is ${ratio}:1`);
    }
    assert.notEqual(
      checked["box-shadow"],
      unchecked["box-shadow"],
      "edge identifies checked state"
    );
    for (const property of ["padding", "border", "border-radius"]) {
      assert.equal(checked[property], unchecked[property], `selection preserves ${property}`);
    }
  });
}
