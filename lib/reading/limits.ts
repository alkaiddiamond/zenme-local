export const READING_ASSET_MAX_BYTES = 50 * 1024 * 1024;
export const READING_ASSET_FORMDATA_MAX_BYTES = 8 * 1024 * 1024;

export function formatReadingAssetSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / 1024 / 1024)}MB`;
  }

  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)}KB`;
  }

  return `${bytes}B`;
}

export function getReadingAssetSizeError(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= READING_ASSET_MAX_BYTES) {
    return null;
  }

  return `阅读资料不能超过 ${formatReadingAssetSize(READING_ASSET_MAX_BYTES)}`;
}

export function shouldUseBinaryReadingAssetUpload(sizeBytes: number) {
  return sizeBytes > READING_ASSET_FORMDATA_MAX_BYTES;
}
