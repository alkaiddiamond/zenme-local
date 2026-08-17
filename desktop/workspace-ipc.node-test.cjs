/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const mainSource = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
const preloadSource = fs.readFileSync(path.join(__dirname, "preload.cjs"), "utf8");

test("workspace binding stays behind the system directory picker and desktop token", () => {
  assert.match(mainSource, /ipcMain\.handle\("zenme:bind-project-workspace"/);
  assert.match(mainSource, /dialog\.showOpenDialog\(mainWindow,[\s\S]*properties:\s*\["openDirectory"\]/);
  assert.match(mainSource, /\^\[A-Za-z0-9_-\]\{1,128\}\$/);
  assert.match(mainSource, /"x-zenme-desktop-token":\s*DESKTOP_API_TOKEN/);
  assert.doesNotMatch(preloadSource, /bindProjectWorkspace:\s*\([^)]*rootPath/);
});

test("renderer receives only named Workspace capabilities instead of generic IPC", () => {
  assert.match(preloadSource, /selectProjectWorkspace:\s*\(\)/);
  assert.match(preloadSource, /createProjectWithWorkspace:\s*\(input\)/);
  assert.match(preloadSource, /bindProjectWorkspace:\s*\(projectId\)/);
  assert.match(preloadSource, /setProjectWorkspaceWriteAccess:\s*\(projectId, allowed\)/);
  assert.match(preloadSource, /setProjectWorkspaceDeleteAccess:\s*\(projectId, allowed\)/);
  assert.match(preloadSource, /setProjectWorkspaceExecuteAccess:\s*\(projectId, allowed\)/);
  assert.match(preloadSource, /setProjectWorkspaceGitWriteAccess:\s*\(projectId, allowed\)/);
  assert.match(mainSource, /ipcMain\.handle\(\s*"zenme:set-project-workspace-git-write-access"/);
  assert.match(mainSource, /JSON\.stringify\(\{ gitWrite: allowed \}\)/);
  assert.doesNotMatch(preloadSource, /ipcRenderer\.(send|invoke)\(channel/);
  assert.doesNotMatch(preloadSource, /require:\s*require|process:\s*process|fs:\s*require/);
});

test("new projects use a one-time desktop folder selection and roll back failed binding", () => {
  assert.match(mainSource, /ipcMain\.handle\("zenme:select-project-workspace"/);
  assert.match(mainSource, /projectWorkspaceSelections\.set\(selectionId, \{ createdAt: now, rootPath \}\)/);
  assert.match(mainSource, /ipcMain\.handle\("zenme:create-project-with-workspace"/);
  assert.match(mainSource, /projectWorkspaceSelections\.delete\(selectionId\)/);
  assert.match(mainSource, /JSON\.stringify\(\{ rootPath: selection\.rootPath \}\)/);
  assert.match(mainSource, /method: "DELETE"/);
  assert.doesNotMatch(preloadSource, /createProjectWithWorkspace:\s*\([^)]*rootPath/);
});
