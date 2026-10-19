import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

// Match react-markdown + remark-gfm. Keep eligibility shared with the later
// citation transform so code and links never consume a citation number.
const parser = unified().use(remarkParse).use(remarkGfm);
const excluded = new Set(["code", "inlineCode", "link", "linkReference"]);

export interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: unknown;
}

export function parseCitationMarkdown(content: string): MarkdownNode {
  return parser.parse(content);
}

export function visitEligibleCitationText(
  node: MarkdownNode,
  visit: (node: MarkdownNode & { value: string }, parent?: MarkdownNode, index?: number) => void,
  parent?: MarkdownNode,
  index?: number
): void {
  if (excluded.has(node.type)) return;
  if (node.type === "text" && typeof node.value === "string") {
    visit(node as MarkdownNode & { value: string }, parent, index);
    return;
  }
  // Snapshot indices: visitors may replace text nodes after traversal.
  node.children?.forEach((child, childIndex) =>
    visitEligibleCitationText(child, visit, node, childIndex)
  );
}
