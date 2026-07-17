/**
 * Per-provider dialects for turning a model's thinking off. Kept free of runtime
 * imports so the dialect table stays unit-testable on its own.
 */
export function suppressThinking(
  requestBody: Record<string, unknown>,
  providerKey: string,
  model: string
): void {
  if (providerKey === "gemini") {
    requestBody.reasoning_effort = "minimal";
    return;
  }

  // OpenRouter forwards unknown params to upstream backends, which may reject
  // them — use its native reasoning control instead.
  if (providerKey === "openrouter") {
    requestBody.reasoning = { enabled: false };
    return;
  }

  // Groq rejects unknown fields outright and takes a different reasoning_effort
  // enum per model family, so send nothing unless the family is known.
  if (providerKey === "groq") {
    const groqModel = (model || "").toLowerCase();
    if (groqModel.includes("qwen")) {
      // qwen3 accepts none|default only.
      requestBody.reasoning_effort = "none";
    } else if (groqModel.includes("gpt-oss")) {
      // gpt-oss accepts low|medium|high only; it has no off switch.
      requestBody.reasoning_effort = "low";
    }
    return;
  }

  if (providerKey === "local") {
    requestBody.think = false;
  } else if (providerKey === "lan") {
    // `lan` always talks to an OpenAI-compat /v1 endpoint: the `reasoning` object
    // disables Ollama thinking; other backends drop it (flat reasoning_effort trips vLLM).
    requestBody.reasoning = { effort: "none" };
  } else {
    requestBody.reasoning_effort = "none";
  }
  requestBody.chat_template_kwargs = { enable_thinking: false };
}
