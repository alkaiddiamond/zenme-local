# Zenme 本地音乐分析服务开发任务书

## 1. 文档用途

本文档用于交接给独立开发对话，目标是从零建立一个可由 Zenme Local 管理的本地音乐分析服务，并完成稳定、可测试、可替换的桌面端集成。

执行者应先阅读：

- `zenme-local/docs/prd.md`
- `zenme-local/docs/design-standard.md`
- `zenme-local/docs/api/music-analysis-service.md`
- `zenme-local/AGENTS.md`

本文档是开发任务和验收依据；如与 PRD 冲突，以更新日期更晚且经过用户确认的产品决策为准。

## 2. 项目目标

建立独立本地服务 `zenme-music-service`，让用户上传音乐后可逐步获得：

1. 文件与音频基本信息。
2. 波形、BPM、调性、拍号、响度、动态范围和能量。
3. 人声、鼓、贝斯及其他声部的分轨结果。
4. 带时间戳的歌词及置信度。
5. Intro、Verse、Chorus、Bridge、Outro 等结构与段落。
6. 风格、情绪和乐器标签及概率。
7. 和弦时间轴。
8. 人声音域、音高、颤音、音色等声学特征。
9. 标记为实验性的唱腔推断。
10. 可用于 Suno 的结构化中英文提示词。

首个里程碑不要求一次实现全部模型，但必须建立可持续扩展的服务骨架、协议、任务系统和至少一条真实分析链路。

## 3. 仓库与技术边界

### 3.1 独立仓库

- 新建独立 GitHub 仓库 `zenme-music-service`，不得放入 `zenme-local` 的 Next.js 运行时。
- 服务拥有独立版本、依赖、构建、测试和发布流程。
- 建议使用 Python 3.11；需要兼容 Windows 11 和 NVIDIA RTX 4090。
- 服务不得要求用户预先安装全局 Python、CUDA Toolkit 或系统级 Python 包。最终发行方式应提供受控运行时或明确的首次安装流程。

### 3.2 Zenme Local 职责

Zenme Local 只负责：

- 音乐文件的项目归属和原始文件管理。
- 启动、发现、健康检查和关闭本地服务。
- 由播放器节点创建、取消、重试任务，并把播放器作为所有分析结果节点的父级。
- 展示阶段进度、结果、时间轴和错误。
- 从播放器展开并展示歌词节点，在统一时间轴上联动歌词行、音乐结构区段和播放位置。
- 从播放器按需展开综合分析节点和 Suno 提示词节点；重复展开时定位已有节点，不重复创建。
- 保存服务返回的统一分析结果引用。
- 基于结构化分析结果请求文本模型生成报告和 Suno 提示词。

Zenme Local 不得：

- 在 Electron 渲染进程中加载 Python、PyTorch、CUDA 或音频模型。
- 在 Next.js API Route 中直接执行长时间模型推理。
- 解析单个模型的私有输出格式。
- 根据服务日志文本猜测任务状态。

### 3.3 音乐服务职责

音乐服务负责：

- FFmpeg 探测、解码和标准化。
- 模型下载、校验、版本管理与许可证元数据。
- CPU/GPU任务调度、显存预算和模型卸载。
- 分析阶段执行、进度、取消和失败恢复。
- 中间文件、分轨和阶段缓存。
- 将各适配器结果归一化为统一数据模型。
- 输出来源、模型版本、置信度和诊断信息。

## 4. 开源方案规则

- 优先集成成熟开源项目，不自行实现分轨、歌词识别、结构分析、和弦识别、音频转 MIDI 等核心算法。
- 首选候选：FFmpeg、Demucs 或维护中的兼容实现、Whisper、All-In-One、Essentia、Chordino/madmom、Basic Pitch。
- 每个适配器引入前必须记录：仓库、版本、最后维护时间、代码许可证、模型权重许可证、下载大小、显存需求、Windows 支持和替代方案。
- 已归档项目必须封装在可替换适配器后，不得成为公共 API 的概念。
- AGPL、GPL、CC BY-NC-SA 或其他限制性许可证不得在未记录影响的情况下打包进发行物。
- 云端 API 可以作为后续适配器加入，但不得破坏完全本地模式。

