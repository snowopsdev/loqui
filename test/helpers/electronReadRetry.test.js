const test = require("node:test");
const assert = require("node:assert/strict");
const { readElectronMain } = require("../../scripts/lib/electron-read-retry.cjs");

test("read retries only a collected Inspector promise and returns the next result", async () => {
  let calls = 0;
  const reader = () => "profile";
  const app = {
    async evaluate(callback) {
      assert.equal(callback, reader);
      if (++calls === 1)
        throw new Error("electronApplication.evaluate: Resulting promise was garbage collected.");
      return callback();
    },
  };
  assert.equal(await readElectronMain(app, reader), "profile");
  assert.equal(calls, 2);
});

test("read fails after three Inspector attempts", async () => {
  let calls = 0;
  const app = {
    async evaluate() {
      calls++;
      throw new Error("Resulting promise was garbage collected.");
    },
  };
  await assert.rejects(
    readElectronMain(app, () => null),
    /garbage collected/
  );
  assert.equal(calls, 3);
});

test("read does not retry application errors or destroyed execution contexts", async () => {
  for (const message of ["bad profile", "Execution context was destroyed"]) {
    let calls = 0;
    const app = {
      async evaluate() {
        calls++;
        throw new Error(message);
      },
    };
    await assert.rejects(
      readElectronMain(app, () => null),
      { message }
    );
    assert.equal(calls, 1);
  }
});
