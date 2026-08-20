import type {
  AgentWorkspaceToolArguments,
  AgentWorkspaceToolName,
} from "@/lib/agent/types";
import { isAgentShellConcurrencySafe } from "@/lib/agent/shell-concurrency";

export type AgentToolPermission = "read" | "write" | "execute" | "interact";

export type AgentToolDefinition<Name extends AgentWorkspaceToolName = AgentWorkspaceToolName> = {
  name: Name;
  description: string;
  permission: AgentToolPermission;
  requiresWorkspace: boolean;
  concurrencySafe: boolean;
  isConcurrencySafe: (input: AgentWorkspaceToolArguments[AgentWorkspaceToolName]) => boolean;
  interruptBehavior: "cancel" | "block";
  internal?: boolean;
  example: AgentWorkspaceToolArguments[Name];
  validate: (value: unknown) => value is AgentWorkspaceToolArguments[Name];
};

const NON_CONCURRENT_READ_TOOLS = new Set<AgentWorkspaceToolName>([
  "view_image",
  "web_search",
  "web_fetch",
  "task_output",
  "skill",
  "tool_search",
]);

const definitions = [
  define("workspace_status", "读取 Workspace 当前状态；适用于普通文件夹和 Git 仓库。返回文件概况、权限、顶层结构、最近修改文件以及可选 Git 信息。git_diff 是另一项读取 Git 变更正文的能力。", "read", true, { recentFileLimit: 20 },
    (value) => isObject(value) && optionalInteger(value.recentFileLimit) && optionalString(value.rootId)),
  define("list_directory", "列出 Workspace 指定目录的直接子项。", "read", true, { relativePath: "." },
    (value) => isObject(value) && optionalString(value.relativePath) && optionalString(value.rootId)),
  define("glob_files", "按 Glob 路径模式查找所有可读 Workspace 根目录中的文件，例如 **/*.ts；传 rootId 时只搜索指定根。只返回路径，不读取正文。对应 cc-haha 的 Glob。", "read", true, { pattern: "**/*.ts", pathPrefix: ".", maxResults: 200 },
    (value) => isObject(value) && requiredString(value.pattern) && optionalString(value.pathPrefix) && optionalInteger(value.maxResults) && optionalString(value.rootId)),
  define("search_files", "在所有可读 Workspace 根目录的文本文件中搜索内容；传 rootId 时只搜索指定根。跨根结果会返回每条匹配的 rootId。", "read", true, { query: "symbol", pathPrefix: ".", maxResults: 50 },
    (value) => isObject(value) && requiredString(value.query) && optionalString(value.pathPrefix) && optionalInteger(value.maxResults) && optionalString(value.rootId)),
  define("code_diagnostics", "读取 Workspace 的 tsconfig/jsconfig，并返回 TypeScript/JavaScript 语法与类型诊断。它只提供结构化 observation，不写文件；是否需要调用由当前问题和验证策略决定。对应 cc-haha 的诊断能力。", "read", true, { relativePaths: ["src/index.ts"], maxProblems: 100 },
    (value) => isObject(value) && optionalString(value.configPath) && optionalStringArray(value.relativePaths) && optionalInteger(value.maxProblems) && optionalString(value.rootId)),
  define("code_intelligence", "通过已启用插件声明的 Language Server 执行跨语言语义导航；TypeScript/JavaScript 在没有插件 LSP 时使用内置语义服务降级。支持定义、引用、悬停、文档/工作区符号、实现与调用层级；位置使用从 1 开始的行列号，并读取当前 Execution 尚未应用的 ChangeSet。对应 cc-haha 的 LSP。", "read", true, { operation: "goToDefinition", filePath: "src/index.ts", line: 10, character: 5, maxResults: 100 },
    (value) => isObject(value) && isCodeIntelligenceOperation(value.operation) && requiredString(value.filePath) && requiredPositiveInteger(value.line) && requiredPositiveInteger(value.character) && optionalString(value.query) && optionalString(value.configPath) && optionalInteger(value.maxResults) && optionalString(value.rootId)),
  define("view_image", "读取并观察 Workspace 中的图片。图片会在内存中安全缩放后作为原生多模态输入交给下一轮模型，不会把 base64 写入项目会话或文本上下文。支持 PNG、JPEG、WebP、GIF 和 AVIF；对应 cc-haha Read 图片与 Codex view_image。", "read", true, { relativePath: "screenshots/home.png" },
    (value) => isObject(value) && requiredString(value.relativePath) && optionalString(value.rootId)),
  define("image_gen", "使用设置中当前首个可用图片模型生成 1 至 4 张图片。模型由用户设置决定，不能通过工具参数覆盖；结果保存到当前 Project 的本地 Agent 图片目录并返回稳定绝对路径。对应 cc-haha 的 ImageGen。", "write", false,
    { prompt: "生成一张简洁的产品概念图", count: 1, aspectRatio: "16:9", quality: "1K" },
    (value) => isObject(value) && requiredString(value.prompt) && optionalBoundedInteger(value.count, 1, 4) && optionalString(value.aspectRatio) && optionalString(value.quality)),
  define("image_edit", "根据 1 至 3 张参考图片编辑并生成新图片。referencedImagePaths 必须是当前可读 Workspace 中的绝对路径，或先前 ImageGen/ImageEdit 返回的绝对路径；模型由用户设置决定。对应 cc-haha 的 ImageEdit。", "write", false,
    { prompt: "保留构图，将天气改为晴天", referencedImagePaths: ["C:/workspace/reference.png"], aspectRatio: "auto", quality: "1K" },
    (value) => isObject(value) && requiredString(value.prompt) && requiredStringArray(value.referencedImagePaths, 1, 3) && optionalString(value.aspectRatio) && optionalString(value.quality)),
  define("search_knowledge", "搜索当前项目已建立索引的知识。", "read", false, { query: "architecture", limit: 20, budgetCharacters: 80_000 },
    (value) => isObject(value) && requiredString(value.query) && optionalInteger(value.limit) && optionalInteger(value.budgetCharacters)),
  define("list_mcp_resources", "列出已启用 MCP 服务公开的资源。MCP 进程以指定 Workspace Root 为 cwd；可按服务名称或 ID 筛选。对应 cc-haha/Codex 的 ListMcpResources。", "read", true, { server: "filesystem", rootId: "workspace-root-id" },
    (value) => isObject(value) && optionalString(value.server) && optionalString(value.rootId)),
  define("read_mcp_resource", "从指定的已启用 MCP 服务读取一个资源；MCP 进程受 Workspace Root cwd 限定，文本内容有长度限制，二进制只返回元数据。对应 cc-haha/Codex 的 ReadMcpResource。", "read", true, { server: "filesystem", uri: "file:///workspace/README.md", rootId: "workspace-root-id" },
    (value) => isObject(value) && requiredString(value.server) && requiredString(value.uri) && optionalString(value.rootId)),
  define("web_search", "发现互联网候选来源 URL；结果未经阅读验证，不能直接作为答案或引用。随后必须用 web_fetch 阅读采用的来源。", "read", false, { query: "latest release", model: "provider:model" },
    (value) => isObject(value) && requiredString(value.query) && optionalString(value.model)),
  define("web_fetch", "读取公开 HTTP(S) 网页，并由页面分析模型按 prompt 提取相关摘要与事实；不会把整页正文交给主 Agent。", "read", false, { url: "https://example.com/docs", prompt: "提取与用户问题直接相关的事实、日期和结论", maxCharacters: 40_000 },
    (value) => isObject(value) && requiredString(value.url) && requiredString(value.prompt) && optionalString(value.model) && optionalInteger(value.maxCharacters)),
  define("browser", "在隔离的临时 Chromium 会话中观察并操作一个明确的本机 HTTP(S) URL。navigate 必须传入用户提供或工具输出中真实出现的 loopback URL；随后可用 snapshot、click、type、press 和 screenshot 操作页面。Browser 不发现端口、不启动或重启服务。只允许 localhost/127.0.0.1/::1，不复用用户登录态。", "interact", false, { operation: "navigate", url: "http://127.0.0.1:5173/", includeScreenshot: true },
    validateBrowserArguments),
  define("read_file", "读取 Workspace 文件。文本按 startLine/endLine 分段；PDF 用 pages 读取指定页（例如 1-5 或 1,3,5-7，单次最多 20 页）；图片使用 view_image。也可读取当前 Execution 的 shell_command 结果返回的绝对 outputFilePath。不得循环读取轮询任务。", "read", true, { relativePath: "src/index.ts", startLine: 1, endLine: 400 },
    (value) => isObject(value) && requiredString(value.relativePath) && optionalInteger(value.startLine) && optionalInteger(value.endLine) && optionalString(value.pages) && optionalString(value.rootId)),
  define("write_file", "创建或替换 UTF-8 文本文件，结果进入 ChangeSet 等待审阅，不会绕过审批直接写盘。对应 cc-haha 的 Write。", "write", true, { relativePath: "src/new.ts", content: "export {};\n", title: "Create src/new.ts" },
    (value) => isObject(value) && requiredString(value.relativePath) && typeof value.content === "string" && optionalString(value.title) && optionalString(value.rootId)),
  define("edit_file", "精确替换现有文本文件中的字符串，结果进入 ChangeSet 等待审阅。对应 cc-haha 的 Edit。", "write", true, { relativePath: "src/index.ts", oldText: "before", newText: "after", replaceAll: false },
    (value) => isObject(value) && requiredString(value.relativePath) && requiredString(value.oldText) && typeof value.newText === "string" && (value.replaceAll === undefined || typeof value.replaceAll === "boolean") && optionalString(value.title) && optionalString(value.rootId)),
  define("apply_patch", "使用 Codex 的 *** Begin Patch 格式一次修改、创建、删除或移动多个 Workspace 文本文件。补丁先在内存中与当前文件精确匹配，再形成一个可审阅、可回退的 ChangeSet；不会绕过 Zenme 的权限和原子写入边界。多段或多文件修改优先使用此工具。", "write", true, { patch: "*** Begin Patch\n*** Update File: src/index.ts\n@@\n-export const value = 1;\n+export const value = 2;\n*** End Patch", title: "Update implementation" },
    (value) => isObject(value) && requiredString(value.patch) && optionalString(value.title) && optionalString(value.rootId)),
  define("notebook_edit", "替换 Jupyter Notebook 指定单元格的 source，结果进入 ChangeSet 等待审阅。", "write", true, { relativePath: "analysis.ipynb", cellIndex: 0, source: "print('hello')\n" },
    (value) => isObject(value) && requiredString(value.relativePath) && typeof value.cellIndex === "number" && Number.isSafeInteger(value.cellIndex) && value.cellIndex >= 0 && typeof value.source === "string" && optionalString(value.title) && optionalString(value.rootId)),
  define("propose_patch", "创建等待用户审阅的 ChangeSet；不会直接写入磁盘。", "write", true, { title: "Update file", operations: [] },
    (value) => isObject(value) && requiredString(value.title) && Array.isArray(value.operations) && optionalString(value.rootId)),
  define("propose_memory", "创建等待确认的长期 Project Memory 候选。", "write", false, { kind: "decision", title: "Decision", content: "...", sources: [] },
    (value) => isObject(value) && requiredString(value.title) && requiredString(value.content) && Array.isArray(value.sources) && ["file", "architecture", "decision", "todo"].includes(String(value.kind))),
  define("git_diff", "读取 Git Workspace 的 diff；普通文件夹没有 Git diff 时会返回相应失败 observation。", "read", true, { relativePaths: ["src/index.ts"] },
    (value) => isObject(value) && optionalStringArray(value.relativePaths) && optionalString(value.rootId)),
  define("ask_user_question", "缺少会显著改变结果的信息时，暂停当前 Turn 并向用户提出 1–4 个短问题。每题提供 2–4 个选项；multiSelect=true 时允许多选。界面会自动提供自由输入，不要创建“其他”选项。", "interact", false, {
    questions: [{ question: "选择实现方案？", header: "方案", options: [{ label: "方案 A", description: "影响说明" }, { label: "方案 B", description: "影响说明" }], multiSelect: false }],
  }, (value) => isObject(value) && (isLegacyQuestion(value) || isQuestionBatch(value))),
  define("enter_plan_mode", "仅在实现路径存在重大歧义或高影响重构时进入规划模式，并在同一 Turn 中继续探索；无需先向用户确认。进入后只能读取、搜索和写入 @plan/PLAN.md，不得修改其他文件或执行命令，完成计划后调用 exit_plan_mode 请求批准。对应 cc-haha 的 EnterPlanMode。", "interact", false, {},
    (value) => isObject(value) && Object.keys(value).length === 0),
  define("exit_plan_mode", "仅在规划模式中使用。提交 @plan/PLAN.md 中完整、可执行的实施计划供用户批准，并将其持久化为 Project 计划文件；批准后恢复普通模式并继续同一 Turn，拒绝后留在规划模式修改计划。对应 cc-haha 的 ExitPlanMode。", "interact", false, { plan: "## 实施计划\n1. ..." },
    (value) => isObject(value) && requiredString(value.plan)),
  define("enter_worktree", "为当前主 Agent Session 创建隔离的 Git worktree，并把本 Turn 及后续 Turn 的默认 Workspace Root 切换到该 worktree。仅适用于已有提交 HEAD 的 Git 仓库；对应 cc-haha 的 EnterWorktree。", "execute", true, { name: "feature-review" },
    (value) => isObject(value) && optionalString(value.name)),
  define("exit_worktree", "退出当前 Session 通过 enter_worktree 创建的 worktree，恢复原 Workspace Root。action=keep 保留目录和分支；action=remove 仅在无改动时删除，存在改动或状态无法确认时必须先征得用户明确同意，再传 discardChanges=true。对应 cc-haha 的 ExitWorktree。", "execute", true, { action: "keep" },
    (value) => isObject(value) && (value.action === "keep" || value.action === "remove") &&
      (value.discardChanges === undefined || typeof value.discardChanges === "boolean")),
  define("shell_command", "在 Workspace 中执行完整的 PowerShell（Windows）或 Bash（macOS/Linux）命令，支持管道、环境变量与复合命令；优先传 command。shell 只用于 Skill/Command 明确选择解释器，不进行静默回退。命令默认在前台运行，超过交互预算后将同一进程转为后台并返回稳定 taskId 与 outputFilePath；不会重新执行命令。仅当不需要立即取得结果且可以等待完成通知时才设置 run_in_background=true；无需在命令末尾添加 &。后台任务结束后运行时会主动通知，不要立即检查或轮询。兼容旧 executable + args 协议。对应 cc-haha 的 Bash/PowerShell。", "execute", true, { command: "pnpm test", cwd: ".", reason: "运行项目测试" },
    (value) => isObject(value) && optionalString(value.reason) && hasExactlyOneShellCommandShape(value) && optionalString(value.cwd) && optionalString(value.rootId) && (value.shell === undefined || value.shell === "bash" || value.shell === "powershell") && optionalInteger(value.timeoutMs) && optionalShellBackground(value)),
  define("task_output", "兼容 cc-haha 的旧式后台输出读取工具，可读取已知 ID 的 Shell、Workflow 或后台 Agent。Shell 优先使用 shell_command 返回的 outputFilePath 配合 read_file 按需读取；任务完成时运行时会主动通知，不得调用本工具轮询。", "read", false, { task_id: "task-id", block: true, timeout: 30_000 },
    (value) => isObject(value) && hasTaskId(value) && optionalTaskOutputOptions(value)),
  define("task_stop", "停止当前项目中已知 ID 的 Shell、Workflow 或后台 Agent。只在用户明确要求停止，或任务明显失控、有害、重复或已无用途时调用；不要仅因已获得足够输出就停止任务。对应 cc-haha 的 TaskStop。", "execute", false, { task_id: "task-id" },
    (value) => isObject(value) && hasTaskId(value)),
  define("delegate_tasks", "把复杂目标拆成 1–8 个边界明确的 Sub-agent 任务并受控并行执行。仅在任务可以独立推进或存在明确依赖时使用；每项必须声明最小路径范围和工具。结果仍通过 ChangeSet、命令审批和当前 Project 权限边界，不得递归委派。", "execute", true, {
    goal: "并行检查并修复两个独立模块",
    concurrencyLimit: 2,
    tasks: [{ title: "修复模块 A", instruction: "检查并修复模块 A，运行相关测试", rootId: "workspace-root-id", dependsOn: [], allowedPathPrefixes: ["src/a"], allowedTools: ["read_file", "edit_file", "shell_command"] }],
  }, (value) => isObject(value) && requiredString(value.goal) && optionalInteger(value.concurrencyLimit) && optionalString(value.model) &&
    Array.isArray(value.tasks) && value.tasks.length >= 1 && value.tasks.length <= 8 && value.tasks.every(isDelegatedTask)),
  define("workflow", "仅当用户明确请求 Workflow、多 Agent 编排，或已加载的 Skill 明确要求时，运行确定性的 JavaScript Workflow 编排脚本；普通开发任务不得自行升级为 Workflow。脚本只能使用 agent()/parallel()/pipeline()/phase()/workflow()/log()，不能直接访问 Node、文件系统或网络；真实操作由受 Workspace、工具和权限边界约束的 Sub-agent 完成。可通过 name 运行 .zenme/workflows、.claude/workflows 或用户 Workflow，也可传 script/scriptPath；resumeFromRunId 从最长未变 agent() 前缀恢复。Workflow 会异步启动并通过后台终态通知返回结果。对应 cc-haha 的 Workflow。", "execute", true,
    { name: "review", args: { target: "src" } },
    (value) => isObject(value) && [value.script, value.scriptPath, value.name].some(requiredString) &&
      optionalString(value.script) && optionalString(value.scriptPath) && optionalString(value.name) &&
      optionalString(value.rootId) && optionalWorkflowRunId(value.resumeFromRunId)),
  define("team_create", "创建一个可持续协调的 Agent Team。一个 Project Session 同时只能领导一个开放团队；创建后用 agent_spawn 添加具名成员。对应 cc-haha 的 TeamCreate。", "execute", true,
    { teamName: "implementation-team", description: "并行实现和复核功能", maxMembers: 4 },
    (value) => isObject(value) && requiredString(value.teamName) && optionalString(value.description) && optionalInteger(value.maxMembers)),
  define("agent_spawn", "启动一个具名 Sub-agent。普通 Agent 默认同步等待并把结果直接返回给当前 Turn；仅当 run_in_background=true、Agent 定义 background=true，或作为 Team 成员运行时才后台执行并在完成后主动通知。可用 agentType 选择内建、项目或用户 Agent，并继承其系统提示、工具边界与模型配置；mode=plan 时 Team 成员必须先提交计划并等待负责人审批；isolation=worktree 会创建临时 Git worktree。对应 cc-haha 的 Agent。", "execute", true,
    { name: "reviewer", agentType: "verification", instruction: "检查实现与相关测试", title: "复核实现", run_in_background: false },
    (value) => isObject(value) && optionalString(value.name) && requiredString(value.instruction) && optionalString(value.agentType) && optionalString(value.teamId) && optionalString(value.title) && optionalString(value.rootId) && optionalStringArray(value.allowedPathPrefixes) && optionalStringArray(value.allowedTools) && optionalString(value.model) && optionalBoolean(value.run_in_background) && (value.isolation === undefined || value.isolation === "worktree") && (value.mode === undefined || value.mode === "plan")),
  define("send_message", "向开放 Team 中的具名 Agent 发送协调消息；to 使用成员名称，或用 * 广播纯文本。纯文本应提供简短 summary；关闭请求使用 shutdown_request；mode=plan 的成员提交计划后，负责人必须向该成员发送携带原 request_id 的 plan_approval_response。结构化消息不能广播。对应 cc-haha 的 SendMessage。", "interact", false,
    { to: "reviewer", summary: "补充检查项", message: "请同时检查失败路径和中断恢复" },
    (value) => isObject(value) && requiredString(value.to) && isTeamLeadMessage(value.message) && optionalString(value.summary) && optionalString(value.teamId) &&
      (value.messageType === undefined || value.messageType === "message" || value.messageType === "shutdown_request")),
  define("team_delete", "关闭当前开放 Team。仍有排队、运行、待审批或等待输入的成员时拒绝关闭，必须先协调成员结束或停止任务。执行记录和 ChangeSet 审计不会删除。对应 cc-haha 的 TeamDelete。", "execute", false,
    {}, (value) => isObject(value) && optionalString(value.teamId)),
  {
    ...define("todo_write", "旧版 Agent Execution 个人任务清单，仅用于恢复历史 Turn。当前交互模式与 cc-haha Task V2 一致，只向模型暴露 task_create/task_get/task_list/task_update。", "write", false, { items: [{ id: "inspect", content: "检查实现", status: "in_progress" }] },
      (value) => isObject(value) && Array.isArray(value.items) && value.items.length <= 100 && value.items.every(isTodoItem)),
    internal: true,
  },
  define("task_create", "在当前项目的共享任务列表中原子创建一个任务。主 Agent 与并行 Sub-agent 读取同一列表；复杂工作需要动态拆分时使用，对应 cc-haha 的 TaskCreate。", "write", false, { subject: "检查实现", description: "阅读生产路径和相关测试", blockedBy: [] },
    (value) => isObject(value) && requiredString(value.subject) && requiredString(value.description) && optionalString(value.activeForm) && optionalString(value.owner) && optionalStringArray(value.blockedBy)),
  define("task_get", "按稳定 ID 读取共享项目任务的完整描述、状态、负责人和依赖，对应 cc-haha 的 TaskGet。", "read", false, { taskId: "task-id" },
    (value) => isObject(value) && requiredString(value.taskId)),
  define("task_list", "列出通过 task_create 建立的共享项目工作项及未完成依赖，供主 Agent 与 Sub-agent 协作。它不接受 Shell taskId，也不查询或管理后台进程。对应 cc-haha 的 TaskList。", "read", false, {},
    (value) => isObject(value) && Object.keys(value).length === 0),
  {
    ...define("project_task_list", "旧版本共享项目任务列表名称。", "read", false, {},
      (value) => isObject(value) && Object.keys(value).length === 0),
    internal: true,
  },
  define("task_update", "原子更新共享项目任务的内容、负责人、状态或依赖。是否需要继续读取或更新其他任务，由 Agent 根据返回状态和当前目标决定。对应 cc-haha 的 TaskUpdate。", "write", false, { taskId: "task-id", status: "in_progress", owner: "subagent" },
    (value) => isObject(value) && requiredString(value.taskId) && optionalString(value.subject) && optionalString(value.description) && optionalString(value.activeForm) && optionalString(value.owner) && optionalStringArray(value.addBlockedBy) && (value.status === undefined || ["pending", "in_progress", "completed", "deleted"].includes(String(value.status)))),
  define("skill", "加载已发现技能的完整 SKILL.md 指令并在当前 Agent Turn 中执行。项目技能属于特定 Workspace Root；多根项目应传入列表展示的 rootId。当某项已发现技能对当前目标有帮助时可调用，对应 cc-haha 的 Skill。", "read", false, { skill: "release-check", args: "windows", rootId: "workspace-root-id" },
    (value) => isObject(value) && requiredString(value.skill) && optionalString(value.args) && optionalString(value.rootId)),
  define("tool_search", "按名称或描述发现当前真正可调用的内置工具与延迟加载的 MCP 工具；匹配的 MCP 工具只在当前 Turn 中激活。对应 cc-haha 的 ToolSearch。", "read", false, { query: "编辑文件", maxResults: 10 },
    (value) => isObject(value) && requiredString(value.query) && optionalInteger(value.maxResults)),
  {
    ...define("run_approved_command", "执行已经通过审批的命令请求。", "execute", true, { commandRequestId: "request-id" },
      (value) => isObject(value) && requiredString(value.commandRequestId)),
    internal: true,
  },
] satisfies AgentToolDefinition[];

