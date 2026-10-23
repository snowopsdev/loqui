const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { createRecipientAuthority } = require("../../src/helpers/recipientAuthority");
const owner = () => Object.assign(new EventEmitter(), { isDestroyed: () => false });
const row = { id: "openrouter", present: false, generation: 0 };
// Change-driving: bounded lifecycle must release sender listeners on disposal.
test("change-driving: recipient authority releases sender lifetime listeners and refuses destroyed owners", () => {
  const a = createRecipientAuthority();
  const sender = owner();
  a.issue(sender, { host: "fixture.test" }, row);
  a.dispose();
  assert.equal(sender.listenerCount("destroyed"), 0);
  sender.isDestroyed = () => true;
  assert.throws(() => a.issue(sender, {}, row), /unavailable/);
});
// Baseline guard: tokens are opaque, non-secret, sender-bound, expiring and bounded.
test("baseline guard: recipient tokens bind complete canonical config and committed generation/presence", () => {
  let now = 1;
  const a = createRecipientAuthority({ now: () => now, ttlMs: 10, limit: 2 });
  const sender = owner();
  const config = { host: "fixture.test", path: "/v1", scope: "fixture" };
  const token = a.issue(sender, config, row);
  a.validate(token, sender, config, row);
  for (const [who, cfg, credential] of [
    [owner(), config, row],
    [sender, { ...config, path: "/v2" }, row],
    [sender, config, { ...row, present: true }],
    [sender, config, { ...row, generation: 1 }],
    [sender, config, { ...row, unknown: true }],
  ])
    assert.throws(() => a.validate(token, who, cfg, credential), /Recipient changed/);
  assert.throws(() => a.issue(sender, config, { ...row, unknown: true }), /unavailable/);
  now = 12;
  assert.throws(() => a.validate(token, sender, config, row), /Recipient changed/);
  const old = a.issue(sender, config, row);
  a.issue(sender, config, row);
  a.issue(sender, config, row);
  assert.throws(() => a.validate(old, sender, config, row), /Recipient changed/);
  const current = a.issue(sender, config, row);
  sender.emit("destroyed");
  assert.throws(() => a.validate(current, sender, config, row), /Recipient changed/);
  a.dispose();
});
