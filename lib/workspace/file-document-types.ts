export type WorkspaceFileEntry = {
  kind: "file" | "directory";
  name: string;
  relativePath: string;
  rootId: string;
  sensitive: boolean;
};

export type WorkspaceFileDocument = {
  version: 1;
  id: string;
  projectId: string;
  rootId?: string;
  relativePath: string;
  fileIdentity: {
    device: string | null;
    inode: string | null;
  };
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceFileDocumentView = {
  document: WorkspaceFileDocument;
  status: "resolved" | "deleted";
  change: "unchanged" | "modified" | "renamed" | "deleted";
  content: string | null;
  contentHash: string | null;
  contentKind: "text" | "binary" | "large" | "missing";
  encoding: "utf-8" | null;
  size: number | null;
  modifiedAt: string | null;
  gitStatus: string | null;
  sensitive: boolean;
  writable: boolean;
};