const registry = new Map(definitions.map((definition) => [definition.name, definition]));

export const AGENT_TOOL_DEFINITIONS: readonly AgentToolDefinition[] = definitions;
export const MODEL_AGENT_TOOL_DEFINITIONS = definitions.filter((definition) => !definition.internal);
export const AGENT_TOOL_NAMES = definitions.map((definition) => definition.name) as AgentWorkspaceToolName[];
export const DEFERRED_MODEL_AGENT_TOOL_NAMES = new Set<AgentWorkspaceToolName>([
  "browser",
  "code_intelligence",
  "image_edit",
  "image_gen",
  "enter_worktree",
  "exit_worktree",
  "list_mcp_resources",
  "propose_memory",
  "propose_patch",
  "read_mcp_resource",
  "search_knowledge",
  "task_output",
  "task_stop",
  "workflow",
]);

type JsonSchema = Record<string, unknown>;
const stringSchema = { type: "string" } satisfies JsonSchema;
const integerSchema = { type: "integer" } satisfies JsonSchema;
const booleanSchema = { type: "boolean" } satisfies JsonSchema;
const stringArraySchema = { type: "array", items: stringSchema } satisfies JsonSchema;

function objectSchema(
  properties: Record<string, JsonSchema>,
  required: string[] = [],
  extra: Record<string, unknown> = {},
): JsonSchema {
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
    ...extra,
  };
}