## 5. 服务启动与认证规则

### 5.1 启动

Electron 主进程启动服务时传入：

```text
--host 127.0.0.1
--port 0
--data-dir <absolute-path>
--session-token <random-secret>
--parent-pid <electron-pid>
```

- `port=0` 表示由操作系统分配空闲端口。
- 服务启动后在 stdout 输出一行机器可读握手，不得混入其他文字：

```json
{"event":"ready","port":43127,"version":"0.1.0","protocolVersion":1}
```

- 握手完成后普通日志写入 stderr 或本地日志文件。
- 如果父进程消失，服务应在无活动任务时自动退出；存在任务时按配置完成、暂停或安全取消。

### 5.2 认证

- 只监听 `127.0.0.1`，禁止默认监听 `0.0.0.0`。
- 所有 `/v1/*` 请求必须携带：

```http
Authorization: Bearer <session-token>
```

- 健康检查也必须认证，避免本机其他进程枚举模型和数据目录。
- 会话令牌只存在于进程内存，不写入日志、项目文件或分析结果。

## 6. 协议与兼容规则

### 6.1 版本

- URL 主版本使用 `/v1`。
- `GET /v1/health` 返回 `protocolVersion`。
- Zenme 在协议主版本不兼容时必须拒绝创建任务，并提示升级服务。
- 新增可选字段保持向后兼容；删除或改变字段语义必须升级协议主版本。

### 6.2 时间与单位

- 所有时间点和时间区间使用秒，类型为有限非负浮点数。
- 时间区间使用半开区间 `[start, end)`，并满足 `end >= start`。
- BPM 使用浮点数；频率使用 Hz；响度使用 LUFS；峰值使用 dBFS。
- 文件大小使用字节；采样率使用 Hz。
- 日期时间使用 UTC ISO 8601。

### 6.3 路径

- Zenme 与服务运行在同一台机器，可传递绝对本地路径。
- 服务必须验证输入路径存在且位于允许的数据目录或显式授权路径中。
- API结果不得暴露服务内部临时目录；输出文件以 artifact ID 和受控本地路径表示。
- 不接受客户端拼接的任意删除路径。

## 7. 首版 API 合同

接口详细说明见 `docs/api/music-analysis-service.md`。首版必须实现：

```text
GET    /v1/health
GET    /v1/capabilities
POST   /v1/jobs
GET    /v1/jobs/{jobId}
GET    /v1/jobs/{jobId}/events
POST   /v1/jobs/{jobId}/cancel
POST   /v1/jobs/{jobId}/retry
GET    /v1/jobs/{jobId}/result
POST   /v1/models/install
DELETE /v1/cache/{inputSha256}
```

### 7.1 创建任务

```json
{
  "projectId": "project-id",
  "inputPath": "C:/Users/user/Zenme/projects/project-id/files/song.mp3",
  "inputSha256": "hex-sha256",
  "profile": "complete",
  "capabilities": [
    "metadata",
    "waveform",
    "stems",
    "lyrics",
    "structure",
    "chords",
    "genre",
    "mood",
    "instruments",
    "vocal_features"
  ],
  "options": {
    "language": "auto",
    "keepStems": true
  }
}
```

幂等规则：相同 `inputSha256 + capabilities + options + analyzerVersions` 应复用有效缓存，但每次请求仍返回独立 job ID。

### 7.2 任务状态

```text
queued
preparing
running
succeeded
failed
cancelled
```

任务响应必须包含：

```json
{
  "id": "job-id",
  "status": "running",
  "progress": 0.42,
  "stage": "lyrics",
  "stageLabel": "正在识别歌词",
  "createdAt": "2026-07-12T00:00:00Z",
  "startedAt": "2026-07-12T00:00:01Z",
  "completedAt": null,
  "retryable": false,
  "error": null
}
```

