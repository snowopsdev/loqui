const assert = require("node:assert/strict");
const test = require("node:test");
const load = () => import("../../src/components/lib/utils.ts");

// tailwind-merge treats an unknown text-* class as a colour, so without the
// extension `text-ui text-muted-foreground` silently loses its size.
test("ramp sizes survive a following text colour", async () => {
  const { cn } = await load();
  assert.equal(cn("text-ui text-muted-foreground"), "text-ui text-muted-foreground");
  assert.equal(cn("text-caption", "text-foreground"), "text-caption text-foreground");
});

test("ramp sizes still replace other sizes, and each other", async () => {
  const { cn } = await load();
  assert.equal(cn("text-sm", "text-ui"), "text-ui");
  assert.equal(cn("text-caption", "text-body"), "text-body");
});

test("role colours named *-text are still colours", async () => {
  const { cn } = await load();
  assert.equal(cn("text-ui text-ai-text"), "text-ui text-ai-text");
  assert.equal(cn("text-agent-text", "text-foreground"), "text-foreground");
});
