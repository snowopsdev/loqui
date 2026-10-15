import type { InferenceMode } from "../types/electron";

// Where a route's data goes. Shape (solid/dotted/dashed ring) carries this
// first; see DESIGN.md "Motion" and "Roles". Anything unrecognised resolves
// to "remote" so the UI over-discloses rather than under-discloses.
export type Locality = "device" | "network" | "remote";

export interface RouteLocality {
  locality: Locality;
  provider: string | null;
}

const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  vertex: "Google Vertex AI",
  groq: "Groq",
  mistral: "Mistral",
  xai: "xAI",
  openrouter: "OpenRouter",
  bedrock: "AWS Bedrock",
  azure: "Azure OpenAI",
  codex: "ChatGPT (Codex)",
  tinfoil: "Tinfoil",
  deepgram: "Deepgram",
  assemblyai: "AssemblyAI",
  custom: "Custom endpoint",
};

export function providerDisplayName(providerId: string | null | undefined): string {
  const id = (providerId ?? "").trim();
  if (!id) return "Unknown provider";
  const known = PROVIDER_NAMES[id.toLowerCase()];
  if (known) return known;
  return id
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function providerMonogram(displayName: string): string {
  const words = displayName.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].charAt(0).toUpperCase() + words[0].charAt(1);
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLoopbackUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost");
  } catch {
    return false;
  }
}

export function resolveLocality(input: {
  mode: InferenceMode | string | null | undefined;
  provider?: string | null;
  remoteUrl?: string | null;
}): RouteLocality {
  if (input.mode === "local") return { locality: "device", provider: null };
  if (input.mode === "self-hosted") {
    return isLoopbackUrl(input.remoteUrl)
      ? { locality: "device", provider: null }
      : { locality: "network", provider: null };
  }
  return { locality: "remote", provider: providerDisplayName(input.provider) };
}
