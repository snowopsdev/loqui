const assert = require("node:assert/strict");
const test = require("node:test");
const { loadAudioManager } = require("./harness/audioManager");

function fakeContext() {
  const oscillators = [];
  const param = (log) => ({
    setValueAtTime: (v, t) => log.push(["set", v, t]),
    linearRampToValueAtTime: (v, t) => log.push(["lin", v, t]),
    exponentialRampToValueAtTime: (v, t) => log.push(["exp", v, t]),
  });
  return {
    currentTime: 10,
    destination: {},
    oscillators,
    createOscillator() {
      const osc = { type: null, freq: [], frequency: null, connect() {}, start() {}, stop() {} };
      osc.frequency = param(osc.freq);
      oscillators.push(osc);
      return osc;
    },
    createGain() {
      const g = { log: [], connect() {} };
      g.gain = param(g.log);
      return g;
    },
  };
}

async function cues(t) {
  const { vite } = await loadAudioManager(t, {
    cachePrefix: "openwhispr-cues-",
    settingsKey: "__cueSettings",
    settings: { audioCuesEnabled: true },
  });
  return vite.ssrLoadModule("/utils/dictationCues.js");
}

test("soft start is E5 then B5, each with a 2nd harmonic", async (t) => {
  const { scheduleCue } = await cues(t);
  const ctx = fakeContext();
  assert.equal(scheduleCue(ctx, "soft", "start", "medium"), 4);
  const fundamentals = ctx.oscillators.filter((_, i) => i % 2 === 0).map((o) => o.freq[0][1]);
  assert.deepEqual(fundamentals, [659.25, 987.77]);
  assert.equal(ctx.oscillators[1].freq[0][1], 659.25 * 2);
});

test("soft cues peak at 0.12 or below; classic keeps today's 0.2", async (t) => {
  const { CUE_SETS } = await cues(t);
  for (const notes of Object.values(CUE_SETS.soft)) {
    for (const note of notes ?? []) assert.ok((note.gain ?? 0.12) <= 0.12);
  }
  assert.deepEqual(
    CUE_SETS.classic.start.map((n) => n.freq),
    [523.25, 659.25]
  );
  assert.equal(CUE_SETS.classic.success, null);
});

test("cancel glides A4 down to F4", async (t) => {
  const { scheduleCue } = await cues(t);
  const ctx = fakeContext();
  scheduleCue(ctx, "soft", "cancel", "medium");
  assert.deepEqual(ctx.oscillators[0].freq.find(([kind]) => kind === "exp").slice(0, 2), [
    "exp",
    349.23,
  ]);
});

test("the full family exists: start, stop, success, cancel, error, mic back", async (t) => {
  const { CUE_SETS } = await cues(t);
  assert.deepEqual(Object.keys(CUE_SETS.soft).sort(), [
    "back",
    "cancel",
    "error",
    "start",
    "stop",
    "success",
  ]);
  assert.deepEqual(
    CUE_SETS.soft.error.map((n) => n.freq),
    [293.66, 220]
  );
});

test("low volume halves the envelope peak", async (t) => {
  const { scheduleCue } = await cues(t);
  const peak = (volume) => {
    const ctx = fakeContext();
    const gains = [];
    const make = ctx.createGain.bind(ctx);
    ctx.createGain = () => {
      const g = make();
      gains.push(g);
      return g;
    };
    scheduleCue(ctx, "soft", "back", volume);
    return gains[0].log.find(([kind]) => kind === "lin")[1];
  };
  assert.ok(Math.abs(peak("low") - peak("medium") / 2) < 1e-9);
});

test("all picked notes schedule their exact attacks, harmonics, glides and tails; classic stays single sine", async (t) => {
  const { scheduleCue, CUE_SETS, CUE_VOLUME } = await cues(t);
  assert.deepEqual(CUE_VOLUME, { low: 0.5, medium: 1, high: 1.4 });
  for (const [setName, family] of Object.entries(CUE_SETS)) {
    for (const [cue, notes] of Object.entries(family)) {
      for (const [volume, scale] of Object.entries(CUE_VOLUME)) {
        const ctx = fakeContext();
        const gains = [];
        const makeGain = ctx.createGain;
        ctx.createGain = () => {
          const gain = makeGain();
          gains.push(gain);
          return gain;
        };
        const soft = setName === "soft";
        assert.equal(scheduleCue(ctx, setName, cue, volume), (notes?.length ?? 0) * (soft ? 2 : 1));
        for (const [index, note] of (notes ?? []).entries()) {
          const start = 10.02 + note.at / 1000;
          const end = start + note.dur / 1000;
          for (let partial = 0; partial < (soft ? 2 : 1); partial++) {
            const offset = index * (soft ? 2 : 1) + partial;
            const weight = partial ? 0.2 : 1;
            assert.equal(ctx.oscillators[offset].type, "sine");
            assert.deepEqual(ctx.oscillators[offset].freq[0], [
              "set",
              note.freq * (partial + 1),
              start,
            ]);
            assert.deepEqual(gains[offset].log, [
              ["set", 0.0001, start],
              [
                "lin",
                (note.gain ?? (soft ? 0.12 : 0.2)) * scale * weight,
                start + (soft ? 0.004 : 0.015),
              ],
              ["exp", 0.0001, end + (soft ? 0.04 : 0)],
            ]);
          }
        }
      }
    }
  }
});

test("public players use current settings, mute without context, recover closed context and contain audio failures", async (t) => {
  const { window, vite, setSettings } = await loadAudioManager(t, {
    cachePrefix: "loqui-cue-players-",
    settingsKey: "__cuePlayers",
    settings: { audioCuesEnabled: false },
  });
  let contexts = [];
  window.AudioContext = class {
    constructor() {
      Object.assign(this, fakeContext());
      this.state = "running";
      contexts.push(this);
    }
  };
  const players = await vite.ssrLoadModule("/utils/dictationCues.js");
  await players.playStartCue();
  assert.equal(contexts.length, 0);
  setSettings({ audioCuesEnabled: true, dictationCueSet: "soft", dictationCueVolume: "low" });
  await players.playStartCue();
  assert.equal(contexts[0].oscillators.length, 4);
  setSettings({ audioCuesEnabled: true, dictationCueSet: "classic", dictationCueVolume: "high" });
  await players.playSuccessCue();
  assert.equal(contexts[0].oscillators.length, 4);
  await players.playStopCue();
  assert.equal(contexts[0].oscillators.length, 6);
  contexts[0].state = "closed";
  await players.playStartCue();
  assert.equal(contexts.length, 2);
  setSettings({ audioCuesEnabled: true, dictationCueSet: "soft", dictationCueVolume: "medium" });
  contexts[1].state = "suspended";
  contexts[1].resume = async () => {
    throw Error("fake unavailable device");
  };
  await assert.doesNotReject(players.playErrorCue());
  contexts[1].state = "running";
  contexts[1].createOscillator = () => {
    throw Error("fake schedule failure");
  };
  await assert.doesNotReject(players.playCancelCue());
});