- `progress` 范围为 `0..1`，不得倒退。
- `stage` 使用稳定英文枚举；`stageLabel` 是可展示中文，但 Zenme 不依赖其判断逻辑。
- 失败任务返回稳定错误码、用户消息和 `retryable`，不得返回未经处理的 Python traceback。

### 7.3 SSE事件

事件类型：

```text
snapshot
status
progress
stage_completed
warning
completed
failed
heartbeat
```

- 建立连接后首先发送完整 `snapshot`。
- 每 15 秒发送心跳。
- 断线重连后 Zenme 先读取任务快照，再继续订阅，不假设事件绝不丢失。
- `completed` 事件只表示结果已原子落盘并可通过 result 端点读取。

## 8. 统一结果模型

服务内部可以使用各模型的原始结构，对外必须返回统一 `MusicAnalysisResult`。

```json
{
  "schemaVersion": 1,
  "jobId": "job-id",
  "input": {
    "sha256": "hex",
    "duration": 240.5,
    "sampleRate": 44100,
    "channels": 2,
    "codec": "mp3"
  },
  "summary": {
    "bpm": { "value": 118.2, "confidence": 0.91, "source": "analyzer-id" },
    "key": { "value": "A minor", "confidence": 0.78, "source": "analyzer-id" }
  },
  "segments": [],
  "lyrics": [],
  "chords": [],
  "tags": {
    "genres": [],
    "moods": [],
    "instruments": []
  },
  "vocal": {},
  "artifacts": [],
  "provenance": []
}
```

每个分析值至少具有：

- `value`
- `source`
- `modelVersion`
- `confidence`，或明确的 `confidenceAvailable: false`

不得由聚合层伪造模型未提供的置信度。

## 9. 适配器接口

每个分析器实现统一接口，概念示例：

```python
class AnalyzerAdapter(Protocol):
    id: str
    version: str
    capabilities: set[str]

    def requirements(self) -> ResourceRequirements: ...
    def prepare(self, context: JobContext) -> None: ...
    def analyze(self, context: JobContext) -> AnalyzerResult: ...
    def cancel(self, job_id: str) -> None: ...
```

要求：

- 输入和输出均可序列化。
- 不直接写 Zenme 项目文件。
- 所有产物通过 artifact registry 登记。
- 支持取消检查点。
- 错误转换为稳定错误码。
- 模型路径、设备和参数由服务配置注入。

## 10. 任务调度与 RTX 4090 规则

- 默认只有一个重型 GPU 阶段同时运行。
- 调度器维护每个适配器的估算显存、CPU线程和临时磁盘需求。
- 服务启动时检测 GPU、驱动、CUDA运行时和可用显存，并通过 health/capabilities 返回。
- 显存不足时任务保持排队或回退 CPU，不允许因 OOM 导致整个服务退出。
- GPU OOM 后必须卸载相关模型、清理 CUDA 缓存，并将任务标记为可重试失败。
- 轻量 CPU 分析可与单个 GPU 阶段并行，但不得影响取消和退出响应。

## 11. 文件、缓存与隐私

建议目录：

```text
music-service/
  models/
  cache/<sha256>/<analyzer>/<version>/
  jobs/<job-id>/
  artifacts/<artifact-id>/
  logs/
```

- 阶段结果使用临时文件写入后原子重命名。
- 缓存元数据记录输入哈希、模型、参数、创建时间、大小和最后访问时间。
- 用户可配置缓存上限和保留时间。
- 清理缓存不得删除 Zenme 管理的原始音乐。
- 默认不上传任何音频、歌词或特征到互联网。
- 如果将来启用云端适配器，必须在任务创建前明确显示供应商和上传范围。

## 12. 模型安装规则

- 模型不随首个桌面安装包全部打包。
- `capabilities` 返回未安装能力及对应模型包信息。
- 安装前展示名称、版本、下载大小、磁盘需求、许可证和用途。
- 下载必须支持校验和、断点续传和失败清理。
- 只从配置的可信源下载，并验证 SHA-256。
- 模型版本更新不得覆盖仍被缓存结果引用的旧版本元数据。

## 13. Zenme Local 对接任务

音乐服务骨架稳定后，在 `zenme-local` 中完成：

