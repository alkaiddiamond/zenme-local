# 音乐节点与播放器开源方案调研

更新日期：2026-07-12

## 1. 结论

Zenme Local 首版建议采用以下组合：

- 单轨紧凑播放与波形 UI：`WaveSurfer.js v7`
- 音频元数据：`music-metadata`
- 容器、编码探测与代理转码：按需使用本地 `ffprobe` / `FFmpeg`
- 波形数据：当前由浏览器 Web Audio 本地解码并生成 RMS 包络；长音频再评估预计算峰值
- 播放会话：Zenme Local 自己实现很薄的全局 `AudioSession` 适配层，不自行实现播放器或波形引擎

不建议首版引入 Howler.js。WaveSurfer 已覆盖单轨播放、波形和结构区段，叠加另一套播放状态源没有收益。

产品当前只提供音乐资产、单轨播放器和同步歌词，不建设多轨 DAW。`waveform-playlist` 与 Tone.js 的调研结论保留为远期开放方向，不进入当前实现范围。

## 2. 候选方案

### 2.1 WaveSurfer.js v7（首选）

适合单轨音频播放器和交互式波形。v7 使用 TypeScript，默认采用 HTML Media Element 播放，并提供 Timeline、Regions、Hover、Minimap、Spectrogram 等插件。它支持传入预解码峰值，避免长音频在渲染进程中完整解码。

优点：

- 播放和波形由同一时间轴驱动，首版集成成本最低。
- 插件能够覆盖时间轴、区段、悬浮信息和后续结构标记。
- 支持预计算峰值，适合 Electron 本地大文件。
- API 类型完整，容易包装成 React 节点组件。

风险：

- 插件式标注能否满足歌词、和弦和多层段落的密集展示，需要原型验证。
- 不能把浏览器端完整解码当成长音频生产方案。

### 2.2 BBC Peaks.js（精确标注备选）

Peaks.js 面向可缩放波形、概览波形、点标记和区段标记，更接近音频审阅与标注工具。若播放器最终需要多层歌词、段落、和弦标注，Peaks.js 值得做对照原型。

优点：

- 时间点和区段是一等能力。
- 与 BBC `audiowaveform` 的预计算波形链路契合。
- 适合长音频和精确审阅。

风险：

- 命令式集成和自定义 UI 工作量高于 WaveSurfer。
- 对当前“常规播放 + 波形”需求偏重。

### 2.3 Howler.js（暂不采用）

Howler.js 是成熟的跨浏览器播放抽象，支持 Web Audio/HTML5 Audio 回退、音量、倍速、跳转、淡入淡出、并发和音频精灵，但不提供波形 UI。

它适合游戏音效、多音源混音或统一浏览器兼容层；本项目当前需要单轨波形播放器，使用它仍需额外波形库，因此首版不采用。若未来明确需要多实例混音，再重新评估。

### 2.4 waveform-playlist（远期开放方向）

该项目提供 React 组件、多个 Clip 的拖动与首尾裁剪、缩放波形、静音/独奏/音量、淡化、效果器、录音、预计算峰值和 WAV 导出，并以 Tone.js 作为可选播放引擎。它适合未来明确进入多轨剪辑时重新评估，但不进入当前播放器节点。

采用方式：

- 复用 `@waveform-playlist/core` 的 Track/Clip 语义和 `@waveform-playlist/browser` 的编辑组件。
- 用 Zenme 的本地 `fileId` 与 Range 接口替换示例中的普通 URL 加载。
- UI 重新适配 Zenme 设计令牌，不直接复制演示应用外观。
- 浏览器端负责低延迟预览，正式导出根据同一工程模型生成 FFmpeg `filter_complex` 并在本地服务离线渲染。
- 在长音频和大量轨道下验证 AudioBuffer 内存；必要时采用其 MediaElement 播放适配器或分块代理，而不是一次解码全部源文件。

### 2.5 wavesurfer-multitrack（原型备选）

WaveSurfer 官方示例链接到 `wavesurfer-multitrack`，可快速完成多轨对齐、波形和基础播放原型，许可证为 BSD-3-Clause。但仓库将其定位为 Wavesurfer 的 multitrack super-plugin，并明确说明项目采用商业支持模式；其完整剪辑和工程能力不如 waveform-playlist，因此不作为主方案。

## 3. 推荐架构

