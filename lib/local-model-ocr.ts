import path from "node:path";
import fs from "node:fs";

import { createWorker, type Worker } from "tesseract.js";

type TesseractProgress = {
  progress?: number;
  status?: string;
};

let workerPromise: Promise<Worker> | null = null;

const MODEL_CACHE_DIR =
  process.env.LOCAL_MODEL_OCR_CACHE_PATH ??
  path.join(process.cwd(), "data", "ocr-models", "tesseract-cache-v2");
const TESSDATA_DIR =
  process.env.LOCAL_MODEL_OCR_LANG_PATH ??
  path.join(process.cwd(), "data", "ocr-models", "tessdata");
const LOCAL_MODEL_OCR_TIMEOUT_MS = Number(
  process.env.LOCAL_MODEL_OCR_TIMEOUT_MS ?? 90_000,
);
const TESSERACT_WORKER_PATH = path.join(
  process.cwd(),
  "node_modules",
  "tesseract.js",
  "src",
  "worker-script",
  "node",
  "index.js",
);

export type LocalModelOcrResult = {
  raw: unknown;
  text: string;
  textDetections: Array<{
    confidence?: number;
    detectedText: string;
  }>;
};

export async function recognizeLocalModelOcr(
  imageBase64: string,
): Promise<LocalModelOcrResult> {
  try {
    const worker = await withTimeout(
      getWorker(),
      LOCAL_MODEL_OCR_TIMEOUT_MS,
      "本地 OCR 模型加载超时",
    );
    const image = Buffer.from(imageBase64, "base64");
    const { data } = await withTimeout(
      worker.recognize(image),
      LOCAL_MODEL_OCR_TIMEOUT_MS,
      "本地 OCR 识别超时",
    );
    const text = cleanOcrText(data?.text || "");

    return {
      raw: data,
      text,
      textDetections: text
        ? [
            {
              confidence: data?.confidence,
              detectedText: text,
            },
          ]
        : [],
    };
  } catch (error) {
    resetWorker();
    throw error;
  }
}

async function getWorker() {
  if (!workerPromise) {
    ensureLocalTessdata();
    workerPromise = createWorker(["chi_sim", "eng"], 1, {
      cachePath: MODEL_CACHE_DIR,
      langPath: TESSDATA_DIR,
      workerPath: TESSERACT_WORKER_PATH,
      logger: (message: TesseractProgress) => {
        if (shouldLogLocalModelOcrProgress() && message.status) {
          console.info(
            `[local-model-ocr] ${message.status} ${Math.round(
              (message.progress ?? 0) * 100,
            )}%`,
          );
        }
      },
    });
  }
  return workerPromise;
}

export function shouldLogLocalModelOcrProgress(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV !== "production" && env.LOCAL_MODEL_OCR_DEBUG === "1";
}

function ensureLocalTessdata() {
  fs.mkdirSync(TESSDATA_DIR, { recursive: true });
  copyTessdataFile({
    from: path.join(
      process.cwd(),
      "node_modules",
      "@tesseract.js-data",
      "chi_sim",
      "4.0.0_best_int",
      "chi_sim.traineddata.gz",
    ),
    to: path.join(TESSDATA_DIR, "chi_sim.traineddata.gz"),
  });
  copyTessdataFile({
    from: path.join(
      process.cwd(),
      "node_modules",
      "@tesseract.js-data",
      "eng",
      "4.0.0_best_int",
      "eng.traineddata.gz",
    ),
    to: path.join(TESSDATA_DIR, "eng.traineddata.gz"),
  });
}

function copyTessdataFile(input: { from: string; to: string }) {
  if (!fs.existsSync(input.from)) {
    throw new Error(`缺少 OCR 语言包：${input.from}`);
  }
  if (
    fs.existsSync(input.to) &&
    fs.statSync(input.to).size === fs.statSync(input.from).size
  ) {
    return;
  }
  fs.copyFileSync(input.from, input.to);
}

function resetWorker() {
  const staleWorkerPromise = workerPromise;
  workerPromise = null;
  void staleWorkerPromise
    ?.then((worker) => worker.terminate())
    .catch(() => undefined);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function cleanOcrText(text: string) {
  if (!text) return "";
  const cjk = "一-鿿㐀-䶿　-〿＀-￯";
  const cjkSpacePattern = new RegExp(`([${cjk}])\\s+(?=[${cjk}])`, "g");
  return text
    .replace(cjkSpacePattern, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}
