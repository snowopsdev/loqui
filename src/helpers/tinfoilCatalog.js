// Tinfoil's model list comes from the attested endpoint.
// Fetching from the main process rather than the renderer lets every window share one request.
const debugLogger = require("./debugLogger");
const { tinfoilSecureFetch } = require("./tinfoilSecureClient");
const egress = require("./privacy/egressGate");
const { isSealedModeError } = require("./privacy/egressPolicy");

const TINFOIL_MODELS_PATH = "/v1/models";
const RETRY_AFTER_FAILURE_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

let lastFailureAt = 0;
let inFlight = null;

/**
 * The list mixes chat, audio, tts, embedding and tool models, so narrow it to
 * the ones we can send a chat completion to.
 */
function isChatModel(model) {
  if (!model || model.type !== "chat") return false;
  return Array.isArray(model.endpoints) && model.endpoints.includes("/v1/chat/completions");
}

function toCatalogModel(model) {
  return {
    id: model.id,
    name: typeof model.name === "string" && model.name ? model.name : model.id,
    description: typeof model.description === "string" ? model.description : "",
    supportsThinking: model.reasoning === true,
  };
}

function parseModels(payload) {
  const data = payload?.data;
  if (!Array.isArray(data)) {
    throw new Error("Malformed models list");
  }
  return data
    .filter((model) => typeof model?.id === "string" && model.id && isChatModel(model))
    .map(toCatalogModel);
}

// Sealed mode: one providerCheck ticket spans the attestation, the request and
// the JSON read. The Tinfoil SDK has its own transport, so the hand-off is the
// dispatch evidence and Layer B attributes its sockets to this ticket.
async function fetchModels() {
  return egress.guard(
    { task: "providerCheck", target: "https://inference.tinfoil.sh", provider: "tinfoil" },
    async (ticket) => {
      ticket.markDispatched();
      // The first call also attests the enclave, so allow for more than a plain GET.
      const response = await tinfoilSecureFetch(TINFOIL_MODELS_PATH, {
        method: "GET",
        signal: AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), ticket.signal]),
      });
      ticket.noteStatus(response.status);
      if (!response.ok) {
        throw new Error(`Tinfoil models request failed: ${response.status}`);
      }
      return parseModels(await response.json());
    }
  );
}

/**
 * Resolves to Tinfoil's chat models. Rejects when
 * the fetch fails so callers can tell "Tinfoil says this model is gone" apart
 * from "we couldn't ask".
 */
async function getTinfoilChatModels() {
  if (Date.now() - lastFailureAt < RETRY_AFTER_FAILURE_MS) {
    throw new Error("Tinfoil models unavailable");
  }

  if (!inFlight) {
    inFlight = fetchModels()
      .then((models) => {
        lastFailureAt = 0;
        return models;
      })
      .catch((error) => {
        // A Sealed mode refusal says nothing about Tinfoil; do not back off.
        if (!isSealedModeError(error)) lastFailureAt = Date.now();
        debugLogger.warn("Failed to fetch Tinfoil models", { error: error.message });
        throw error;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  return inFlight;
}

module.exports = { getTinfoilChatModels };