### 3.1 音乐节点

音乐节点只表达本地资产和稳定元数据：

- `fileId`、内容哈希、原始文件名、媒体类型、文件大小
- 标题、艺术家、专辑、年份、轨号、封面
- 时长、容器、编码、采样率、声道、比特率
- 播放代理文件引用（可选）
- 波形峰值产物引用及生成版本

节点内不得保存绝对路径，不维护播放定时器，也不按播放进度持续写快照。

### 3.2 播放器节点

播放器节点消费一条上游音乐连线，显示波形和播放控件，并作为歌词节点的唯一父级。运行时状态包括：

- `idle`、`loading`、`playing`、`paused`、`ended`、`error`
- 当前时间、缓冲范围、音量、倍速、循环状态
- WaveSurfer 实例和当前媒体会话 ID

画布快照只保存低频用户偏好，不保存高频播放进度。

播放器节点在画布内展示紧凑波形、总时长和播放控制，并提供创建歌词节点的入口。音乐节点不直接连接歌词节点。

### 3.3 歌词联动

播放器和歌词行共享统一秒制时间轴。播放器提供入口创建歌词子节点；歌词节点展示带时间戳歌词，播放时同步高亮，点击歌词行可控制播放位置。

### 3.4 全局 AudioSession

画布层提供唯一播放协调器：

1. 播放器节点请求播放。
2. 协调器暂停当前活动播放器。
3. 协调器将活动会话切换到新节点。
4. 节点卸载、断线、删除或项目切换时释放媒体资源。

这能避免多个 WaveSurfer 实例同时发声，也便于后续接入系统媒体键。

### 3.5 本地媒体接口

音频不能以任意绝对路径暴露给前端。应使用安全 `fileId` 访问同源 loopback 接口，并支持：

- `HEAD` 请求
- `Accept-Ranges: bytes`
- `Range` 请求与 `206 Partial Content`
- 正确的 `Content-Type`、`Content-Length`、`Content-Range`
- 基于内容哈希或文件版本的缓存标识

### 3.6 波形数据

生产方案不在渲染进程完整解码长音频。建议：

1. 上传后快速读取标签和基础媒体信息。
2. 后台生成多分辨率峰值数据。
3. 播放器先显示骨架，峰值完成后无跳动替换为波形。
4. 以 `audioHash + waveformVersion + resolution` 缓存。
5. 播放器与歌词节点共用同一秒制时间轴。

## 4. 必须先做的技术验证

1. 用 3 分钟 MP3、60 分钟 FLAC、可变码率 M4A 验证加载、跳转、内存和卸载。
2. 验证 loopback Range 接口在 Electron 下可连续拖动进度且不整文件读取。
3. 比较 WaveSurfer 与当前轻量波形在长音频下的可读性和性能。
4. 测试 20 个播放器节点存在、一个播放时的 CPU、内存与画布缩放帧率。
5. 验证项目切换、节点删除、断线和应用关闭时媒体资源全部释放。
6. 核对 WaveSurfer、Peaks.js、music-metadata、FFmpeg 分发方式与许可证义务。
7. 验证歌词行、播放头双向同步以及长歌词列表的滚动定位性能。

## 5. 产品待确认

- 首版格式白名单和不支持格式的提示方式。
- 是否持久化上次播放位置。
- 是否需要 A-B 循环、波形缩放、下载、播放列表、系统媒体键。
- 同一首音乐连接多个播放器时是否共享位置；建议不共享，只共享音乐资产。
- 是否允许在歌词节点直接修订歌词与时间戳，以及如何保留人工修订版本。

## 6. 官方资料

- WaveSurfer.js 文档：https://wavesurfer.xyz/docs/
- WaveSurfer.js 长音频与预计算峰值：https://wavesurfer.xyz/faq/
- WaveSurfer Multitrack：https://github.com/katspaugh/wavesurfer-multitrack
- Waveform Playlist：https://github.com/naomiaro/waveform-playlist
- Tone.js：https://tonejs.github.io/
- BBC Peaks.js：https://github.com/bbc/peaks.js
- BBC audiowaveform：https://github.com/bbc/audiowaveform
- Howler.js：https://github.com/goldfire/howler.js
- music-metadata：https://github.com/Borewit/music-metadata
- ffprobe：https://ffmpeg.org/ffprobe.html
