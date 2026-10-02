const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const originalLoad = Module._load;
const modulePaths = {
  google: require.resolve("../../src/helpers/googleCalendarOAuth.js"),
  microsoft: require.resolve("../../src/helpers/microsoftCalendarOAuth.js"),
};

// Loads an OAuth helper against a recording stand-in for Electron's net.fetch.
// `reply` receives the request and returns { status, body } like a token endpoint.
function load(name, reply) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, body: String(init.body ?? ""), headers: init.headers });
    const { status = 200, body = "" } = await reply({ url });
    return { status, text: async () => body, json: async () => JSON.parse(body) };
  };
  delete require.cache[modulePaths[name]];
  Module._load = function loadWithElectronMock(request, parent, isMain) {
    if (request === "electron") return { net: { fetch }, shell: { openExternal() {} } };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return { OAuth: require(modulePaths[name]), requests };
  } finally {
    Module._load = originalLoad;
  }
}

const json = (value, status = 200) => ({ status, body: JSON.stringify(value) });

function database(row, key) {
  const saved = [];
  return {
    saved,
    [`get${key}Tokens`]: () => row,
    [`get${key}TokensByEmail`]: () => row,
    [`save${key}Tokens`]: (tokens) => saved.push(tokens),
  };
}

const expired = {
  google_email: "me@example.test",
  microsoft_email: "me@example.test",
  access_token: "old-access",
  refresh_token: "old-refresh",
  expires_at: Date.now() - 60_000,
  scope: "old-scope",
};

for (const [name, key] of [
  ["google", "Google"],
  ["microsoft", "Microsoft"],
]) {
  test(`${name}: a rejected refresh surfaces the provider error and keeps the stored tokens`, async () => {
    process.env.GOOGLE_CALENDAR_CLIENT_ID = process.env.MICROSOFT_CALENDAR_CLIENT_ID = "client";
    const { OAuth } = load(name, () =>
      json({ error: "invalid_grant", error_description: "Token has been revoked." }, 400)
    );
    const db = database(expired, key);
    await assert.rejects(
      new OAuth(db).getValidAccessToken("me@example.test"),
      /Token refresh failed: Token has been revoked/
    );
    assert.deepEqual(db.saved, []);
  });

  test(`${name}: a non-JSON refresh reply fails without touching the stored tokens`, async () => {
    process.env.GOOGLE_CALENDAR_CLIENT_ID = process.env.MICROSOFT_CALENDAR_CLIENT_ID = "client";
    const { OAuth } = load(name, () => ({ status: 502, body: "<html>Bad gateway</html>" }));
    const db = database(expired, key);
    await assert.rejects(
      new OAuth(db).getValidAccessToken("me@example.test"),
      /Invalid JSON response/
    );
    assert.deepEqual(db.saved, []);
  });

  test(`${name}: a refresh without a new refresh token keeps the stored one`, async () => {
    process.env.GOOGLE_CALENDAR_CLIENT_ID = process.env.MICROSOFT_CALENDAR_CLIENT_ID = "client";
    const { OAuth } = load(name, () => json({ access_token: "new-access", expires_in: 3600 }));
    const db = database(expired, key);
    assert.equal(await new OAuth(db).getValidAccessToken("me@example.test"), "new-access");
    assert.equal(db.saved.length, 1);
    assert.equal(db.saved[0].refresh_token, "old-refresh");
    assert.equal(db.saved[0].scope, "old-scope");
  });

  test(`${name}: a token that is still valid is returned without a network call`, async () => {
    const { OAuth, requests } = load(name, () => json({}));
    const fresh = { ...expired, expires_at: Date.now() + 3600_000 };
    assert.equal(
      await new OAuth(database(fresh, key)).getValidAccessToken("me@example.test"),
      "old-access"
    );
    assert.equal(requests.length, 0);
  });
}

test("microsoft: concurrent refreshes share one request and persist the rotated refresh token", async () => {
  process.env.MICROSOFT_CALENDAR_CLIENT_ID = "client";
  const { OAuth, requests } = load("microsoft", () =>
    json({ access_token: "a2", refresh_token: "rotated", expires_in: 3600 })
  );
  const db = database(expired, "Microsoft");
  const oauth = new OAuth(db);
  const results = await Promise.all([
    oauth.getValidAccessToken("me@example.test"),
    oauth.getValidAccessToken("me@example.test"),
  ]);
  assert.deepEqual(results, ["a2", "a2"]);
  assert.equal(requests.length, 1);
  assert.equal(db.saved[0].refresh_token, "rotated");
});

test("microsoft: a failed refresh does not poison later attempts", async () => {
  process.env.MICROSOFT_CALENDAR_CLIENT_ID = "client";
  let fail = true;
  const { OAuth } = load("microsoft", () =>
    fail
      ? json({ error: "temporarily_unavailable" }, 503)
      : json({ access_token: "ok", expires_in: 60 })
  );
  const oauth = new OAuth(database(expired, "Microsoft"));
  await assert.rejects(oauth.getValidAccessToken("me@example.test"), /Token refresh failed/);
  fail = false;
  assert.equal(await oauth.getValidAccessToken("me@example.test"), "ok");
});

test("google: starting sign-in without a configured client fails fast instead of opening a broken URL", () => {
  delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
  delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const { OAuth } = load("google", () => json({}));
  assert.throws(() => new OAuth(database(null, "Google")).startOAuthFlow(), /not configured/);
});

test("google: token requests never send a literal 'undefined' client secret", async () => {
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "client";
  delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const { OAuth, requests } = load("google", () => json({ access_token: "a", expires_in: 60 }));
  const oauth = new OAuth(database(expired, "Google"));
  await oauth.refreshAccessToken("r");
  await oauth.exchangeCodeForTokens("code", "http://127.0.0.1:1", "verifier");
  for (const request of requests)
    assert.equal(new URLSearchParams(request.body).has("client_secret"), false, request.body);
});
