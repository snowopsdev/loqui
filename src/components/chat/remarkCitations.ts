import { visitEligibleCitationText, type MarkdownNode } from "./citationMarkdown.ts";
import { CITATION_MARKER } from "./citations.ts";

// Numbering and rendering share Markdown eligibility. Defer replacements until
// traversal finishes so inserted superscripts cannot affect sibling indices.
export function transformCitations(tree: MarkdownNode, numbers: Map<number, number>): void {
  const replacements = new Map<MarkdownNode, Map<number, MarkdownNode[]>>();
  visitEligibleCitationText(tree, ({ value }, parent, index) => {
    if (!parent || index == null || !value.includes("[note:")) return;
    const next: MarkdownNode[] = [];
    const pushText = (text: string) => {
      if (!text) return;
      const last = next.at(-1);
      if (last?.type === "text") last.value = (last.value ?? "") + text;
      else next.push({ type: "text", value: text });
    };
    let cursor = 0;
    for (const match of value.matchAll(CITATION_MARKER)) {
      pushText(value.slice(cursor, match.index));
      const n = numbers.get(Number(match[1]));
      if (n != null) {
        next.push({
          type: "citation",
          data: { hName: "sup", hProperties: { dataCitation: n } },
          children: [{ type: "text", value: String(n) }],
        });
      }
      cursor = match.index + match[0].length;
    }
    pushText(value.slice(cursor));
    if (!replacements.has(parent)) replacements.set(parent, new Map());
    replacements.get(parent)!.set(index, next);
  });
  for (const [parent, byIndex] of replacements) {
    parent.children = parent.children!.flatMap((child, index) => byIndex.get(index) ?? [child]);
  }
}

export function remarkCitations(options: { numbers: Map<number, number> }) {
  return (tree: MarkdownNode) => transformCitations(tree, options.numbers);
}