const sourceSchema = objectSchema({
  kind: { type: "string", enum: ["workspaceFile", "changeSet", "task", "decision", "execution", "canvasNode", "gitCommit"] },
  id: stringSchema,
  label: stringSchema,
  rootId: stringSchema,
  relativePath: stringSchema,
  contentHash: { type: ["string", "null"] },
  version: stringSchema,
}, ["kind", "id", "label"]);

const AGENT_TOOL_PARAMETER_SCHEMAS = {
  workspace_status: objectSchema({ recentFileLimit: integerSchema, rootId: stringSchema }),
  list_directory: objectSchema({ relativePath: stringSchema, rootId: stringSchema }),
  glob_files: objectSchema({ pattern: stringSchema, pathPrefix: stringSchema, maxResults: integerSchema, rootId: stringSchema }, ["pattern"]),
  search_files: objectSchema({ query: stringSchema, pathPrefix: stringSchema, maxResults: integerSchema, rootId: stringSchema }, ["query"]),
  code_diagnostics: objectSchema({ configPath: stringSchema, relativePaths: stringArraySchema, maxProblems: integerSchema, rootId: stringSchema }),
  code_intelligence: objectSchema({
    operation: { type: "string", enum: ["goToDefinition", "findReferences", "hover", "documentSymbol", "workspaceSymbol", "goToImplementation", "prepareCallHierarchy", "incomingCalls", "outgoingCalls"] },
    filePath: stringSchema,
    line: integerSchema,
    character: integerSchema,
    query: stringSchema,
    configPath: stringSchema,
    maxResults: integerSchema,
    rootId: stringSchema,
  }, ["operation", "filePath", "line", "character"]),
  view_image: objectSchema({ relativePath: stringSchema, rootId: stringSchema }, ["relativePath"]),
  image_gen: objectSchema({
    prompt: stringSchema,
    count: { type: "integer", minimum: 1, maximum: 4 },
    aspectRatio: stringSchema,
    quality: stringSchema,
  }, ["prompt"]),
  image_edit: objectSchema({
    prompt: stringSchema,
    referencedImagePaths: { type: "array", minItems: 1, maxItems: 3, items: stringSchema },
    aspectRatio: stringSchema,
    quality: stringSchema,
  }, ["prompt", "referencedImagePaths"]),
  search_knowledge: objectSchema({ query: stringSchema, limit: integerSchema, budgetCharacters: integerSchema }, ["query"]),
  list_mcp_resources: objectSchema({ server: stringSchema, rootId: stringSchema }),
  read_mcp_resource: objectSchema({ server: stringSchema, uri: stringSchema, rootId: stringSchema }, ["server", "uri"]),
  web_search: objectSchema({ query: stringSchema, model: stringSchema }, ["query"]),
  web_fetch: objectSchema({ url: stringSchema, prompt: stringSchema, model: stringSchema, maxCharacters: integerSchema }, ["url", "prompt"]),
  browser: objectSchema({
    operation: { type: "string", enum: ["navigate", "snapshot", "click", "type", "press", "screenshot", "close"] },
    url: stringSchema,
    ref: stringSchema,
    text: stringSchema,
    key: stringSchema,
    includeScreenshot: booleanSchema,
  }, ["operation"]),
  ask_user_question: objectSchema({
    question: stringSchema,
    options: {
      type: "array",
      maxItems: 4,
      items: objectSchema({ label: stringSchema, description: stringSchema, preview: stringSchema }, ["label"]),
    },
    questions: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: objectSchema({
        question: stringSchema,
        header: stringSchema,
        options: {
          type: "array",
          minItems: 2,
          maxItems: 4,
          items: objectSchema({ label: stringSchema, description: stringSchema, preview: stringSchema }, ["label"]),
        },
        multiSelect: booleanSchema,
      }, ["question", "header", "options"]),
    },
  }, [], { oneOf: [{ required: ["question"] }, { required: ["questions"] }] }),
  enter_plan_mode: objectSchema({}),
  exit_plan_mode: objectSchema({ plan: stringSchema }, ["plan"]),
  enter_worktree: objectSchema({ name: stringSchema }),
  exit_worktree: objectSchema({
    action: { type: "string", enum: ["keep", "remove"] },
    discardChanges: booleanSchema,
  }, ["action"]),
  read_file: objectSchema({ relativePath: stringSchema, startLine: integerSchema, endLine: integerSchema, pages: stringSchema, rootId: stringSchema }, ["relativePath"]),
  write_file: objectSchema({ relativePath: stringSchema, content: stringSchema, title: stringSchema, rootId: stringSchema }, ["relativePath", "content"]),
  edit_file: objectSchema({
    relativePath: stringSchema,
    oldText: stringSchema,
    newText: stringSchema,
    replaceAll: booleanSchema,
    title: stringSchema,
    rootId: stringSchema,
  }, ["relativePath", "oldText", "newText"]),
  apply_patch: objectSchema({ patch: stringSchema, title: stringSchema, rootId: stringSchema }, ["patch"]),
  notebook_edit: objectSchema({
    relativePath: stringSchema,
    cellIndex: integerSchema,
    source: stringSchema,
    title: stringSchema,
    rootId: stringSchema,
  }, ["relativePath", "cellIndex", "source"]),
  propose_patch: objectSchema({
    rootId: stringSchema,
    title: stringSchema,
    description: stringSchema,
    operations: {
      type: "array",
      items: objectSchema({
        fileDocumentId: stringSchema,
        kind: { type: "string", enum: ["create", "modify", "delete", "rename"] },
        proposedContent: { type: ["string", "null"] },
        relativePath: stringSchema,
        targetRelativePath: stringSchema,
      }, ["kind", "relativePath"]),
    },
  }, ["title", "operations"]),
  propose_memory: objectSchema({
    content: stringSchema,
    kind: { type: "string", enum: ["file", "architecture", "decision", "todo"] },
    reason: stringSchema,
    sources: { type: "array", items: sourceSchema },
    title: stringSchema,
  }, ["content", "kind", "sources", "title"]),
  shell_command: objectSchema({
    command: stringSchema,
    executable: stringSchema,
    args: stringArraySchema,
    cwd: stringSchema,
    rootId: stringSchema,
    reason: stringSchema,
    shell: { type: "string", enum: ["bash", "powershell"] },
    timeoutMs: integerSchema,
    run_in_background: booleanSchema,
  }, [], {
    oneOf: [
      { required: ["command"], not: { anyOf: [{ required: ["executable"] }, { required: ["args"] }] } },
      { required: ["executable", "args"], not: { required: ["command"] } },
    ],
  }),
  task_output: objectSchema({ task_id: stringSchema, block: booleanSchema, timeout: integerSchema }, ["task_id"]),
  task_stop: objectSchema({ task_id: stringSchema }, ["task_id"]),
  delegate_tasks: objectSchema({
    goal: stringSchema,
    tasks: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: objectSchema({
        title: stringSchema,
        instruction: stringSchema,
        rootId: stringSchema,
        dependsOn: { type: "array", items: integerSchema },
        allowedPathPrefixes: stringArraySchema,
        allowedTools: stringArraySchema,
      }, ["title", "instruction"]),
    },
    concurrencyLimit: integerSchema,
    model: stringSchema,
  }, ["goal", "tasks"]),
  workflow: objectSchema({
    script: stringSchema,
    scriptPath: stringSchema,
    name: stringSchema,
    rootId: stringSchema,
    args: {},
    resumeFromRunId: stringSchema,
  }, [], {
    anyOf: [{ required: ["script"] }, { required: ["scriptPath"] }, { required: ["name"] }],
  }),
  team_create: objectSchema({ teamName: stringSchema, description: stringSchema, maxMembers: integerSchema }, ["teamName"]),
  agent_spawn: objectSchema({
    teamId: stringSchema,
    name: stringSchema,
    instruction: stringSchema,
    agentType: stringSchema,
    title: stringSchema,
    rootId: stringSchema,
    allowedPathPrefixes: stringArraySchema,
    allowedTools: stringArraySchema,
    model: stringSchema,
    isolation: { type: "string", enum: ["worktree"] },
    mode: { type: "string", enum: ["plan"] },
    run_in_background: booleanSchema,
  }, ["instruction"]),
  send_message: objectSchema({
    teamId: stringSchema,
    to: stringSchema,
    summary: stringSchema,
    message: {
      anyOf: [
        stringSchema,
        objectSchema({
          type: { type: "string", enum: ["shutdown_request"] },
          reason: stringSchema,
        }, ["type"]),
        objectSchema({
          type: { type: "string", enum: ["plan_approval_response"] },
          request_id: stringSchema,
          approve: { type: "boolean" },
          feedback: stringSchema,
        }, ["type", "request_id", "approve"]),
      ],
    },
  }, ["to", "message"]),
  team_delete: objectSchema({ teamId: stringSchema }),
  todo_write: objectSchema({
    items: {
      type: "array",
      maxItems: 100,
      items: objectSchema({
        id: stringSchema,
        content: stringSchema,
        status: { type: "string", enum: ["pending", "in_progress", "completed"] },
      }, ["id", "content", "status"]),
    },
  }, ["items"]),
  task_create: objectSchema({ subject: stringSchema, description: stringSchema, activeForm: stringSchema, owner: stringSchema, blockedBy: stringArraySchema }, ["subject", "description"]),
  task_get: objectSchema({ taskId: stringSchema }, ["taskId"]),
  task_list: objectSchema({}),
  project_task_list: objectSchema({}),
  task_update: objectSchema({
    taskId: stringSchema,
    subject: stringSchema,
    description: stringSchema,
    activeForm: stringSchema,
    owner: stringSchema,
    status: { type: "string", enum: ["pending", "in_progress", "completed", "deleted"] },
    addBlockedBy: stringArraySchema,
  }, ["taskId"]),
  skill: objectSchema({ skill: stringSchema, args: stringSchema, rootId: stringSchema }, ["skill"]),
  tool_search: objectSchema({ query: stringSchema, maxResults: integerSchema }, ["query"]),
  git_diff: objectSchema({ relativePaths: stringArraySchema, rootId: stringSchema }),
  run_approved_command: objectSchema({ commandRequestId: stringSchema }, ["commandRequestId"]),
} satisfies Record<AgentWorkspaceToolName, JsonSchema>;

