const WebSocket = require("ws");
const OpenAIRealtimeStreaming = require("./openaiRealtimeStreaming");
const { createTinfoilRealtimeSocket } = require("./tinfoilSecureClient");
const debugLogger = require("./debugLogger");

const TINFOIL_REALTIME_MODEL = "voxtral-mini-4b-realtime";

const COMMIT_POLL_MS = 250;
// Mirrors the silence_duration_ms the OpenAI path configures in server_vad.
const COMMIT_IDLE_MS = 600;
// Bounds the text lost on abrupt socket death and keeps segments flowing to diarization.
const MAX_UTTERANCE_MS = 30000;
const COMMIT_ACK_TIMEOUT_MS = 10000;

// Tinfoil's transcription intent has no server VAD, so utterance boundaries
// are decided client-side from the delta stream and committed explicitly.
class TinfoilRealtimeStreaming extends OpenAIRealtimeStreaming {
  constructor(createSocketImpl = createTinfoilRealtimeSocket) {
    super();
    this._createSocketImpl = createSocketImpl;
    this._commitTimer = null;
    this._commitInFlight = false;
    this._commitSentAt = 0;
    this._lastDeltaAt = 0;
  }

  // Audio must only ever reach the attested Tinfoil socket, so a
  // caller-supplied factory is overridden, never honored.
  async connect(options = {}) {
    const { apiKey } = options;
    const model = options.model || TINFOIL_REALTIME_MODEL;
    return super.connect({
      ...options,
      model,
      createSocket: () => this._createSocketImpl({ model, apiKey }),
    });
  }

  handleMessage(data) {
    let type;
    try {
      type = JSON.parse(data.toString()).type;
    } catch {
      // Malformed frames are logged by the base handler.
    }
    if (type === "conversation.item.input_audio_transcription.delta") {
      this._lastDeltaAt = Date.now();
      // No speech_started events without server VAD; the first delta of an
      // utterance is the closest signal for the mic-suppression window.
      if (!this.speechStartedAt) this.speechStartedAt = this._lastDeltaAt;
    } else if (
      type === "conversation.item.input_audio_transcription.completed" ||
      type === "error"
    ) {
      this._commitInFlight = false;
    }
    super.handleMessage(data);
  }

  _markConnected() {
    super._markConnected();
    this._startCommitTimer();
  }

  _startCommitTimer() {
    this._stopCommitTimer();
    this._commitTimer = setInterval(() => this._commitTick(), COMMIT_POLL_MS);
  }

  _stopCommitTimer() {
    if (this._commitTimer) {
      clearInterval(this._commitTimer);
      this._commitTimer = null;
    }
  }

  _commitTick() {
    if (this.isDisconnecting || this.ws?.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (this._commitInFlight) {
      // A commit the server never answered must not block the session forever.
      if (now - this._commitSentAt >= COMMIT_ACK_TIMEOUT_MS) {
        debugLogger.debug("Tinfoil Realtime commit unanswered, re-arming");
        this._commitInFlight = false;
      }
      return;
    }
    // Committing before any delta would finalize an empty or silent buffer.
    if (!this.currentPartial) return;
    const idleFor = now - this._lastDeltaAt;
    const utteranceAge = now - (this.speechStartedAt || now);
    if (idleFor < COMMIT_IDLE_MS && utteranceAge < MAX_UTTERANCE_MS) return;
    this._commitInFlight = true;
    this._commitSentAt = now;
    try {
      this.ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    } catch (err) {
      this._commitInFlight = false;
      debugLogger.debug("Tinfoil Realtime commit send failed", { error: err.message });
    }
  }

  cleanup() {
    this._stopCommitTimer();
    this._commitInFlight = false;
    super.cleanup();
  }
}

module.exports = { TinfoilRealtimeStreaming, TINFOIL_REALTIME_MODEL };
