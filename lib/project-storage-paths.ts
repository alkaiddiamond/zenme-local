const SAFE_STORAGE_EXTENSION_PATTERN = /^\.[a-z0-9]+$/;

export function createProjectOriginalStoragePath(input: {
  fileId: string;
  fileName: string;
  ownerId: string;
  projectId: string;
}) {
  return `${input.ownerId}/${input.projectId}/original/${input.fileId}${getSafeStorageExtension(input.fileName)}`;
}

export function createProjectPreviewStoragePath(input: {
  fileId: string;
  ownerId: string;
  projectId: string;
}) {
  return `${input.ownerId}/${input.projectId}/preview/${input.fileId}.webp`;
}

export function createProjectThumbnailStoragePath(input: {
  ownerId: string;
  projectId: string;
}) {
  return `${input.ownerId}/${input.projectId}/thumbnail/latest.webp`;
}

function getSafeStorageExtension(fileName: string) {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  const extension = match ? `.${match[1]}` : "";
  return SAFE_STORAGE_EXTENSION_PATTERN.test(extension) ? extension : "";
}
