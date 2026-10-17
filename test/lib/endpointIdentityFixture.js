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
module.exports = { TEAM_A, TEAM_B, ENDPOINT_CASES, endpointState };
