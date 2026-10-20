const assert = require("node:assert/strict");
const React = require("react");

// A tiny element tree for react-dom/client tests with direct React event handlers.
function installTree() {
  const document = globalThis.document;
  const make = (nodeType, props) => {
    const node = {
      nodeType,
      ownerDocument: document,
      style: {},
      childNodes: [],
      parentNode: null,
      cloneNode(deep = false) {
        const clone = make(node.nodeType, {
          nodeName: node.nodeName,
          tagName: node.tagName,
          namespaceURI: node.namespaceURI,
          ...(node.nodeType === 3 ? { data: node.data } : {}),
        });
        clone.attributes = { ...node.attributes };
        if (deep) for (const child of node.childNodes) clone.appendChild(child.cloneNode(true));
        return clone;
      },
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
      focus() {},
      querySelector: () => null,
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
      void target[key].onClick();
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
  return { container, click, text, find, props };
}

module.exports = { installTree };
