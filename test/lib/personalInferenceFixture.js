// Main-process bridge fixture for renderer tests. Existing SSE fixtures remain
// reusable, while the actual renderer sees only the credential-free IPC API.
function personalInferenceFixture() {
  const listeners = new Set();
  const controllers = new Map();
  const emit = (event) => {
    for (const listener of listeners) listener(event);
  };
  return {
    onTextEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async textStream(request) {
      const controller = new AbortController();
      controllers.set(request.requestId, controller);
      try {
        const response = await globalThis.fetch(request.baseUrl, { signal: controller.signal });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          const lines = pending.split("\n");
          pending = lines.pop();
          for (const line of lines) {
            if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
            const data = JSON.parse(line.slice(6));
            const choice = data.choices?.[0];
            if (choice?.delta?.content)
              emit({
                requestId: request.requestId,
                type: "chunk",
                chunk: { type: "content", text: choice.delta.content },
              });
            if (choice?.finish_reason)
              emit({
                requestId: request.requestId,
                type: "chunk",
                chunk: { type: "done", finishReason: choice.finish_reason },
              });
          }
        }
        emit({ requestId: request.requestId, type: "end" });
      } finally {
        controllers.delete(request.requestId);
      }
    },
    async textCancel(id) {
      controllers.get(id)?.abort();
    },
  };
}
module.exports = { personalInferenceFixture };