export type NativeAgentTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export function createNativeAgentTools(options: { exclude?: AgentWorkspaceToolName[]; include?: AgentWorkspaceToolName[] } = {}): NativeAgentTool[] {
  const excluded = new Set(options.exclude ?? []);
  const included = options.include?.length ? new Set(options.include) : null;
  return MODEL_AGENT_TOOL_DEFINITIONS
    .filter((definition) => !excluded.has(definition.name) && (!included || included.has(definition.name)))
    .map((definition) => ({
      name: definition.name,
      description: `${definition.description} 参数示例：${JSON.stringify(definition.example)}`,
      parameters: AGENT_TOOL_PARAMETER_SCHEMAS[definition.name],
    }));
}

export function getAgentToolDefinition(name: unknown) {
  return typeof name === "string" ? registry.get(name as AgentWorkspaceToolName) : undefined;
}

export function searchAgentToolDefinitions(
  query: string,
  maxResults = 10,
  allowedTools?: readonly AgentWorkspaceToolName[],
) {
  const terms = query.toLocaleLowerCase().match(/[a-z0-9_]+|[\u3400-\u9fff]/g) ?? [];
  return MODEL_AGENT_TOOL_DEFINITIONS
    .filter((definition) => definition.name !== "tool_search" &&
      (allowedTools === undefined || allowedTools.includes(definition.name)))
    .map((definition) => {
      const haystack = `${definition.name} ${definition.description}`.toLocaleLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { definition, score };
    })
    .filter((entry) => entry.score > 0 || terms.length === 0)
    .sort((left, right) => right.score - left.score || left.definition.name.localeCompare(right.definition.name))
    .slice(0, Math.max(1, Math.min(30, maxResults)))
    .map(({ definition }) => ({
      name: definition.name,
      description: definition.description,
      permission: definition.permission,
      requiresWorkspace: definition.requiresWorkspace,
      example: definition.example as Record<string, unknown>,
    }));
}

