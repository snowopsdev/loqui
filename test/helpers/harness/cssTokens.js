// Reads custom-property declarations from a named top-level CSS block so
// contrast tests score the tokens the app actually ships, not copies.
function blockBody(cssText, selector) {
  const lines = cssText.split("\n");
  const start = lines.findIndex((line) => line.trim() === `${selector} {`);
  if (start === -1) throw new Error(`No block for selector ${selector}`);
  let depth = 0;
  const body = [];
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
    }
    if (i > start) body.push(lines[i]);
    if (depth === 0) break;
  }
  return body.join("\n");
}

function readTokens(cssText, selector) {
  const out = {};
  for (const m of blockBody(cssText, selector).matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
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
