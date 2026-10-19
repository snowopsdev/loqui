import type { TextOperationDescriptor } from "../services/ai/personalInferenceTypes";
import type { Locality } from "../lib/locality";
import type { ResolvedRoute } from "../lib/routes";
import type { CleanupChoice, CleanupStatus } from "./onboardingCleanup";

// Before and after (ONB-R6 B): the user chooses by seeing. Their own words appear
// only after a run really happened: automatically on this device, or after an
// explicit tap for a remote provider (M01).
export interface WordSegment {
  text: string;
  changed: boolean;
}

const tokens = (text: string) => text.trim().split(/\s+/).filter(Boolean);

export function countWords(text: string): number {
  return tokens(text).length;
}

export function diffWords(original: string, cleaned: string): WordSegment[] {
  const a = tokens(original);
  const b = tokens(cleaned);
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: WordSegment[] = [];
  let i = 0;
  let j = 0;
  while (j < b.length) {
    if (i < a.length && a[i] === b[j]) {
      out.push({ text: b[j], changed: false });
      i++;
      j++;
    } else if (i < a.length && lcs[i + 1][j] >= lcs[i][j + 1]) {
      i++;
    } else {
      out.push({ text: b[j], changed: true });
      j++;
    }
  }
  return out;
}

export interface CleanupExamples {
  original: string;
  local: string;
  codex: string;
  provider: string;
}

export interface CleanupRun {
  text: string;
  locality: Locality;
}

export interface CleanupPreview {
  original: string;
  segments: WordSegment[];
  source: "yours" | "example";
  locality: Locality | null;
  wordsSent: number | null;
}

export function cleanupPreview({
  choice,
  userText,
  run,
  examples,
}: {
  choice: CleanupChoice;
  userText: string | null;
  run: CleanupRun | null;
  examples: CleanupExamples;
}): CleanupPreview {
  const yours = userText?.trim() || null;
  if (choice === "none") {
    const original = yours ?? examples.original;
    return {
      original,
      segments: diffWords(original, original),
      source: yours ? "yours" : "example",
      locality: null,
      wordsSent: null,
    };
  }
  const remote = choice === "codex" || choice === "provider";
  if (yours && run) {
    return {
      original: yours,
      segments: diffWords(yours, run.text),
      source: "yours",
      locality: run.locality,
      wordsSent: run.locality === "device" ? null : countWords(yours),
    };
  }
  return {
    original: examples.original,
    segments: diffWords(examples.original, examples[choice]),
    source: "example",
    locality: remote ? "remote" : "device",
    wordsSent: remote ? countWords(yours ?? examples.original) : null,
  };
}

export type CleanupSituation =
  "off" | "checking" | "ready" | "needsModel" | "needsConnection" | "needsKey" | "unreachable";

const UNMET: Record<Exclude<CleanupChoice, "none">, CleanupSituation> = {
  local: "needsModel",
  codex: "needsConnection",
  provider: "needsKey",
};

/**
 * I05: a chosen-but-unavailable cleanup is never "off". Until the choice's own
 * check passes, its unmet prerequisite is the answer; after it passes, the route
 * the app will really use decides.
 */
export function cleanupSituation(
  choice: CleanupChoice,
  status: CleanupStatus,
  route: ResolvedRoute
): CleanupSituation {
  if (choice === "none") return "off";
  if (status === "checking") return "checking";
  if (status !== "ready") return UNMET[choice];
  switch (route.state.status) {
    case "ready":
      return "ready";
    case "unknown":
      return "checking"; // §5.1 rule 1: never ready until main confirms
    case "off":
      return UNMET[choice];
    case "needsModel":
      return "needsModel";
    case "needsKey":
      return "needsKey";
    default:
      return "unreachable";
  }
}

/** Typed allowlist: never serialize/spread settings, which can contain secrets. */
export function copyCleanupDescriptor(value: TextOperationDescriptor): TextOperationDescriptor {
  const enterprise = value.expectedEnterprise;
  return Object.freeze({
    provider: value.provider,
    model: value.model,
    inferenceScope: value.inferenceScope,
    credentialRef: value.credentialRef,
    baseUrl: value.baseUrl,
    systemPrompt: value.systemPrompt,
    maxTokens: value.maxTokens,
    temperature: value.temperature,
    disableThinking: value.disableThinking,
    requireCompleteOutput: value.requireCompleteOutput,
    timeoutMs: value.timeoutMs,
    cleanupContext: value.cleanupContext
      ? Object.freeze({
          language: value.cleanupContext.language,
          uiLanguage: value.cleanupContext.uiLanguage,
          dictionary: Object.freeze([...value.cleanupContext.dictionary]),
          chineseScriptPreference: value.cleanupContext.chineseScriptPreference,
        })
      : undefined,
    expectedEnterprise: enterprise
      ? Object.freeze({
          ...(value.provider === "azure"
            ? {
                azureEndpoint: enterprise.azureEndpoint,
                azureApiVersion: enterprise.azureApiVersion,
              }
            : {}),
          ...(value.provider === "vertex"
            ? {
                vertexProject: enterprise.vertexProject,
                vertexLocation: enterprise.vertexLocation,
                vertexAuthSource: enterprise.vertexAuthSource,
              }
            : {}),
          ...(value.provider === "bedrock"
            ? { bedrockRegion: enterprise.bedrockRegion, bedrockProfile: enterprise.bedrockProfile }
            : {}),
        })
      : undefined,
    expectedAuthority: value.expectedAuthority
      ? Object.freeze({
          credentialGeneration: value.expectedAuthority.credentialGeneration,
          enterpriseVersion: value.expectedAuthority.enterpriseVersion,
        })
      : undefined,
  });
}
