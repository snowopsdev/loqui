// A tiny element tree for mounting real components with react-dom's
// createRoot under Node. The shared fake DOM has no events, so tests invoke the
// onClick handlers React stored on the nodes. Call installBrowserGlobals and
// installHookDom first.
const assert = require("node:assert/strict");
const React = require("react");

function installClickableTree() {
  const document = globalThis.document;
  const make = (nodeType, props) => {
    const node = {
      nodeType,
      ownerDocument: document,
      style: {
        setProperty(name, value) {
          this[name] = value;
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
      get nodeValue() {
        return node.nodeType === 3 ? node.data : null;
      },
      set nodeValue(value) {
        if (node.nodeType === 3) node.data = String(value);
      },
      getBoundingClientRect: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
      }),
      attributes: {},
      setAttribute(name, value) {
        node.attributes[name] = String(value);
      },
      removeAttribute(name) {
        delete node.attributes[name];
      },
      addEventListener() {},
      removeEventListener() {},
      focus() {},
      querySelector: () => null,
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
  const find = (predicate) => {
    let found = null;
    walk(container, (node) => {
      if (!found && predicate(node)) found = node;
    });
    return found;
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
      void target[key].onClick();
    });
  };
  // For handlers that void an async operation (a clipboard write): click, then
  // let that promise chain settle before act flushes.
  const clickNode = async (target) => {
    assert.ok(target, "the button is rendered");
    const key = Object.keys(target).find((name) => name.startsWith("__reactProps$"));
    await React.act(async () => {
      void target[key].onClick();
      await new Promise((resolve) => setImmediate(resolve));
    });
  };
  const text = () => container.textContent;
  return { container, click, clickNode, find, text };
}

module.exports = { installClickableTree };
