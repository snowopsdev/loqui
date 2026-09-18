function registerModelImportHandlers({ ipcMain, dialog, modelManager, getWindow }) {
  let importController = null;
  const failure = (error) => ({
    success: false,
    canceled: error.name === "AbortError" || error.code === "MODEL_TEST_CANCELED",
    error: error.message,
    code: error.code || "MODEL_IMPORT_FAILED",
  });
  ipcMain.handle("model-import-gguf", async (event) => {
    if (importController)
      return { success: false, error: "An import is already running.", code: "MODEL_BUSY" };
    const controller = new AbortController();
    importController = controller;
    try {
      const options = {
        title: "Import a GGUF text model",
        properties: ["openFile"],
        filters: [{ name: "GGUF models", extensions: ["gguf"] }],
      };
      const owner = getWindow?.(event);
      const picked = await (owner
        ? dialog.showOpenDialog(owner, options)
        : dialog.showOpenDialog(options));
      if (picked.canceled || !picked.filePaths[0] || controller.signal.aborted)
        return { success: false, canceled: true };
      const model = await modelManager.importGguf(picked.filePaths[0], {
        signal: controller.signal,
      });
      return { success: true, modelId: model.id };
    } catch (error) {
      return failure(error);
    } finally {
      importController = null;
    }
  });
  ipcMain.handle("model-test-load", async (_event, modelId) => {
    if (typeof modelId !== "string" || modelId.length > 256)
      return { success: false, error: "Invalid model ID.", code: "MODEL_NOT_FOUND" };
    try {
      return { success: true, ...(await modelManager.testModelLoad(modelId)) };
    } catch (error) {
      return failure(error);
    }
  });
  ipcMain.handle("model-cancel-load-test", () => {
    const canceledImport = Boolean(importController);
    importController?.abort();
    return { success: modelManager.cancelModelLoadTest() || canceledImport };
  });
}

module.exports = { registerModelImportHandlers };
