const { routeBaseState } = require("./routeStateFixture");

const TEAM_A = "https://gateway.example/team-a";
const TEAM_B = "https://gateway.example/team-b";
const ENDPOINT_CASES = [];
for (const [id, prefix] of [
  ["dictationCleanup", "cleanup"],
  ["voiceAssistant", "dictationAgent"],
  ["noteFormatting", "noteFormatting"],
  ["chat", "chatAgent"],
  ["translation", "translation"],
]) {
  for (const mode of ["providers", "self-hosted"]) {
    const key = prefix + (mode === "providers" ? "CloudBaseUrl" : "RemoteUrl");
    ENDPOINT_CASES.push({
      key,
      id,
      ids: id === "voiceAssistant" ? [id, "assistantVision"] : [id],
      overrides: {
        [prefix + "Mode"]: mode,
        [prefix + "Provider"]: "custom",
        [prefix + "Model"]: "fixture-model",
        [key]: TEAM_A,
      },
    });
  }
}
ENDPOINT_CASES.push(
  {
    key: "dictationAgentVisionCloudBaseUrl",
    id: "assistantVision",
    ids: ["assistantVision"],
    overrides: {
      useDictationAgentVisionModel: true,
      dictationAgentVisionProvider: "custom",
      dictationAgentVisionModel: "vision-model",
      dictationAgentVisionCloudBaseUrl: TEAM_A,
    },
  },
  {
    key: "cloudTranscriptionBaseUrl",
    id: "dictationStt",
    ids: ["dictationStt", "uploadStt"],
    overrides: {
      transcriptionMode: "providers",
      useLocalWhisper: false,
      cloudTranscriptionProvider: "custom",
      cloudTranscriptionModel: "fixture-model",
      cloudTranscriptionBaseUrl: TEAM_A,
      uploadTranscriptionMode: "providers",
      uploadUseLocalWhisper: false,
    },
  },
  {
    key: "uploadCloudTranscriptionBaseUrl",
    id: "uploadStt",
    ids: ["uploadStt"],
    overrides: {
      uploadTranscriptionMode: "providers",
      uploadUseLocalWhisper: false,
      uploadCloudTranscriptionProvider: "custom",
      uploadCloudTranscriptionModel: "fixture-model",
      uploadCloudTranscriptionBaseUrl: TEAM_A,
    },
  },
  {
    key: "remoteTranscriptionUrl",
    id: "dictationStt",
    ids: ["dictationStt", "uploadStt"],
    overrides: {
      transcriptionMode: "self-hosted",
      useLocalWhisper: false,
      remoteTranscriptionUrl: TEAM_A,
      remoteTranscriptionModel: "fixture-model",
      uploadTranscriptionMode: "self-hosted",
      uploadUseLocalWhisper: false,
    },
  },
  {
    key: "azureEndpoint",
    id: "dictationCleanup",
    ids: ["dictationCleanup", "chat"],
    overrides: {
      azureEndpoint: TEAM_A,
      cleanupMode: "enterprise",
      cleanupProvider: "azure",
      cleanupModel: "deployment",
      chatAgentMode: "enterprise",
      chatAgentProvider: "azure",
      chatAgentModel: "deployment",
    },
  }
);
const endpointState = (entry, url = TEAM_A) => ({
  ...routeBaseState(),
  ...entry.overrides,
  [entry.key]: url,
});
// Literal expected transport URLs, checked against the real enterprise factory/SDK.
const AZURE_ENDPOINT_CASES = [
  {
    from: TEAM_A + "/.",
    to: TEAM_A + "//",
    targets: [TEAM_A + "/responses", TEAM_A + "//responses"],
    staged: true,
  },
  {
    from: TEAM_A + "//",
    to: TEAM_A + "///",
    targets: [TEAM_A + "//responses", TEAM_A + "///responses"],
    staged: true,
  },
  {
    from: "https://fixture.openai.azure.com/openai/.",
    to: "https://fixture.openai.azure.com/openai//",
    targets: [
      "https://fixture.openai.azure.com/openai/v1/responses?api-version=2024-10-21",
      "https://fixture.openai.azure.com/openai//v1/responses?api-version=2024-10-21",
    ],
    staged: true,
  },
  {
    from: "https://fixture.services.ai.azure.com/openai/v1/.",
    to: "https://fixture.services.ai.azure.com/openai/v1//",
    targets: [
      "https://fixture.services.ai.azure.com/openai/v1/responses",
      "https://fixture.services.ai.azure.com/openai/v1//responses",
    ],
    staged: true,
  },
  {
    from: "https://gateway.example/openai",
    to: "https://gateway.example/openai/",
    targets: Array(2).fill("https://gateway.example/openai/responses"),
    staged: false,
  },
  {
    from: TEAM_A + "/%2e",
    to: TEAM_A + "/",
    targets: Array(2).fill(TEAM_A + "/responses"),
    staged: false,
  },
  {
    from: TEAM_A + "/child/..",
    to: TEAM_A,
    targets: Array(2).fill(TEAM_A + "/responses"),
    staged: false,
  },
  {
    from: "https://fixture.cognitiveservices.azure.com/openai/.",
    to: "https://FIXTURE.cognitiveservices.azure.com:443/openai/",
    targets: Array(2).fill(
      "https://fixture.cognitiveservices.azure.com/openai/v1/responses?api-version=2024-10-21"
    ),
    staged: false,
  },
];
module.exports = { TEAM_A, TEAM_B, ENDPOINT_CASES, endpointState, AZURE_ENDPOINT_CASES };
