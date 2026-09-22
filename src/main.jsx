// Install the browser-only adapter before any stores or components read the bridge.
// Electron keeps its preload bridge; production builds exclude the preview module.
if (import.meta.env.DEV && !window.electronAPI) {
  const { installBrowserPreview } = await import("./preview/browserPreview");
  installBrowserPreview();
}
await import("./renderApp.jsx");
