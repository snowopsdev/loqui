// Child-process output retention with a fixed memory ceiling.
//
// Sidecars (whisper, llama, qdrant, sherpa) log to stderr for as long as they
// run, which can be days. Accumulating that text for startup diagnostics grew
// without bound, so callers keep only what diagnostics read: the opening lines
// (device probes, bind addresses) and the most recent output (the failure).

const DEFAULT_HEAD_CHARS = 8 * 1024;
const DEFAULT_TAIL_CHARS = 24 * 1024;
// Line-oriented helpers frame JSON messages by newline; a partial line longer
// than this is not a message we will ever parse.
const MAX_PENDING_LINE_CHARS = 64 * 1024;

class BoundedOutput {
  constructor({ headChars = DEFAULT_HEAD_CHARS, tailChars = DEFAULT_TAIL_CHARS } = {}) {
    this.headChars = headChars;
    this.tailChars = tailChars;
    this.head = "";
    this.tail = "";
    this.droppedChars = 0;
  }

  append(chunk) {
    let text = String(chunk);
    if (this.head.length < this.headChars) {
      const room = this.headChars - this.head.length;
      this.head += text.slice(0, room);
      text = text.slice(room);
    }
    if (!text) return this;
    const combined = this.tail + text;
    const overflow = combined.length - this.tailChars;
    if (overflow > 0) {
      this.droppedChars += overflow;
      this.tail = combined.slice(overflow);
    } else {
      this.tail = combined;
    }
    return this;
  }

  get length() {
    return this.head.length + this.tail.length;
  }

  toString() {
    if (!this.droppedChars) return this.head + this.tail;
    return `${this.head}\n[... ${this.droppedChars} characters omitted ...]\n${this.tail}`;
  }
}

/**
 * Bounds the unparsed remainder of a newline-framed stream. Returns the
 * remainder unchanged unless it exceeds maxChars, in which case the oversized
 * partial line is discarded (its start is already lost to framing anyway).
 */
function capPendingLine(remainder, maxChars = MAX_PENDING_LINE_CHARS, onDrop) {
  if (remainder.length <= maxChars) return remainder;
  onDrop?.(remainder.length);
  return "";
}

module.exports = {
  BoundedOutput,
  capPendingLine,
  DEFAULT_HEAD_CHARS,
  DEFAULT_TAIL_CHARS,
  MAX_PENDING_LINE_CHARS,
};
