// Run with the pinned Electron binary: electron scripts/clipboard-smoke.cjs.
// Exercises the native clipboard and restores its initial contents afterward.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { app, clipboard, ClipboardItem, nativeImage } = require("electron");
const ClipboardManager = require("../src/helpers/clipboard");

app
  .whenReady()
  .then(async () => {
    const manager = new ClipboardManager();
    const original = await manager._saveClipboard();
    const marker = `loqui-smoke-${crypto.randomUUID()}`;
    const png = nativeImage
      .createFromDataURL(
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=="
      )
      .toPNG();
    assert.ok(png.length > 0, "valid PNG fixture");
    let ownsClipboard = false;
    try {
      const fixture = new ClipboardItem({
        "text/plain": marker,
        "text/html": `<b>${marker}</b>`,
        "text/rtf": `{\\rtf1 ${marker}}`,
        "image/png": new Blob([png], { type: "image/png" }),
      });
      await clipboard.write([fixture]);
      ownsClipboard = true;
      const snapshot = await manager._saveClipboard();
      for (const text of [`${marker}-first`, `${marker}-second`]) {
        await manager.runClipboardOperation(async () => {
          await manager.writeClipboard(text);
          assert.equal(await manager.readClipboard(), text);
          await manager._restoreClipboardAfterDelay(snapshot, { delayMs: 0, expectedText: text });
        });
        const items = await clipboard.read();
        const data = {};
        for (const item of items)
          for (const type of item.types) data[type] = await item.getType(type);
        assert.equal(await data["text/plain"].text(), marker);
        assert.ok((await data["text/html"].text()).includes(`<b>${marker}</b>`));
        assert.ok((await data["text/rtf"].text()).includes(marker));
        assert.ok(data["image/png"].size > 0);
      }
      console.log("PASS native rich text, RTF and image restoration across consecutive writes");
      await manager.writeClipboard(`${marker}-user-copy`);
      await manager._restoreClipboardAfterDelay(snapshot, { delayMs: 0, expectedText: marker });
      assert.equal(await manager.readClipboard(), `${marker}-user-copy`);
      console.log("PASS native user-copy race protection");
      if (process.platform === "linux") {
        const primary = await clipboard.selection.read();
        const saved = [];
        for (const item of primary) {
          if (item.types.length === 0) continue;
          const data = {};
          for (const type of item.types) data[type] = await item.getType(type);
          saved.push(new ClipboardItem(data));
        }
        try {
          await clipboard.selection.writeText(marker);
          assert.equal(await clipboard.selection.readText(), marker);
          console.log("PASS Linux PRIMARY async clipboard");
        } finally {
          if ((await clipboard.selection.readText()) === marker) {
            if (saved.length) await clipboard.selection.write(saved);
            else clipboard.selection.clear();
          }
        }
      }
    } finally {
      // A new copy by the user takes precedence over this test's initial snapshot.
      if (ownsClipboard && (await clipboard.readText()).startsWith(marker)) {
        await manager._restoreClipboard(original);
      }
    }
  })
  .then(
    () => app.exit(0),
    (error) => {
      console.error(error);
      app.exit(1);
    }
  );
