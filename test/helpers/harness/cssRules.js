// Splits a stylesheet into style rules and records the at-rules around each
// one, so tests can ask whether a rule is layered. Unlayered normal
// declarations beat every @layer (CSS Cascade 5), which decides whether a
// Tailwind utility can override a global rule. Comments are stripped; the
// stylesheets this reads contain no braces inside strings.
function parseRules(cssText) {
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const stack = [];
  let prelude = "";
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      stack.push({ head: prelude.trim(), start: i + 1 });
      prelude = "";
    } else if (ch === "}") {
      const open = stack.pop();
      if (open && open.head && !open.head.startsWith("@")) {
        rules.push({
          selector: open.head.replace(/\s+/g, " "),
          body: css.slice(open.start, i),
          atRules: stack.map((entry) => entry.head).filter((head) => head.startsWith("@")),
        });
      }
      prelude = "";
    } else if (ch === ";") {
      prelude = "";
    } else {
      prelude += ch;
    }
  }
  return rules;
}

const isLayered = (rule) => rule.atRules.some((head) => head.startsWith("@layer"));

module.exports = { parseRules, isLayered };