export function parseAgentToolCall(name: unknown, argumentsValue: unknown) {
  const definition = getAgentToolDefinition(name);
  const normalizedArguments = normalizeLegacyToolCallArguments(definition?.name, argumentsValue);
  if (!definition || definition.internal ||
    !hasOnlyDeclaredTopLevelParameters(definition.name, normalizedArguments) ||
    !definition.validate(normalizedArguments)) return null;
  return {
    name: definition.name,
    arguments: normalizedArguments as AgentWorkspaceToolArguments[AgentWorkspaceToolName],
  };
}

export function describeAgentToolCallValidationError(name: unknown, argumentsValue: unknown) {
  if (typeof name !== "string" || !name.trim()) return "工具调用缺少有效工具名。";
  const definition = getAgentToolDefinition(name);
  if (!definition || definition.internal) {
    return `工具 ${name} 当前不可调用。请根据本轮实际暴露的工具定义选择能力；若需要延迟工具，可先调用 tool_search。`;
  }
  const normalizedArguments = normalizeLegacyToolCallArguments(definition.name, argumentsValue);
  if (!isObject(normalizedArguments)) {
    return `工具 ${definition.name} 的参数必须是 JSON 对象。参数示例：${JSON.stringify(definition.example)}`;
  }
  const schema = AGENT_TOOL_PARAMETER_SCHEMAS[definition.name];
  const properties = isObject(schema.properties) ? Object.keys(schema.properties) : [];
  const unknown = Object.keys(normalizedArguments).filter((key) => !properties.includes(key));
  if (unknown.length) {
    return `工具 ${definition.name} 包含当前 schema 不支持的字段：${unknown.join("、")}。允许字段：${properties.join("、") || "无"}。参数示例：${JSON.stringify(definition.example)}`;
  }
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === "string")
    : [];
  const missing = required.filter((key) => normalizedArguments[key] === undefined);
  if (missing.length) {
    return `工具 ${definition.name} 缺少必填字段：${missing.join("、")}。参数示例：${JSON.stringify(definition.example)}`;
  }
  if (definition.name === "shell_command") {
    const hasCommand = requiredString(normalizedArguments.command);
    const hasExecutable = requiredString(normalizedArguments.executable);
    const hasArgs = Array.isArray(normalizedArguments.args) && normalizedArguments.args.every((item) => typeof item === "string");
    if (!hasCommand && !(hasExecutable && hasArgs)) {
      return "工具 shell_command 需要二选一：{command}，或 {executable,args}。reason、cwd、timeoutMs、run_in_background 均为可选字段。";
    }
    if (hasCommand && (normalizedArguments.executable !== undefined || normalizedArguments.args !== undefined)) {
      return "工具 shell_command 不能同时使用 command 与 executable/args；请选择一种命令协议。";
    }
  }
  if (!definition.validate(normalizedArguments)) {
    return `工具 ${definition.name} 的参数值或字段组合不符合当前 schema。允许字段：${properties.join("、") || "无"}。参数示例：${JSON.stringify(definition.example)}`;
  }
  return `工具 ${definition.name} 调用未通过运行时校验，请依据当前工具定义调整后重试。`;
}

