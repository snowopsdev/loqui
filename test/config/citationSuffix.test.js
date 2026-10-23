const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "../..");

test("the citation instruction is a suffix, so the chat prompt hash ratchet is untouched", () => {
  const index = fs.readFileSync(path.join(root, "src/config/prompts/index.ts"), "utf8");
  assert.match(index, /export function appendCitationSuffix\(prompt: string\): string/);
  assert.match(index, /\[note:ID\]/);
  assert.match(
    fs.readFileSync(path.join(root, "src/config/prompts.ts"), "utf8"),
    /appendCitationSuffix,/
  );
  const streaming = fs.readFileSync(
    path.join(root, "src/components/chat/useChatStreaming.ts"),
    "utf8"
  );
  assert.match(
    streaming,
    /if \(citations && hasSources\) systemPrompt = appendCitationSuffix\(systemPrompt\)/
  );
  assert.match(streaming, /citations\?: boolean/);
  // Only the Chat view opts in; other chat surfaces would show raw markers.
  for (const other of [
    "src/components/dictation/AssistantPanel.tsx",
    "src/hooks/useEmbeddedChat.ts",
    "src/hooks/useContainerChat.ts",
  ]) {
    assert.doesNotMatch(
      fs.readFileSync(path.join(root, other), "utf8"),
      /citations:\s*true/,
      other
    );
  }
  assert.match(
    fs.readFileSync(path.join(root, "src/components/chat/ChatView.tsx"), "utf8"),
    /citations:\s*true/
  );
});

test("tool results reach the renderer with their sources", () => {
  const service = fs.readFileSync(path.join(root, "src/services/ReasoningService.ts"), "utf8");
  assert.match(service, /metadata:\s*toToolMetadata\(event\.name, result\)/);
});
