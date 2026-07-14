# 本地音乐分析服务接口草案

> 当前基线为 API-first。Zenme 默认连接独立组件提供的 loopback HTTP API；MCP stdio 只作为显式启用的可选集成。

服务端 DAG、缓存、结构融合、Qwen 和发布门禁的执行基线见
[service-improvement-execution-plan.md](https://github.com/alkaiddiamond/zenme-music-service/blob/main/docs/service-improvement-execution-plan.md)。

## 可选 stdio MCP 接入

设置 `ZENME_MUSIC_MCP_ENABLED=1` 后，Zenme 的 Next.js 服务端可作为 MCP Client，独立 `zenme-music-service` 作为 MCP Server。默认情况下不启用，也不得在普通 API 请求中隐式拉起 MCP 子进程。

工具包括 `analyze_music`、`get_music_job`、`cancel_music_analysis`、`retry_music_analysis`、`generate_suno_prompt`。资源包括任务状态、统一结果、Markdown 报告、波形、歌词和 opaque artifact URI。

显式启用后的发现顺序为：`ZENME_MUSIC_MCP_COMMAND` → 开发环境同级项目 `.venv` → PATH 中的 `zenme-music-mcp`。`ZENME_MUSIC_MCP_COMMAND_ARGS` 可用 JSON 字符串数组传递启动器前置参数。只要配置了 loopback HTTP URL 和 Token，始终优先使用 HTTP API。

## 服务边界

音乐分析服务是独立安装、独立升级并自行保存模型与运行数据的组件，不属于 Zenme 安装包。默认由组件自身启动 HTTP API，Zenme 只保存 API Base URL 与访问 Token。

服务不负责 Zenme 项目、画布和 UI 状态；Zenme 不负责 Python 环境、CUDA、模型或音频中间文件。Electron 包不得包含服务 EXE、Basic Pitch EXE、测试启动器或模型文件。

## 生命周期

1. 用户自行启动并管理音乐分析服务。
2. 用户在 Zenme 桌面设置中填写 Base URL + Token，或在启动 Zenme 前设置 `ZENME_MUSIC_SERVICE_URL` + `ZENME_MUSIC_SERVICE_TOKEN`。
3. Electron 使用 Bearer Token 请求 `GET /v1/health`；只有协议版本通过才把连接信息注入 Next.js 服务端进程。
4. 浏览器只请求 Zenme 的同源 `/api/music/*` 代理，由服务端添加 Token；Token 不返回 preload 调用结果、不进入 API 响应或日志。
5. Zenme 退出或清除连接时只清除自身内存/配置，不向外部服务发送停止信号。

### 桌面连接配置

- 桌面配置字段只有 `musicService.baseUrl` 和 `musicService.token`。渲染进程只能读取 `tokenConfigured: true/false`，不能读回 Token。
- 环境变量 `ZENME_MUSIC_SERVICE_URL` 与 `ZENME_MUSIC_SERVICE_TOKEN` 成对覆盖桌面配置；环境变量模式下设置 UI 为只读。
- 默认只允许 `http://127.0.0.1[:port]`、`http://localhost[:port]` 或 `http://[::1][:port]`，拒绝远程主机、HTTPS 降级混用、URL 凭据、查询参数和子路径。
- 未配置、配置不完整或连接失败时，Zenme 其他功能照常启动；音乐功能显示 `external API service not configured` 或连接错误。
- `MusicServiceConnection` 只做 URL 校验与带认证的健康检查，代码中没有 `spawn`、`kill`、EXE 发现或文件系统生命周期逻辑。

对已经运行的真实服务，设置 `ZENME_MUSIC_SERVICE_URL`、`ZENME_MUSIC_SERVICE_TOKEN` 后执行 `npm run test:music-integration`（`test:music-connect` 是同义命令）。该烟测验证 connection → Next.js proxy → 外部 API 的 health、capabilities、上传、任务、SSE、result 与中文报告；Zenme 连接清除后会再次请求 health，证明外部服务仍在运行。可用 `ZENME_MUSIC_TEST_INPUT_PATH` 指定真实歌曲，并用 `ZENME_MUSIC_TEST_ZENME_DATA_DIR` 指向服务允许读取的 Zenme 测试项目目录。

CI 如需隔离服务，必须在运行 Zenme 测试之前由 CI fixture 独立启动 API，并只把 URL + Token 交给此脚本。Zenme 仓库中的脚本不接收 EXE、不传 parent PID，也不启动或停止外部服务；测试脚本不进入 Electron 包。

## 首版端点

### `GET /v1/health`

返回服务版本、运行时、GPU、可用显存和已安装分析器。

### `GET /v1/capabilities`

返回已安装适配器及其能力、模型版本、许可证、设备要求和可配置参数。新版服务还返回：

- `profiles`：服务端产品 profile 及其公开能力映射；
- `publicCapabilities`：客户端可以请求的产品能力；
- `internalStages`：仅供诊断的内部执行阶段，Zenme 不得将其写入任务请求；
- `experimental`：实验能力的启用、运行时安装和降级状态，不包含模型绝对路径。

Zenme 先读取此端点。如果目标 profile 已公布，就发送 profile 与精简公共能力；旧服务没有
`profiles` 字段、返回空数组或能力探测暂时失败时，回退到 `profile: "complete"` 和旧显式能力列表。
新增字段均为 additive，旧客户端可以忽略。

### `POST /v1/jobs`

创建音乐分析任务。

```json
{
  "projectId": "project-id",
  "inputPath": "absolute-local-path",
  "inputSha256": "sha256",
  "capabilities": [
    "lyrics",
    "structure"
  ],
  "profile": "lyrics-structure"
}
```

当前产品 profile：

| Zenme 场景 | profile | 新服务显式公共能力 |
| --- | --- | --- |
| 播放器波形预览 | `player-preview` | `metadata`, `waveform` |
| 歌词与结构 | `lyrics-structure` | `lyrics`, `structure` |
| 综合分析 | `comprehensive-analysis` | 节点实际展示的分析结果字段 |
| Suno 提示词 | `suno-prompt` | `suno_prompt` |

profile 只表达产品意图，服务端 Planner 负责展开 DAG、合并同一适配器和复用阶段缓存。显式
`capabilities` 仍是合同的一部分，不能只发 profile。播放器 profile 不得展开 Demucs、Whisper、
All-In-One、Essentia 或 Qwen 等重模型。

### `POST /v1/jobs/plan`

使用与创建任务相同的请求体做只读预检，返回 `stages` 和 `missingCapabilities`，不创建 `jobId`、
不运行分析器。Zenme 可在诊断界面使用；普通节点创建仍可直接调用 `/v1/jobs`，由服务端执行相同预检。

### `GET /v1/jobs/{jobId}`

返回任务状态、总体进度、当前阶段、错误代码，以及 `createdAt`、`startedAt`、`completedAt`、`elapsedMs` 和 `durationMs`。执行中的 `elapsedMs` 由服务端实时计算；终态的 `durationMs` 是权威总耗时，Zenme 不自行覆盖。新版快照还包含 additive 的 `plannedStages` 与 `completedStages`，用于恢复和诊断；UI 不展示模型内部噪声。

创建任务时可在 `options.requiredCapabilities` 指定该任务不可缺少的核心能力。服务必须在正式分析前完成能力预检；缺失时以 `CAPABILITY_NOT_INSTALLED` 快速失败并返回 `missingCapabilities`，不得先执行无关的重型阶段。

### `GET /v1/jobs/{jobId}/events`

使用 Server-Sent Events 返回状态、阶段进度、日志摘要和完成事件。

### `POST /v1/jobs/{jobId}/cancel`

取消任务。适配器必须在安全检查点响应取消并清理未完成输出。

### `POST /v1/jobs/{jobId}/retry`

从失败阶段重试，不重复执行已有有效缓存阶段。

### `GET /v1/jobs/{jobId}/result`

返回统一 `MusicAnalysisResult`，其中每个字段包含值、时间范围、来源、模型版本和置信度。

Zenme 画布只持久化 `jobId`、状态、阶段和进度等任务引用，不把完整结果复制进画布快照。分析结果节点首次加载或应用重启后通过 `jobId` 重新读取结果，并优先展示服务返回的 `report.markdown` 中文可读报告；原始结构化字段仍用于时间轴、指标卡和 Suno 提示词节点。

顶层 `segments` 是供 Zenme 时间轴使用的最终结构。`structureMethod` 标明
`all-in-one`、`fused-v1` 或 `fused-qwen-v1`；内部候选和融合诊断不得替代顶层最终时间线。
Suno v2 返回 `style`、`moods`、`instruments`、`vocal`、`arrangement`、`tempo`、`key`、
`structure`、`promptZh`、`promptEn`、`negativePrompt`、`source` 和 `promptVersion`，并在兼容期保留
旧 `zh/en`。Zenme 优先读取 `promptZh/promptEn`，缺失时回退到 `zh/en`。

### `waveform` 数据合同

- `waveform` 是覆盖完整歌曲时间轴、按等时长桶排列的非负浮点数组，取值范围为 `0..1`。
- 每个桶表示该时段的 RMS 响度包络，不表示 PCM 瞬时最大采样值；服务端使用全曲第 98 百分位作为稳健归一化尺度，超过尺度的少量瞬态可截断为 `1`。
- `options.waveformPoints` 可指定期望点数，服务端限制为 `64..5000`；未指定时使用 `1000`。
- 波形生成器或归一化算法变化时必须提升适配器版本，使缓存键变化；客户端同时保存自己的显示算法版本并重新请求旧版画布波形。
- 综合分析结果和 `player-preview` 必须返回相同定义的波形数据，不能分别使用抽样和峰值两套语义。

### `POST /v1/models/install`

安装用户确认的模型。请求必须指定分析器、模型版本和预期许可证确认状态。

### `DELETE /v1/cache/{inputSha256}`

清理指定音频的可重建缓存，不删除 Zenme 项目中的原始文件。

## 统一能力名称

```text
metadata
waveform
stems
lyrics
lyrics_alignment
beats
structure
chords
notes
genre
mood
instruments
vocal_features
vocal_technique_experimental
suno_prompt
```

## 错误约定

错误响应只返回稳定错误码、可展示消息和可重试状态。模型原始异常写入经过脱敏的本地诊断日志，不直接透传到 Zenme 界面。

- `CAPABILITY_NOT_INSTALLED`：必需能力不可用，并返回 `missingCapabilities`；Zenme 应原样展示可理解消息。
- 新客户端不得把 `internalStages` 当作 capability 发送给旧服务。
- 新增结果字段、profile 和阶段字段均采用 additive 迁移；旧服务响应缺少它们时按旧合同继续运行。

## 发布复审边界

- Token 只存在于 Electron 配置和 Next.js 服务端代理，不进入浏览器响应、画布、普通日志或错误文本。
- 用户音频、歌词、模型路径和完整分析 JSON 均只在本机处理；Qwen 不读取原始音频，也不把歌词写入普通日志。
- `experimental` 只报告布尔安装状态，任务快照、plan、result、SSE 和错误响应不得返回用户目录或模型绝对路径。
- Essentia 研究链、Demucs 权重、非官方网易云歌词源和用户自备 Qwen GGUF 的许可/再分发边界以服务模型清单为准；未确认再发行权的权重不得进入 Zenme 或服务安装包。
- Zenme 退出、断开连接或清除配置只停止自身轮询，不终止独立服务及其任务。
