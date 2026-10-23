import type { DisclosureTask } from "../../types/dictation";
interface TextTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface TextRequest {
  disclosureTask?: DisclosureTask | null;
  requestId: string;
  correlationId?: string | null;
  dictationOperation?: true;
  dictationSessionId?: string | null;
  enterpriseRecipientTag?: string | null;
  provider: string;
  model: string;
  credentialRef?: string;
  baseUrl?: string;
  systemPrompt?: string;
  messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>;
  inferenceScope?: string;
  tools?: TextTool[];
  maxTokens?: number;
  temperature?: number;
  disableThinking?: boolean;
  webSearch?: boolean;
  requireCompleteOutput?: boolean;
  timeoutMs?: number;
}
interface CodexAccount {
  type: string;
  email?: string | null;
  planType?: string;
}
interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  isDefault?: boolean;
  inputModalities?: string[];
}
export interface InferenceEvent {
  type: "chunk" | "end" | "error" | "tool" | "account";
  requestId?: string;
  chunk?: { type: string; text?: string; finishReason?: string };
  error?: string;
  code?: string;
  callId?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  method?: string;
  params?: Record<string, unknown>;
}
export interface ModelDiscoveryInput {
  provider: string;
  baseUrl?: string;
  credentialRef?: string;
  inferenceScope?: string;
}
export interface ModelDiscoveryDescription {
  recipientToken: string;
  host: string;
  credentialId: string;
  present: boolean;
  generation: number;
}
export interface PersonalInferenceAPI {
  captureTextOperation(descriptor: TextOperationDescriptor): Promise<string>;
  runTextOperation(input: { token: string; request: CapturedTextInput }): Promise<{ text: string }>;
  retireTextOperation(token: string): Promise<void>;
  describeModels(input: ModelDiscoveryInput): Promise<ModelDiscoveryDescription>;
  codexStatus(): Promise<{
    available: boolean;
    version?: string;
    account?: CodexAccount | null;
    error?: string;
    code?: string;
  }>;
  codexLogin(): Promise<{ loginId: string }>;
  codexCancelLogin(loginId: string): Promise<unknown>;
  codexLogout(): Promise<unknown>;
  codexModels(): Promise<{ data: CodexModel[]; nextCursor: string | null }>;
  /** Passive main-RAM snapshot from explicit discovery in this account/session. */
  codexModelCatalog(): Promise<{
    connected: boolean;
    data: Array<{ model: string; isDefault: boolean }>;
  }>;
  codexRateLimits(): Promise<{
    rateLimits?: { primary?: { usedPercent: number }; secondary?: { usedPercent: number } };
    rateLimitsByLimitId?: Record<string, unknown>;
  }>;
  models(input: ModelDiscoveryInput & { recipientToken: string }): Promise<{
    data: Array<{ id: string; name?: string; owned_by?: string; description?: string }>;
  }>;
  credentialStatus(ref: string): Promise<{ configured: boolean }>;
  credentialSave(ref: string, value: string): Promise<{ configured: boolean }>;
  textGenerate(request: TextRequest): Promise<{ text: string }>;
  textStream(request: TextRequest): Promise<void>;
  textCancel(requestId: string): Promise<void>;
  textToolResult(result: {
    requestId: string;
    callId: string;
    result?: unknown;
    error?: string;
  }): Promise<void>;
  onTextEvent(callback: (event: InferenceEvent) => void): () => void;
}

/** Nonsecret configuration fixed at user admission. Main captures credentials. */
export interface TextOperationDescriptor extends Omit<
  TextRequest,
  "requestId" | "messages" | "tools" | "webSearch"
> {
  /** Renderer admission revision; never substitutes for main authority. */
  selectionRevision?: number;
  expectedEnterprise?: Record<string, string>;
  expectedAuthority?: { credentialGeneration?: number; enterpriseVersion?: number };
  cleanupContext?: {
    language: string;
    uiLanguage: string;
    dictionary: readonly string[];
    chineseScriptPreference: string;
  };
  cleanupIdentity?: CleanupOperationIdentity;
}
/** String transport IDs; unrelated to recording session IDs or reducer counters. */
export interface CleanupOperationIdentity {
  demoId: string;
  takeId: string;
  operationId: string;
}
export interface CapturedTextInput {
  messages: TextRequest["messages"];
  wordCount: number;
}
export type CleanupRetryResult = CleanupOperationIdentity &
  ({ ok: true; text: string } | { ok: false; code: string });
export interface CleanupRetryRequest extends CleanupOperationIdentity {
  requestId: string;
}
export interface CleanupRetryReply extends CleanupRetryRequest {
  text?: string;
  code?: string;
}