function normalizeLegacyToolCallArguments(name: AgentWorkspaceToolName | undefined, value: unknown) {
  if (name !== "shell_command" || !isObject(value) || typeof value.background !== "boolean") return value;
  const normalized = { ...value };
  if (normalized.run_in_background === undefined) normalized.run_in_background = normalized.background;
  delete normalized.background;
  return normalized;
}

function hasOnlyDeclaredTopLevelParameters(name: AgentWorkspaceToolName, value: unknown) {
  if (!isObject(value)) return false;
  const properties = AGENT_TOOL_PARAMETER_SCHEMAS[name].properties;
  if (!isObject(properties)) return false;
  return Object.keys(value).every((key) => Object.hasOwn(properties, key));
}

export function formatAgentToolProtocol(options: {
  exclude?: AgentWorkspaceToolName[];
  include?: AgentWorkspaceToolName[];
} = {}) {
  const excluded = new Set(options.exclude ?? []);
  const included = options.include?.length ? new Set(options.include) : null;
  const lines = MODEL_AGENT_TOOL_DEFINITIONS
    .filter((definition) => !excluded.has(definition.name) && (!included || included.has(definition.name)))
    .map((definition) =>
      `- ${definition.name} [${definition.permission}]: ${definition.description}\n  参数示例：${JSON.stringify(definition.example)}`,
    );
  return [
    "可用工具由统一注册表提供：",
    ...lines,
    "服务商提供原生 function/tool calling 时，直接调用对应工具；可以在一次响应中调用多个相互独立的读取工具，Zenme 会完整执行该批次后再继续推理。写入、命令、审批、提问和其他有顺序依赖的动作必须逐次调用。仅在服务商不支持原生工具时，才严格返回兼容格式：{\"type\":\"tool\",\"name\":\"工具名\",\"arguments\":{...}}，兼容格式每次只调用一个工具。",
  ].join("\n");
}

