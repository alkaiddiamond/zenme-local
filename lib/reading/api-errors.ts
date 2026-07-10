const STORAGE_PATH_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:reading\/)?[^\s"']+/i;

const USER_FACING_READING_ERRORS = new Set([
  "不支持的阅读文件类型",
  "阅读资料不存在",
]);

export function getReadingApiErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  if (isStorageKeyError(error.message)) {
    return "阅读资料存储路径无效，请重新上传文件";
  }
  if (STORAGE_PATH_PATTERN.test(error.message)) {
    return fallback;
  }

  if (USER_FACING_READING_ERRORS.has(error.message)) {
    return error.message;
  }

  return fallback;
}

function isStorageKeyError(message: string) {
  return /invalid key/i.test(message);
}
