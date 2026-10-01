// V8 Inspector can lose the promise used by Playwright to evaluate a synchronous
// main-process read. Retry only that transport error, never application errors.
// Callers must be read-only: this helper must not replay a side effect.
async function readElectronMain(application, reader) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await application.evaluate(reader);
    } catch (error) {
      if (attempt >= 2 || !error.message.includes("Resulting promise was garbage collected.")) {
        throw error;
      }
      console.warn("Retrying read-only Electron evaluation after Inspector promise collection");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
module.exports = { readElectronMain };
