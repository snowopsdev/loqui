import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

// Match react-markdown + remark-gfm. Keep eligibility shared with the later
// citation transform so code and links never consume a citation number.
const parser = unified().use(remarkParse).use(remarkGfm);
const excluded = new Set(["code", "inlineCode", "link", "linkReference"]);

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
}

export function parseCitationMarkdown(content: string): MarkdownNode {
  return parser.parse(content);
}

export function visitEligibleCitationText(
  node: MarkdownNode,
  visit: (node: MarkdownNode & { value: string }) => void
): void {
  if (excluded.has(node.type)) return;
  if (node.type === "text" && typeof node.value === "string") {
    visit(node as MarkdownNode & { value: string });
    return;
  }
  for (const child of node.children ?? []) visitEligibleCitationText(child, visit);
}
