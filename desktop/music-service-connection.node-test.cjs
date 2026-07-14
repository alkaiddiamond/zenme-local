/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const http = require("node:http");
const { test } = require("node:test");

const {
  MusicServiceConnection,
  NOT_CONFIGURED_MESSAGE,
} = require("./music-service-connection.cjs");

async function createExternalApi(t, token = "external-test-token") {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ authorization: request.headers.authorization, url: request.url });
    if (request.url !== "/v1/health" || request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(401).end("unauthorized");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", version: "9.8.7", protocolVersion: 1 }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  return { baseUrl: `http://127.0.0.1:${address.port}`, requests, token };
}

test("connection authenticates to an already-running external API without owning it", async (t) => {
  const external = await createExternalApi(t);
  const connection = new MusicServiceConnection({
    baseUrl: external.baseUrl,
    token: external.token,
    timeoutMs: 1_000,
  });

  const snapshot = await connection.connect();

  assert.equal(snapshot.status, "connected");
  assert.equal(snapshot.available, true);
  assert.equal(snapshot.version, "9.8.7");
  assert.deepEqual(connection.configuration(), {
    configured: true,
    source: "explicit",
    baseUrl: external.baseUrl,
    tokenConfigured: true,
  });
  assert.equal(Object.hasOwn(connection.configuration(), "token"), false);
  assert.equal(Object.hasOwn(snapshot, "token"), false);
  assert.deepEqual(connection.serverEnvironment(), {
    ZENME_MUSIC_SERVICE_URL: external.baseUrl,
    ZENME_MUSIC_SERVICE_TOKEN: external.token,
  });

  connection.clear();
  assert.deepEqual(connection.serverEnvironment(), {});
  const stillRunning = await fetch(`${external.baseUrl}/v1/health`, {
    headers: { authorization: `Bearer ${external.token}` },
  });
  assert.equal(stillRunning.status, 200);
  assert.equal(external.requests.length, 2);
});

test("connection leaves Zenme available when no external API is configured", async () => {
  const connection = new MusicServiceConnection();
  const snapshot = await connection.connect();

  assert.equal(snapshot.status, "not_configured");
  assert.equal(snapshot.available, false);
  assert.equal(snapshot.error, NOT_CONFIGURED_MESSAGE);
  assert.equal(snapshot.errorCode, "external_api_not_configured");
});

test("connection rejects non-loopback and credential-bearing URLs before fetch", async () => {
  for (const baseUrl of [
    "https://example.com",
    "http://192.168.1.2:8000",
    "http://user:password@127.0.0.1:8000",
    "http://127.0.0.1:8000/api",
  ]) {
    const connection = new MusicServiceConnection({ baseUrl, token: "secret" });
    const snapshot = await connection.connect();
    assert.equal(snapshot.status, "failed");
    assert.equal(snapshot.errorCode, "external_api_invalid_configuration");
  }
});

test("connection implementation has no process or filesystem lifecycle code", () => {
  const source = require("node:fs").readFileSync(require.resolve("./music-service-connection.cjs"), "utf-8");
  assert.doesNotMatch(source, /child_process|\bspawn\b|\bkill\b|modelsDir|dataDir|executable/);
});
