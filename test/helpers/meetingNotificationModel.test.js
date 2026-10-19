const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/components/meetingNotificationModel.ts");

test("detection presentation preserves event title, join action, and dismissal", async () => {
  const { getMeetingNotificationPresentation } = await load();

  assert.deepEqual(
    getMeetingNotificationPresentation({
      detectionId: "calendar:event-1",
      source: "calendar",
      key: "event-1",
      event: { summary: "Weekly planning" },
      variant: "starting",
      joinUrl: "https://meet.example/event-1",
    }),
    {
      title: "Weekly planning",
      bodyKey: "meetingNotification.body.starting",
      bodyParams: {},
      privacyKey: null,
      actionKey: "meetingNotification.join",
      action: "join",
      dismissible: true,
    }
  );
});

test("a dismissible meeting notification closes after an 80px upward swipe", async () => {
  const { shouldDismissMeetingNotificationSwipe } = await load();

  assert.equal(shouldDismissMeetingNotificationSwipe(true, 80), false);
  assert.equal(shouldDismissMeetingNotificationSwipe(true, -80), true);
  assert.equal(shouldDismissMeetingNotificationSwipe(true, 79), false);
});

// The card on screen when the pointer is released decides, not the one the
// swipe started on: a newer prompt can replace it mid-drag.
test("non-dismissible meeting notifications ignore vertical swipes", async () => {
  const { shouldDismissMeetingNotificationSwipe } = await load();

  assert.equal(shouldDismissMeetingNotificationSwipe(false, 200), false);
});

test("overlay initialization cleanup cancels reveal and invalidates a pending pull", async () => {
  const { initializeMeetingNotificationOverlay } = await load();
  let subscribed;
  let reveal;
  let canceledTimer;
  let resolvePendingData;
  const pendingData = new Promise((resolve) => {
    resolvePendingData = resolve;
  });
  const received = [];
  let readyCount = 0;
  let visibleCount = 0;
  let unsubscribeCount = 0;

  const cleanup = initializeMeetingNotificationOverlay({
    subscribe: (callback) => {
      subscribed = callback;
      return () => {
        unsubscribeCount += 1;
      };
    },
    getPendingData: () => pendingData,
    onData: (data) => received.push(data),
    onVisible: () => {
      visibleCount += 1;
    },
    onReady: () => {
      readyCount += 1;
    },
    setTimeout: (callback, delay) => {
      assert.equal(delay, 50);
      reveal = callback;
      return 11;
    },
    clearTimeout: (timer) => {
      canceledTimer = timer;
    },
  });

  subscribed({ detectionId: "calendar:first" });
  cleanup();
  reveal();
  resolvePendingData({ detectionId: "calendar:second" });
  await pendingData;
  await Promise.resolve();

  assert.deepEqual(received, [{ detectionId: "calendar:first" }]);
  assert.equal(canceledTimer, 11);
  assert.equal(visibleCount, 0);
  assert.equal(readyCount, 0);
  assert.equal(unsubscribeCount, 1);
});

test("lease label updates beat the pending getter and never replay an old label", async () => {
  const { initializeMeetingNotificationOverlay } = await load();
  let push, resolve;
  const received = [];
  const pending = new Promise((r) => {
    resolve = r;
  });
  const cleanup = initializeMeetingNotificationOverlay({
    subscribe: (cb) => {
      push = cb;
      return () => {};
    },
    getPendingData: () => pending,
    onData: (d) => received.push(d),
    onVisible() {},
    onReady() {},
    setTimeout: () => 1,
    clearTimeout() {},
  });
  push({ detectionId: "A", acceptHotkeyLabel: "⌥⌘M" });
  push({ detectionId: "A", acceptHotkeyLabel: null });
  resolve({ detectionId: "A", acceptHotkeyLabel: "⌥⌘M" });
  await pending;
  await Promise.resolve();
  assert.equal(received.length, 2);
  assert.equal(received.at(-1).acceptHotkeyLabel, null);
  push({ detectionId: "B", acceptHotkeyLabel: "Ctrl+Alt+M" });
  assert.equal(received.at(-1).detectionId, "B");
  cleanup();
});