1. Electron 主进程服务管理器：启动、握手、健康检查、退出和崩溃重启。
2. Preload 暴露最小服务状态接口，不暴露会话令牌。
3. Next.js 本地代理层：只接受本机可信请求，并把会话令牌保留在服务端。
4. 设置页“音乐分析”区域：服务状态、GPU、已安装能力、模型安装和缓存管理。
5. 音乐文件节点或独立音乐节点：播放、波形、创建分析任务。
6. 音乐分析节点：阶段进度、取消、重试、结构时间轴和结果展示。
7. Suno 提示词节点：只读取统一结果，不直接读取分析器原始文件。
8. 项目删除时通知服务清理项目级任务引用，但共享哈希缓存按策略保留。

## 14. 分阶段开发计划

### 里程碑 A：服务骨架

- 独立仓库和 Python 工程。
- 本机认证、动态端口、ready 握手。
- health、capabilities、jobs、SSE。
- SQLite 或等价本地任务存储。
- 模拟分析器完成端到端任务。
- Windows 可执行开发启动方式。

### 里程碑 B：基础音频链路

- FFmpeg 探测与标准化。
- 文件哈希校验。
- metadata、waveform、基础响度和时长。
- 阶段缓存、artifact registry。
- Zenme 最小服务管理器和任务进度界面。

### 里程碑 C：核心 AI 分析

- 分轨适配器。
- Whisper 歌词适配器。
- All-In-One 结构适配器。
- 统一时间轴与结果聚合。

### 里程碑 D：音乐语义与和声

- 风格、情绪、乐器适配器。
- 和弦时间轴。
- Basic Pitch 音符/MIDI。
- 人声声学特征。

### 里程碑 E：产品完成度

- Suno 提示词生成。
- 模型安装和许可证展示。
- 缓存管理。
- 任务恢复、取消和重试压力测试。
- Windows 打包与冷启动验证。

## 15. 验收标准

### 服务骨架验收

- 未授权请求全部返回 401。
- 服务只监听回环地址。
- Electron 能取得 ready 握手并完成健康检查。
- 模拟任务支持进度、取消、重试、完成和重启恢复。
- 完成事件发出时结果已可读取。

### 首条真实链路验收

- 上传 MP3、WAV、FLAC、M4A 均能完成标准化。
- 同一文件重复分析命中缓存。
- 取消任务后无遗留 GPU进程和未登记临时文件。
- 服务崩溃不会导致 Zenme 主窗口崩溃。
- 分析结果包含适配器和模型版本。

### 质量门禁

- Python lint、类型检查和测试全部通过。
- API schema 有自动化契约测试。
- Zenme 与服务分别具有集成测试夹具。
- 使用至少 10 首不同风格的许可测试音频执行端到端验证。
- 不把测试音乐、模型权重、密钥和用户目录提交到 Git。

## 16. 首个独立对话的执行指令

可将以下内容作为新对话的首条消息：

> 请读取 `G:\development\zenme-local\docs\tasks\music-analysis-service-development.md`，并以该文档为唯一任务基线。先在 `G:\development` 下建立独立项目 `zenme-music-service`，完成“里程碑 A：服务骨架”。采用成熟开源框架，不自行实现 HTTP 服务、任务数据库或事件协议底层。实现后运行测试，编写 README 和接口文档，但暂不接入真实音乐模型，也不要修改 Zenme Local，除非任务书明确要求。

## 17. 开放问题

- 独立服务最终使用 FastAPI、Litestar 或其他框架，需在里程碑 A 开始前基于维护状态和打包能力选择。
- 任务存储优先 SQLite；具体任务队列库需评估 Windows、取消语义和无外部服务依赖。
- Python 运行时采用内置便携环境、独立安装器还是首次启动下载，需要在完成服务骨架后做打包验证再决定。
- Demucs 维护状态及模型权重许可证需要重新核查，并准备至少一个可替代分轨适配器。
- Essentia 和 madmom 的许可证可能限制商业发行，首版可用于技术验证，但不得默认进入正式发行包。
