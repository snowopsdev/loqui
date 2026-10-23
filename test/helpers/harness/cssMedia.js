// Preserve every matching media block: a later unrelated block must not hide
// an earlier component's accessibility policy from its regression assertions.
function mediaContents(source, condition) {
  const marker = `@media (${condition})`;
  const contents = [];
  let next = 0;
  while ((next = source.indexOf(marker, next)) !== -1) {
    const start = source.indexOf("{", next + marker.length);
    if (start === -1) throw new Error(`Missing media body: ${condition}`);
    let depth = 1;
    let end = start + 1;
    for (; end < source.length && depth; end++) {
      if (source[end] === "{") depth++;
      else if (source[end] === "}") depth--;
    }
    if (depth) throw new Error(`Unclosed media body: ${condition}`);
    contents.push(source.slice(start + 1, end - 1));
    next = end;
  }
  return contents.join("\n");
}
module.exports = { mediaContents };
