// SSR entry point for renderer-component structure tests. The dictation .tsx
// modules are compiled with the classic JSX runtime under the tsx loader, so
// they resolve React from the global scope instead of importing it.
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

globalThis.React = React;

// Match the URL value Vite supplies for imported artwork. Node's TSX loader
// otherwise attempts to parse PNG bytes as JavaScript in structure tests.
require.extensions[".png"] = (module, filename) => {
  module.exports = filename;
};

const renderStatic = (type, props, ...children) =>
  renderToStaticMarkup(React.createElement(type, props, ...children));

module.exports = { React, renderStatic };
