export type ZenmeProject = {
  id: string;
  name: string;
  prompt: string;
  model: string;
  thumbnail?: string;
  thumbnailPath?: string | null;
  thumbnailVersion?: number;
  createdAt: string;
  updatedAt: string;
  lastSavedAt?: string | null;
  lastOpenedAt?: string | null;
};

export type CanvasSnapshotPayload = {
  version: 2;
  nodes: unknown[];
  edges: unknown[];
  viewport: {
    x: number;
    y: number;
    zoom: number;
  };
  updatedAt: string;
};

export const ZENME_AGENT_KEY_PREFIX = "zenme.agent.v1.";

export function getProjectActivityTime(project: ZenmeProject) {
  return (
    project.lastOpenedAt ??
    project.lastSavedAt ??
    project.updatedAt ??
    project.createdAt
  );
}

export const modelOptions = [
  "glm-4.5",
  "glm-4.5-air",
  "glm-4.6",
  "glm-4.7",
  "glm-5",
  "glm-5-turbo",
  "glm-5.1",
  "glm-5.2",
  "glm-4-flash",
];

export function createProjectName(prompt: string) {
  const trimmed = prompt.trim();

  if (!trimmed) {
    return "未命名项目";
  }

  return trimmed.length > 18 ? `${trimmed.slice(0, 18)}...` : trimmed;
}

export function formatFileSize(bytes?: number) {
  if (!bytes) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;

  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}
