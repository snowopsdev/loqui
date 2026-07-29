const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

let loaded;
const load = () => {
  if (!loaded) {
    const filename = path.join(__dirname, "../../src/lib/notePermissions.ts");
    const source = fs.readFileSync(filename, "utf8");
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    loaded = import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
  }
  return loaded;
};

test("editors can edit and share without owner-only capabilities", async () => {
  const { noteCapabilities } = await load();

  assert.deepEqual(noteCapabilities("editor"), {
    canView: true,
    canEdit: true,
    canShare: true,
    canDelete: false,
    canManageInheritedAccess: false,
    canTransferOwnership: false,
  });
});

test("viewers cannot edit or share", async () => {
  const { noteCapabilities } = await load();
  const capabilities = noteCapabilities("viewer");

  assert.equal(capabilities.canView, true);
  assert.equal(capabilities.canEdit, false);
  assert.equal(capabilities.canShare, false);
});

test("owners and administrators retain all capabilities", async () => {
  const { noteCapabilities } = await load();

  for (const capabilities of [noteCapabilities("owner"), noteCapabilities("viewer", true)]) {
    assert.equal(capabilities.canView, true);
    assert.equal(capabilities.canEdit, true);
    assert.equal(capabilities.canShare, true);
    assert.equal(capabilities.canDelete, true);
    assert.equal(capabilities.canManageInheritedAccess, true);
    assert.equal(capabilities.canTransferOwnership, true);
  }
});

test("personal cloud notes fail closed until their share state loads", async () => {
  const { resolveNotePermission } = await load();

  assert.equal(
    resolveNotePermission({
      shareStateLoaded: false,
      isTeamNote: false,
      hasCloudId: true,
    }),
    null
  );
  assert.equal(
    resolveNotePermission({
      cachedPermission: "viewer",
      shareStateLoaded: true,
      isTeamNote: false,
      hasCloudId: true,
    }),
    "viewer"
  );
});

test("local, team, and legacy notes retain their compatibility defaults", async () => {
  const { resolveNotePermission } = await load();

  assert.equal(
    resolveNotePermission({
      shareStateLoaded: false,
      isTeamNote: false,
      hasCloudId: false,
    }),
    "owner"
  );
  assert.equal(
    resolveNotePermission({
      shareStateLoaded: false,
      isTeamNote: true,
      hasCloudId: true,
    }),
    "editor"
  );
  assert.equal(
    resolveNotePermission({
      shareStateLoaded: true,
      isTeamNote: false,
      hasCloudId: true,
    }),
    "owner"
  );
});
