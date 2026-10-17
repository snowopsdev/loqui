const assert = require("node:assert/strict");
const React = require("react");

// A tiny element tree for react-dom/client tests with direct React event handlers.
function installTree() {
  const document = globalThis.document;
  const make = (nodeType, props) => {
    const node = {
      nodeType,
      ownerDocument: document,
      // React writes CSS custom properties through setProperty.
      style: {
        setProperty(name, value) {
          this[name] = String(value);
        },
        removeProperty(name) {
          delete this[name];
        },
      },
      childNodes: [],
      parentNode: null,
      appendChild(child) {
        node.insertBefore(child, null);
        return child;
      },
      insertBefore(child, before) {
        if (child.parentNode) child.parentNode.removeChild(child);
        const index = before ? node.childNodes.indexOf(before) : -1;
        child.parentNode = node;
        if (index < 0) node.childNodes.push(child);
        else node.childNodes.splice(index, 0, child);
        return child;
      },
      removeChild(child) {
        const index = node.childNodes.indexOf(child);
        if (index >= 0) node.childNodes.splice(index, 1);
        child.parentNode = null;
        return child;
      },
      get firstChild() {
        return node.childNodes[0] ?? null;
      },
      get nextSibling() {
        const siblings = node.parentNode?.childNodes ?? [];
        return siblings[siblings.indexOf(node) + 1] ?? null;
      },
      get textContent() {
        return node.nodeType === 3 ? node.data : node.childNodes.map((c) => c.textContent).join("");
      },
      set textContent(value) {
        node.childNodes = [];
        if (value) node.appendChild(make(3, { nodeName: "#text", data: String(value) }));
      },
      attributes: {},
      setAttribute(name, value) {
        node.attributes[name] = String(value);
      },
      removeAttribute(name) {
        delete node.attributes[name];
      },
      addEventListener() {},
      removeEventListener() {},
      getAttribute(name) {
        return name in node.attributes ? node.attributes[name] : null;
      },
      focus() {
        document.activeElement = node;
      },
      // Enough of querySelector for focus effects: "h1", "[data-x]", '[role="radio"]'.
      querySelector(selector) {
        const match = selector.match(/^([a-z0-9]+)?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/i);
        if (!match) return null;
        const [, tag, attr, value] = match;
        let found = null;
        const visit = (current) => {
          for (const child of current.childNodes) {
            if (found) return;
            if (
              child.nodeType === 1 &&
              (!tag || child.tagName === tag.toUpperCase()) &&
              (!attr ||
                (attr in child.attributes &&
                  (value === undefined || child.attributes[attr] === value)))
            ) {
              found = child;
              return;
            }
            visit(child);
          }
        };
        visit(node);
        return found;
      },
      closest: () => null,
      ...props,
    };
    return node;
  };
  document.createElement = (tag) =>
    make(1, {
      nodeName: tag.toUpperCase(),
      tagName: tag.toUpperCase(),
      namespaceURI: "http://www.w3.org/1999/xhtml",
    });
  document.createElementNS = (namespaceURI, tag) =>
    make(1, { nodeName: tag, tagName: tag, namespaceURI });
  document.createTextNode = (data) => make(3, { nodeName: "#text", data });
  const container = make(1, { nodeName: "DIV", tagName: "DIV" });
  const walk = (node, visit) => {
    visit(node);
    for (const child of node.childNodes) walk(child, visit);
  };
  const click = async (label) => {
    let target = null;
    walk(container, (node) => {
      if (target || node.tagName !== "BUTTON") return;
      if (node.textContent.includes(label)) target = node;
    });
    assert.ok(target, `button containing "${label}" is rendered`);
    const key = Object.keys(target).find((name) => name.startsWith("__reactProps$"));
    await React.act(async () => {
      // The handler returns the pending check; awaiting it would deadlock the test.
      void target[key].onClick(eventFor(target));
    });
  };
  const text = () => container.textContent;
  const find = (predicate) => {
    let found = null;
    walk(container, (node) => {
      if (!found && predicate(node)) found = node;
    });
    return found;
  };
  const props = (node) => node[Object.keys(node).find((name) => name.startsWith("__reactProps$"))];
  const findAll = (predicate) => {
    const out = [];
    walk(container, (node) => {
      if (node.nodeType === 1 && predicate(node)) out.push(node);
    });
    return out;
  };
  const byAttr = (name, value) =>
    findAll((node) =>
      value === undefined ? name in node.attributes : node.attributes[name] === String(value)
    );
  const eventFor = (node, extra = {}) => ({
    preventDefault() {},
    stopPropagation() {},
    currentTarget: node,
    target: node,
    ...extra,
  });
  // Plan 02's click(label) keeps working; it now also takes a node and passes an event.
  const clickAny = async (labelOrNode) => {
    if (typeof labelOrNode === "string") return click(labelOrNode);
    assert.ok(labelOrNode, "node to click exists");
    await React.act(async () => {
      void props(labelOrNode).onClick?.(eventFor(labelOrNode));
    });
  };
  const press = async (node, key, extra = {}) => {
    await React.act(async () => {
      void props(node).onKeyDown?.(eventFor(node, { key, repeat: false, ...extra }));
    });
  };
  return { container, click: clickAny, text, find, props, findAll, byAttr, press };
}

module.exports = { installTree };