function define<Name extends AgentWorkspaceToolName>(
  name: Name,
  description: string,
  permission: AgentToolPermission,
  requiresWorkspace: boolean,
  example: AgentWorkspaceToolArguments[Name],
  validate: (value: unknown) => boolean,
): AgentToolDefinition<Name> {
  return {
    name,
    description,
    permission,
    requiresWorkspace,
    concurrencySafe: permission === "read" && !NON_CONCURRENT_READ_TOOLS.has(name),
    isConcurrencySafe: (input) => name === "shell_command"
      ? isAgentShellConcurrencySafe(input as AgentWorkspaceToolArguments["shell_command"])
      : permission === "read" && !NON_CONCURRENT_READ_TOOLS.has(name),
    interruptBehavior: permission === "read" ? "cancel" : "block",
    example,
    validate: validate as AgentToolDefinition<Name>["validate"],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200_000;
}

function optionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

function isTeamLeadMessage(value: unknown) {
  if (requiredString(value)) return true;
  if (!isObject(value)) return false;
  if (value.type === "shutdown_request") {
    return optionalString(value.reason) && Object.keys(value).every((key) => key === "type" || key === "reason");
  }
  return value.type === "plan_approval_response" && requiredString(value.request_id) &&
    typeof value.approve === "boolean" && optionalString(value.feedback) &&
    (value.approve || Boolean(value.feedback?.trim())) &&
    Object.keys(value).every((key) => ["type", "request_id", "approve", "feedback"].includes(key));
}

function optionalInteger(value: unknown) {
  return value === undefined || (typeof value === "number" && Number.isSafeInteger(value));
}

function optionalWorkflowRunId(value: unknown) {
  return value === undefined || (typeof value === "string" && /^wf_[a-z0-9-]{6,}$/i.test(value));
}

function optionalBoundedInteger(value: unknown, minimum: number, maximum: number) {
  return value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum);
}

