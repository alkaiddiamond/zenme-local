/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");

const { MusicServiceConnection } = require("../desktop/music-service-connection.cjs");

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The local Zenme server is still starting.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await Promise.race([exited, delay(5_000)]);
  return child.exitCode !== null || child.signalCode !== null;
}

function createWaveFile() {
  const sampleRate = 16_000;
  const sampleCount = sampleRate;
  const dataBytes = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin(2 * Math.PI * 440 * index / sampleRate) * 0.2;
    buffer.writeInt16LE(Math.round(sample * 32_767), 44 + index * 2);
  }
  return buffer;
}

async function waitForJob(baseUrl, jobId) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/music/jobs/${jobId}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Job snapshot failed (${response.status})`);
    const job = await response.json();
    if (["succeeded", "failed", "cancelled"].includes(job.status)) return job;
    await delay(250);
  }
  throw new Error("Timed out waiting for the smoke analysis job");
}

async function main() {
  const projectRoot = path.resolve(__dirname, "..");
  if (!fs.existsSync(path.join(projectRoot, ".next", "BUILD_ID"))) {
    throw new Error("Run `npm run build` before the music integration smoke test");
  }
  const serviceBaseUrl = process.env.ZENME_MUSIC_SERVICE_URL;
  const serviceToken = process.env.ZENME_MUSIC_SERVICE_TOKEN;
  if (!serviceBaseUrl || !serviceToken) {
    throw new Error(
      "external API service not configured: set ZENME_MUSIC_SERVICE_URL and ZENME_MUSIC_SERVICE_TOKEN",
    );
  }
  const configuredZenmeDataDir = process.env.ZENME_MUSIC_TEST_ZENME_DATA_DIR;
  const zenmeDataDir = configuredZenmeDataDir
    ? path.resolve(configuredZenmeDataDir)
    : fs.mkdtempSync(path.join(os.tmpdir(), "zenme-local-integration-"));
  const ownsZenmeDataDir = !configuredZenmeDataDir;
  fs.mkdirSync(path.join(zenmeDataDir, "projects"), { recursive: true });
  try {
  const connection = new MusicServiceConnection({
    baseUrl: serviceBaseUrl,
    token: serviceToken,
    timeoutMs: 15_000,
  });
  let nextProcess;
  let summary;
  try {
    const service = await connection.connect();
    const port = await findAvailablePort();
    nextProcess = spawn(
      process.execPath,
      [
        require.resolve("next/dist/bin/next"),
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          ZENME_DATA_DIR: zenmeDataDir,
          ZENME_DESKTOP: "1",
          ...connection.serverEnvironment(),
        },
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      },
    );
    let nextError = "";
    nextProcess.stderr.on("data", (chunk) => {
      nextError = `${nextError}${String(chunk)}`.slice(-8_000);
    });
    await waitForServer(`http://127.0.0.1:${port}/api/settings`);
    const baseUrl = `http://127.0.0.1:${port}`;
    const healthResponse = await fetch(`${baseUrl}/api/music/health`);
    const health = await healthResponse.json();
    const capabilityResponse = await fetch(`${baseUrl}/api/music/capabilities`);
    const capabilities = await capabilityResponse.json();
    const projectResponse = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Music API smoke test", prompt: "", model: "test" }),
    });
    if (!projectResponse.ok) throw new Error(`Project creation failed (${projectResponse.status})`);
    const project = await projectResponse.json();
    const inputPath = process.env.ZENME_MUSIC_TEST_INPUT_PATH
      ? path.resolve(process.env.ZENME_MUSIC_TEST_INPUT_PATH)
      : null;
    const inputBuffer = inputPath ? fs.readFileSync(inputPath) : createWaveFile();
    const inputName = inputPath ? path.basename(inputPath) : "smoke.wav";
    const inputType = inputPath && path.extname(inputPath).toLowerCase() === ".mp3"
      ? "audio/mpeg"
      : "audio/wav";
    const formData = new FormData();
    formData.set("file", new Blob([inputBuffer], { type: inputType }), inputName);
    const uploadResponse = await fetch(`${baseUrl}/api/projects/${project.id}/files`, {
      method: "POST",
      body: formData,
    });
    if (!uploadResponse.ok) throw new Error(`Music upload failed (${uploadResponse.status})`);
    const upload = await uploadResponse.json();
    const jobResponse = await fetch(`${baseUrl}/api/music/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        fileId: upload.fileId,
        profile: "quick",
        capabilities: ["metadata", "waveform"],
        options: { keepStems: false, language: "auto" },
      }),
    });
    if (jobResponse.status !== 202) {
      throw new Error(`Music job creation failed (${jobResponse.status})`);
    }
    const createdJob = await jobResponse.json();
    const eventResponse = await fetch(
      `${baseUrl}/api/music/jobs/${createdJob.id}/events`,
      { signal: AbortSignal.timeout(120_000) },
    );
    const events = await eventResponse.text();
    const completedJob = await waitForJob(baseUrl, createdJob.id);
    if (completedJob.status !== "succeeded") {
      throw new Error(`Smoke analysis failed: ${JSON.stringify(completedJob.error)}`);
    }
    const resultResponse = await fetch(`${baseUrl}/api/music/jobs/${createdJob.id}/result`);
    const result = await resultResponse.json();
    const serialized = JSON.stringify({ health, capabilities, result });
    if (
      healthResponse.status !== 200
      || health.status !== "ok"
      || health.protocolVersion !== 1
      || capabilityResponse.status !== 200
      || !Array.isArray(capabilities.analyzers)
      || !capabilities.modelPackages?.some((item) => /音乐|歌词|音符|和弦/.test(item.purpose))
      || eventResponse.status !== 200
      || !events.includes("event: snapshot")
      || resultResponse.status !== 200
      || !result.input?.codec
      || !Array.isArray(result.waveform)
      || result.waveform.length === 0
      || typeof result.report?.markdown !== "string"
      || serialized.includes(serviceToken)
      || serialized.includes("Bearer ")
    ) {
      throw new Error("Music service proxy returned an invalid or unsafe response");
    }
    summary = {
      service,
      connectionMode: "external-api-only",
      externalServiceLifecycleManagedByZenme: false,
      baseUrl: connection.configuration().baseUrl,
      nextPid: nextProcess.pid,
      healthStatus: healthResponse.status,
      capabilitiesStatus: capabilityResponse.status,
      analyzerIds: capabilities.analyzers.map((item) => item.id),
      modelPackagePurposes: capabilities.modelPackages.map((item) => item.purpose),
      inputName,
      jobId: createdJob.id,
      jobStatus: completedJob.status,
      sseSnapshotReceived: events.includes("event: snapshot"),
      analyzedCodec: result.input.codec,
      analyzedDuration: result.input.duration,
      waveformPoints: result.waveform.length,
      readableReportCharacters: result.report.markdown.length,
      tokenExposed: false,
      nextError: nextError.trim() || null,
    };
  } finally {
    const nextExited = await stopChild(nextProcess);
    connection.clear();
    if (summary) summary.nextExited = nextExited;
  }
  const stillRunningResponse = await fetch(`${serviceBaseUrl}/v1/health`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${serviceToken}` },
  });
  if (!stillRunningResponse.ok) {
    throw new Error("Zenme disconnect unexpectedly affected the external API service");
  }
  summary.externalServiceStillRunningAfterZenmeDisconnect = true;
  console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (ownsZenmeDataDir) {
      fs.rmSync(zenmeDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
