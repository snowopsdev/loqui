const http = require("http");
const crypto = require("crypto");
const { openExternalUrl } = require("./externalUrlOpener");

const OAUTH_TIMEOUT_MS = 120000;
// OAuth completes locally; no hosted callback or custom URL scheme is required.
class OAuthFlowError extends Error {
  constructor(redirectCode, message) {
    super(message);
    this.redirectCode = redirectCode;
  }
}

function redirect(res, params) {
  const success = Object.keys(params).some((key) => key.endsWith("_connected"));
  res.writeHead(success ? 200 : 400, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
  });
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Loqui</title>
    <body><h1>${success ? "Calendar connected" : "Connection unsuccessful"}</h1>
    <p>You can close this tab and return to Loqui.</p></body></html>`);
}

// Every flow still in progress: waiting for its browser redirect, or with a
// claimed callback whose token exchange has not finished. Sealing cancels them
// all: a consent page that completes later must find nothing listening, and an
// exchange already under way is aborted (Task 11).
const activeFlows = new Set();

// reason: an Error, or ({ host }) => Error for the flow's sign-in host.
// Returns how many flows were cancelled.
function cancelAllOAuthFlows(reason) {
  let cancelled = 0;
  for (const flow of [...activeFlows]) {
    if (flow.cancel(typeof reason === "function" ? reason({ host: flow.host }) : reason))
      cancelled++;
  }
  return cancelled;
}

const activeOAuthFlowCount = () => activeFlows.size;

// Runs a PKCE auth-code flow through an ephemeral 127.0.0.1 server:
// - buildAuthUrl(redirectUri, state, codeChallenge) → provider authorize URL
// - handleCallback(code, redirectUri, codeVerifier, signal) → resolves the flow
//   result; called once with a state-validated code, throws (OAuthFlowError
//   for a specific callback-page code) to reject. `signal` aborts when the
//   flow is cancelled; nothing may be saved after it aborts.
// - errorParam — query-param name for the hosted desktop-callback page
//   (e.g. "gcal_error"); the success param is derived from the same prefix.
function runOAuthLoopbackFlow({ buildAuthUrl, handleCallback, errorParam }) {
  const connectedParam = errorParam.replace(/_error$/, "_connected");

  return new Promise((resolve, reject) => {
    const codeVerifier = crypto.randomBytes(32).toString("base64url").slice(0, 43);
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    const state = crypto.randomBytes(32).toString("hex");
    const exchange = new AbortController();
    let callbackClaimed = false;
    let settled = false;
    // The browser request whose callback was claimed, while its exchange runs.
    let pendingResponse = null;

    const flow = {
      host: null,
      cancel: (reason) => finish(reject, reason, "cancelled"),
    };
    activeFlows.add(flow);

    // Settles once. A rejection also aborts a claimed exchange still running
    // and answers its browser tab; that exchange's later outcome is ignored:
    // the flow already settled and its listener is closed.
    const finish = (settle, value, pageCode = "server_error") => {
      if (settled) return false;
      settled = true;
      callbackClaimed = true;
      const res = pendingResponse;
      pendingResponse = null;
      if (settle === reject) {
        exchange.abort(value);
        if (res && !res.headersSent) redirect(res, { [errorParam]: pageCode });
      }
      cleanup();
      settle(value);
      return true;
    };

    const server = http.createServer(async (req, res) => {
      // Accepted requests can outlive server.close(), so only the first
      // terminal callback may settle the flow or exchange a code.
      if (callbackClaimed) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<html><body><h3>Invalid request.</h3></body></html>");
        return;
      }

      try {
        const url = new URL(req.url, `http://127.0.0.1`);
        const returnedState = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          redirect(res, { [errorParam]: error });
          finish(reject, new Error(`OAuth error: ${error}`));
          return;
        }

        if (!code || returnedState !== state) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<html><body><h3>Invalid request.</h3></body></html>");
          // A real callback with a code but the wrong state is a failed
          // attempt (stale tab, CSRF). Fail the flow now. A request with no
          // code (favicon / bare GET) must keep waiting for the redirect.
          if (code) finish(reject, new Error("OAuth state mismatch"));
          return;
        }

        callbackClaimed = true;
        pendingResponse = res;
        const redirectUri = `http://127.0.0.1:${server.address().port}`;
        const result = await handleCallback(code, redirectUri, codeVerifier, exchange.signal);
        if (settled) return;

        redirect(res, { [connectedParam]: "true" });
        finish(resolve, result);
      } catch (err) {
        if (settled) return;
        redirect(res, { [errorParam]: err.redirectCode || "server_error" });
        finish(reject, err);
      }
    });

    let timeoutId;

    const cleanup = () => {
      clearTimeout(timeoutId);
      activeFlows.delete(flow);
      server.close();
    };

    server.listen(0, "127.0.0.1", () => {
      if (settled) return;
      const port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}`;
      const authUrl = buildAuthUrl(redirectUri, state, codeChallenge);
      try {
        flow.host = new URL(authUrl).hostname || null;
      } catch {
        flow.host = null;
      }
      // A failed browser launch surfaces as the flow timeout. A declined
      // consent page (Sealed mode asks first) ends the sign-in quietly.
      openExternalUrl(authUrl).then(
        (opened) => {
          if (opened === false)
            finish(
              reject,
              Object.assign(new OAuthFlowError("declined", "The sign-in page was not opened."), {
                declined: true,
              })
            );
        },
        () => {}
      );
    });

    timeoutId = setTimeout(() => {
      finish(reject, new Error("OAuth flow timed out"), "timeout");
    }, OAUTH_TIMEOUT_MS);

    server.on("error", (err) => {
      finish(reject, err);
    });
  });
}

module.exports = {
  runOAuthLoopbackFlow,
  OAuthFlowError,
  cancelAllOAuthFlows,
  activeOAuthFlowCount,
};
