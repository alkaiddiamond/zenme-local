/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const {
  normalizeLoopbackBaseUrl,
  resolveMusicServiceConfiguration,
  updateMusicServiceConfiguration,
} = require("./music-service-config.cjs");

test("desktop config resolves only an external API Base URL and token", () => {
  const configuration = resolveMusicServiceConfiguration({
    desktopConfig: {
      dataDir: path.resolve("zenme-data"),
      musicService: {
        baseUrl: "http://127.0.0.1:43127",
        token: "desktop-secret",
      },
    },
    env: {},
  });

  assert.equal(configuration.baseUrl, "http://127.0.0.1:43127");
  assert.equal(configuration.token, "desktop-secret");
  assert.equal(configuration.configured, true);
  assert.equal(configuration.source, "desktop-config");
  assert.equal(Object.hasOwn(configuration, "executable"), false);
  assert.equal(Object.hasOwn(configuration, "modelsDir"), false);
  assert.equal(Object.hasOwn(configuration, "dataDir"), false);
});

test("URL/token environment pair overrides the whole desktop connection", () => {
  const configuration = resolveMusicServiceConfiguration({
    desktopConfig: {
      musicService: { baseUrl: "http://127.0.0.1:1111", token: "configured" },
    },
    env: {
      ZENME_MUSIC_SERVICE_URL: "http://localhost:2222",
      ZENME_MUSIC_SERVICE_TOKEN: "environment-secret",
    },
  });

  assert.equal(configuration.baseUrl, "http://localhost:2222");
  assert.equal(configuration.token, "environment-secret");
  assert.equal(configuration.source, "environment");
});

test("partial or invalid API configuration remains unavailable without throwing", () => {
  const partial = resolveMusicServiceConfiguration({
    desktopConfig: { musicService: { baseUrl: "http://127.0.0.1:43127" } },
    env: {},
  });
  const invalid = resolveMusicServiceConfiguration({
    desktopConfig: {},
    env: {
      ZENME_MUSIC_SERVICE_URL: "https://example.com",
      ZENME_MUSIC_SERVICE_TOKEN: "secret",
    },
  });

  assert.equal(partial.configured, false);
  assert.equal(partial.error, null);
  assert.equal(invalid.configured, false);
  assert.match(invalid.error, /本机回环/);
});

test("configuration updates remove obsolete executable and storage fields", () => {
  const current = {
    dataDir: path.resolve("zenme-data"),
    theme: "dark",
    musicService: {
      executable: "old.exe",
      dataDir: "old-data",
      modelsDir: "old-models",
    },
  };
  const configured = updateMusicServiceConfiguration(current, {
    baseUrl: "http://127.0.0.1:43127",
    token: "new-secret",
  });

  assert.equal(configured.dataDir, current.dataDir);
  assert.equal(configured.theme, "dark");
  assert.deepEqual(configured.musicService, {
    baseUrl: "http://127.0.0.1:43127",
    token: "new-secret",
  });
});

test("normalizer accepts only loopback HTTP origins", () => {
  assert.equal(normalizeLoopbackBaseUrl("http://127.0.0.1:8000/"), "http://127.0.0.1:8000");
  assert.equal(normalizeLoopbackBaseUrl("http://localhost:8000"), "http://localhost:8000");
  assert.throws(() => normalizeLoopbackBaseUrl("https://127.0.0.1:8000"), /本机回环/);
  assert.throws(() => normalizeLoopbackBaseUrl("http://127.0.0.1:8000/v1"), /本机回环/);
});

test("Electron package and product bootstrap contain no music-service runtime", () => {
  const projectRoot = path.resolve(__dirname, "..");
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
  const mainSource = fs.readFileSync(path.join(projectRoot, "desktop", "main.cjs"), "utf-8");

  assert.equal(packageJson.build.extraResources, undefined);
  assert.doesNotMatch(mainSource, /MusicServiceManager|music-service-manager/);
  assert.doesNotMatch(mainSource, /ZENME_MUSIC_SERVICE_EXECUTABLE|ZENME_MUSIC_PYTHON/);
  assert.doesNotMatch(mainSource, /musicService[^\n]+\.(start|stop)\(/);
});
