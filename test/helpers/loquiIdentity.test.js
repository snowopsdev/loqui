const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const product = require("../../src/config/product.json");
const config = require("../../electron-builder.cjs");
test("package, credentials and packaging use Loqui identities", () => {
  assert.equal(product.appId, "io.github.snowopsdev.loqui");
  assert.equal(product.credentialService, product.appId);
  assert.equal(config.appId, product.appId);
  assert.equal(config.productName, product.name);
  assert.equal(require("../../package.json").name, product.packageName);
  assert.equal(config.publish[0].owner + "/" + config.publish[0].repo, product.repository);
  assert.equal(
    config.publish[0].channel,
    require("../../package.json").version.includes("-") ? "beta" : "latest"
  );
  assert.equal(config.linux.executableName, "loqui");
});
test("new profile setup has no legacy profile migration", () => {
  const main = fs.readFileSync(path.join(__dirname, "../../main.js"), "utf8");
  assert.ok(main.includes("product.profileName"));
  assert.ok(!main.includes("WhisprPersonal"));
  const cache = fs.readFileSync(path.join(__dirname, "../../src/helpers/modelDirUtils.js"), "utf8");
  assert.ok(!cache.includes("renameSync"));
  assert.ok(!cache.includes("rmSync"));
});
