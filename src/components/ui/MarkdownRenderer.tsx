import { createContext, useContext, useId, type ReactElement } from "react";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PluggableList } from "unified";
import { getFoldersValue } from "../../stores/noteStore";
import { parseMentionHref } from "../../utils/mentionMarkdown";
import { sanitizeLinkHref } from "../../lib/linkHref";
import { useWorkspaceNavigation } from "../workspaceNavigation";
import { useTranslation } from "react-i18next";
import { useSealedMode } from "../../hooks/useSealedMode";
import { isLoopbackUrl } from "../../lib/locality";

interface MarkdownRendererProps {
  content: string;
  className?: string;
  remarkPlugins?: PluggableList;
  components?: Partial<Components>;
}

const FootnotePrefixContext = createContext("");

// Stable component types preserve DOM state, including table scroll positions.
// Sealed mode (Plan 07): an image Chromium would fetch from another computer.
// Relative URLs are the app's own document; data: and blob: are already local.
function isRemoteImage(src: unknown): boolean {
  if (typeof src !== "string") return false;
  const url = src.trim();
  if (url.startsWith("//")) return !isLoopbackUrl(`http:${url}`);
  if (/^https?:/i.test(url)) return !isLoopbackUrl(url);
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return !/^(?:data|blob):/i.test(url);
  return false;
}

const markdownComponents: Components = {
  // While sealed, or while that is still unknown, a remote image stays an
  // inert placeholder: the page never asks Chromium for it. Main would refuse
  // the request anyway (Layer B); this keeps the reason visible. Links stay
  // links: opening one goes through main's confirmation.
  img: function MarkdownImage({ node: _node, src, alt }): ReactElement {
    const { sealed } = useSealedMode();
    const { t } = useTranslation();
    if (isRemoteImage(src) && sealed !== false) {
      const key =
        sealed === true ? "sealedMode.markdown.imageBlocked" : "sealedMode.markdown.imageChecking";
      const label = alt ? t(`${key}Named`, { alt }) : t(key);
      return (
        <span
          role="img"
          aria-label={label}
          data-sealed-image=""
          className="inline-block rounded border border-dashed border-border px-1.5 py-0.5 text-xs text-muted-foreground"
        >
          {label}
        </span>
      );
    }
    return (
      <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} className="max-w-full" />
    );
  },
  h1: ({ children }): ReactElement => (
    <h1 className="text-lg font-bold mb-2 mt-3 first:mt-0">{children}</h1>
  ),
  h2: function MarkdownHeading({ children, id, className }): ReactElement {
    const prefix = useContext(FootnotePrefixContext);
    return (
      <h2
        id={id === "footnote-label" ? `${prefix}footnote-label` : id}
        className={className ?? "text-base font-semibold mb-2 mt-3 first:mt-0"}
      >
        {children}
      </h2>
    );
  },
  h3: ({ children }): ReactElement => (
    <h3 className="text-sm font-semibold mb-1.5 mt-2 first:mt-0">{children}</h3>
  ),
  p: ({ children }): ReactElement => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }): ReactElement => <ul className="list-disc ps-4 mb-2 space-y-1">{children}</ul>,
  ol: ({ children }): ReactElement => (
    <ol className="list-decimal ps-4 mb-2 space-y-1">{children}</ol>
  ),
  li: ({ children, id }): ReactElement => (
    <li id={id} className="ps-1">
      {children}
    </li>
  ),
  a: function MarkdownLink({ node: _node, href, children, ...props }): ReactElement {
    const prefix = useContext(FootnotePrefixContext);
    const navigation = useWorkspaceNavigation();
    const mention = parseMentionHref(href);
    if (mention) {
      const id = Number(mention.entityId);
      if (mention.kind === "person" || !Number.isSafeInteger(id) || id <= 0)
        return <span>{children}</span>;
      const open = () => {
        if (mention.kind === "note" || mention.kind === "meeting") navigation.openNote(id);
        else if (mention.kind === "dictation") navigation.openTranscript(id);
        else if (mention.kind === "folder") {
          const folder = getFoldersValue().find((f) => f.id === id && !f.deleted_at);
          if (folder) navigation.openFolder(folder.space_id, folder.id);
        }
      };
      return (
        <button
          type="button"
          data-mention-kind={mention.kind}
          onClick={open}
          className="markdown-link rounded-sm text-link underline decoration-link/30 hover:decoration-link/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {children}
        </button>
      );
    }
    const isAnchor = href?.startsWith("#");
    // Validate the allow-list, retaining the author's original allowed URL.
    const safe = href && (isAnchor || sanitizeLinkHref(href)) ? href : null;
    if (!safe) return <span>{children}</span>;
    return (
      <a
        {...props}
        href={safe}
        aria-describedby={
          props["aria-describedby"] === "footnote-label"
            ? `${prefix}footnote-label`
            : props["aria-describedby"]
        }
        target={isAnchor ? undefined : "_blank"}
        rel="noopener noreferrer"
        className="markdown-link rounded-sm text-link underline decoration-link/30 hover:decoration-link/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
      </a>
    );
  },
  code: ({ children }): ReactElement => (
    <code dir="ltr" className="bg-black/10 px-1 py-0.5 rounded text-xs font-mono">
      {children}
    </code>
  ),
  pre: ({ children }): ReactElement => (
    <pre dir="ltr" className="bg-black/10 p-2 rounded overflow-x-auto text-xs mb-2">
      {children}
    </pre>
  ),
  strong: ({ children }): ReactElement => <strong className="font-semibold">{children}</strong>,
  em: ({ children }): ReactElement => <em className="italic">{children}</em>,
  blockquote: ({ children }): ReactElement => (
    <blockquote className="border-s-2 border-current/30 ps-3 italic my-2">{children}</blockquote>
  ),
  hr: (): ReactElement => <hr className="border-current/20 my-3" />,
  table: ({ children }): ReactElement => (
    <div className="overflow-x-auto mb-2">
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }): ReactElement => (
    <thead className="border-b border-current/20">{children}</thead>
  ),
  tr: ({ children }): ReactElement => (
    <tr className="border-b border-current/10 last:border-0">{children}</tr>
  ),
  // style carries the GFM column alignment (:--, :-:, --:).
  th: ({ children, style }): ReactElement => (
    <th style={style} className="px-2 py-1.5 text-start font-semibold align-top">
      {children}
    </th>
  ),
  td: ({ children, style }): ReactElement => (
    <td style={style} className="px-2 py-1.5 align-top">
      {children}
    </td>
  ),
};

export function MarkdownRenderer({
  content,
  className,
  remarkPlugins,
  components,
}: MarkdownRendererProps): ReactElement {
  const footnotePrefix = `user-content-${useId()}-`;
  return (
    <div dir="auto" className={className}>
      <FootnotePrefixContext value={footnotePrefix}>
        <Markdown
          remarkPlugins={[remarkGfm, ...(remarkPlugins ?? [])]}
          urlTransform={(url) => (parseMentionHref(url) ? url : defaultUrlTransform(url))}
          remarkRehypeOptions={{ clobberPrefix: footnotePrefix }}
          components={components ? { ...markdownComponents, ...components } : markdownComponents}
        >
          {content}
        </Markdown>
      </FootnotePrefixContext>
    </div>
  );
}

export default MarkdownRenderer;
