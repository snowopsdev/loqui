// The zero-secret CLI check must load the real canary, but never Electron's
// installer or a real provider transport. Keep this leaf inert for child life.
const Module = require("node:module");
const path = require("node:path");
const parentPath = path.resolve(__dirname, "../../../src/helpers/geminiTranscription.js");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron" && parent?.filename === parentPath)
    return {
      net: {
        fetch() {
          throw new Error("Zero-secret canary fixture forbids network");
        },
      },
    };
  return originalLoad.call(this, request, parent, isMain);
};
