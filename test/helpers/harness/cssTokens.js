// Reads custom-property declarations from a named top-level CSS block so
// contrast tests score the tokens the app actually ships, not copies.
// Comments are stripped first; only blocks at brace depth 0 match, so a
// selector nested in @media or another rule is ignored.
function topLevelBlockBody(cssText, selector) {
  const css = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  let prelude = "";
  let bodyStart = -1;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      if (depth === 0) {
        if (prelude.trim() === selector) bodyStart = i + 1;
        prelude = "";
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        if (bodyStart !== -1) return css.slice(bodyStart, i);
        prelude = "";
      }
    } else if (depth === 0) {
      prelude = ch === ";" ? "" : prelude + ch;
    }
  }
  throw new Error(`No block for selector ${selector}`);
}

function readTokens(cssText, selector) {
  const out = {};
  for (const m of topLevelBlockBody(cssText, selector).matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

function resolveTokens(cssText) {
  const light = { ...readTokens(cssText, "@theme") };
  const dark = { ...light, ...readTokens(cssText, ".dark") };
  return { light, dark };
}

module.exports = { readTokens, resolveTokens };