function requiredStringArray(value: unknown, minimum: number, maximum: number) {
  return Array.isArray(value) && value.length >= minimum && value.length <= maximum && value.every(requiredString);
}

function optionalBoolean(value: unknown) {
  return value === undefined || typeof value === "boolean";
}

function optionalShellBackground(value: Record<string, unknown>) {
  if (!optionalBoolean(value.run_in_background) || !optionalBoolean(value.background)) return false;
  return value.run_in_background === undefined || value.background === undefined;
}

function hasTaskId(value: Record<string, unknown>) {
  const hasCurrent = requiredString(value.task_id);
  const hasLegacy = requiredString(value.taskId);
  return hasCurrent !== hasLegacy;
}

function optionalTaskOutputOptions(value: Record<string, unknown>) {
  if (!optionalBoolean(value.block) || !optionalBoolean(value.wait) ||
      !optionalInteger(value.timeout) || !optionalInteger(value.timeoutMs)) return false;
  return (value.block === undefined || value.wait === undefined) &&
    (value.timeout === undefined || value.timeoutMs === undefined);
}

function isBrowserOperation(value: unknown) {
  return typeof value === "string" && ["navigate", "snapshot", "click", "type", "press", "screenshot", "close"].includes(value);
}

function validateBrowserArguments(value: unknown) {
  if (!isObject(value) || !isBrowserOperation(value.operation) || !optionalString(value.url) ||
    !optionalString(value.ref) || !optionalString(value.text) || !optionalString(value.key) ||
    !optionalBoolean(value.includeScreenshot)) return false;
  if (value.operation === "navigate") return requiredString(value.url);
  if (value.operation === "click") return requiredString(value.ref);
  if (value.operation === "type") return requiredString(value.ref) && typeof value.text === "string";
  if (value.operation === "press") return requiredString(value.key);
  return true;
}

function requiredPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isCodeIntelligenceOperation(value: unknown) {
  return typeof value === "string" && [
    "goToDefinition",
    "findReferences",
    "hover",
    "documentSymbol",
    "workspaceSymbol",
    "goToImplementation",
    "prepareCallHierarchy",
    "incomingCalls",
    "outgoingCalls",
  ].includes(value);
}

function optionalStringArray(value: unknown) {
  return value === undefined || (Array.isArray(value) && value.every((entry) => typeof entry === "string"));
}

function optionalOptions(value: unknown) {
  return value === undefined || (Array.isArray(value) && value.length <= 4 && value.every(isQuestionOption));
}

function isQuestionOption(value: unknown) {
  return isObject(value) && requiredString(value.label) && optionalString(value.description) && optionalString(value.preview);
}

function isLegacyQuestion(value: Record<string, unknown>) {
  return requiredString(value.question) && optionalOptions(value.options) && value.questions === undefined;
}

function isQuestionBatch(value: Record<string, unknown>) {
  if (value.question !== undefined || value.options !== undefined || !Array.isArray(value.questions) ||
      value.questions.length < 1 || value.questions.length > 4) return false;
  const texts = new Set<string>();
  for (const question of value.questions) {
    if (!isObject(question)) return false;
    const questionText = typeof question.question === "string" ? question.question : "";
    const header = typeof question.header === "string" ? question.header : "";
    if (!questionText.trim() || !header.trim() ||
        header.length > 20 || typeof question.multiSelect !== "undefined" && typeof question.multiSelect !== "boolean" ||
        !Array.isArray(question.options) || question.options.length < 2 || question.options.length > 4 ||
        !question.options.every(isQuestionOption)) return false;
    const labels = question.options.map((option) => (option as { label: string }).label);
    if (texts.has(questionText) || new Set(labels).size !== labels.length) return false;
    texts.add(questionText);
  }
  return true;
}

function hasExactlyOneShellCommandShape(value: Record<string, unknown>) {
  const hasCommand = requiredString(value.command);
  const hasLegacy = requiredString(value.executable) && Array.isArray(value.args) && value.args.every((entry) => typeof entry === "string");
  return hasCommand !== hasLegacy && (hasCommand ? value.executable === undefined && value.args === undefined : value.command === undefined);
}

function isTodoItem(value: unknown) {
  return isObject(value) && requiredString(value.id) && requiredString(value.content) &&
    ["pending", "in_progress", "completed"].includes(String(value.status));
}

function isDelegatedTask(value: unknown) {
  return isObject(value) && requiredString(value.title) && requiredString(value.instruction) &&
    optionalString(value.rootId) &&
    (value.dependsOn === undefined || (Array.isArray(value.dependsOn) && value.dependsOn.every((entry) => Number.isSafeInteger(entry)))) &&
    optionalStringArray(value.allowedPathPrefixes) && optionalStringArray(value.allowedTools);
}
