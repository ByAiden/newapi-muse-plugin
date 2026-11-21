---
locale: zh-CN
---

# Muse (Meta Model API)

用一个 new-api 渠道和一个 Meta Model API 密钥接入 Meta Model API 的全部模型：Muse Wonder、Muse Spark、Muse Ember 文本，Muse Image 生图，Segment Anything Model 3.1 分割，Muse Voice Transcribe 语音识别。

[English](README.md) | **简体中文**

- 文本：OpenAI Chat Completions、OpenAI Responses 和 Claude Messages，支持流式。请求按渠道发送的模型名原样转给 Meta，new-api 按 Meta 返回的 token 用量计费，与普通 OpenAI、Claude 渠道相同；Meta 新出的文本模型无需更新插件。
- 生图：`muse-image-1.0`，支持 OpenAI 图片接口（生成；编辑可用 JSON 或 multipart）和 Responses 接口（多轮编辑），按实际返回的图片张数计费。
- 分割：`sam-3.1`，走 Responses 接口，按图片或视频帧数计费。
- 语音识别：`muse-voice-transcribe-1.0`，走 OpenAI 转写接口，按音频秒数计费。

需要 new-api v1.0.0-rc.50 及以上（支持带转发部分的插件）。插件 key 为 `byaiden_muse`。

## 渠道设置

1. 安装插件，新建一个「任务插件」类型的渠道，插件选 `byaiden_muse`。
2. Base URL 留空（即 `https://api.meta.ai`），密钥填 Meta Model API 密钥。任何 Base URL 末尾都不要带 `/v1`。
3. 「获取模型列表」返回 Meta 对该密钥列出的模型。
4. 设置价格（见「计费」）。渠道测试发送的是对话请求，测试模型请选文本模型。

在渠道表单里选择插件时，渠道的模型列表会被替换成本插件的模型。把已有渠道切换到本插件之前，请先复制它的模型列表，切换后再粘贴回去；模型映射、分组和优先级会保留。

## 模型与接口

| 模型 | 客户端接口 | 发往 Meta |
| --- | --- | --- |
| `muse-wonder-1.0`、`muse-spark-1.3`、`muse-spark-1.2`、`muse-spark-1.1`、`muse-spark-1.3-contributor`、`muse-spark-1.2-contributor`、`muse-ember-1.0`，以及其他任何文本模型名 | `POST /v1/chat/completions`、`POST /v1/responses`、`POST /v1/messages` | 同名路径，原样转发 |
| `muse-image-1.0` | `POST /v1/images/generations`、`POST /v1/images/edits`、`POST /v1/responses` | 同名路径，只替换回复里的用量 |
| `sam-3.1` | `POST /v1/responses` | `/v1/responses`，只替换回复里的用量 |
| `muse-voice-transcribe-1.0` | `POST /v1/audio/transcriptions` | `POST /v1/asr/transcribe` |
| 模型列表 | `GET /v1/models`（获取模型列表） | `GET /v1/models` |

带 `-contributor` 的模型是 Meta 的 Contributor 模式：token 价格低很多，代价是允许 Meta 用请求和回复训练模型。对外出售前请告知用户，或单独放一个分组。

说明：

- Messages：Meta 对 `stop_sequences`、`top_k` 和未知的顶层字段返回 HTTP 400，错误原样返回给客户端。
- 生图：Meta 默认返回 `b64_json`；`response_format: url` 返回 Meta 的临时签名链接。`size` 只决定宽高比。`n` 为 1 到 10。
- 分割：视频请放在 `input_video` 里直接发送（`video_url`，公开链接或 `data:` URL，最大 50 MB）。本渠道不提供 Files API，也不提供已存储回复的查询、取消和删除；`file_id` 只对用同一密钥直接上传到 Meta 的文件有效。
- 语音识别：Meta 只接受单声道 16 位 PCM、16 kHz 或 24 kHz 的 WAV 文件，最长 10 分钟、最大 32 MB（可用 `ffmpeg -i in.m4a -ac 1 -ar 24000 -c:a pcm_s16le out.wav` 转换）。`response_format` 为 `json` 或 `verbose_json`（说话轮次转为 `segments`，说话人分离模式下带 `speaker`）。`language` 填 ISO 639-1 代码或语言名称。Meta 自有参数：`mode`（默认 `push_to_talk`，另有 `endpointing`、`diarization`）、`keywords` 和 `language_bias`（逗号分隔）。不支持 `prompt` 和流式；不提供实时 WebSocket。

## 计费

文本由 new-api 按 Meta 返回的 token 用量计费，与其他渠道相同：可用倍率，也可用表达式，变量为 `p`（输入 token）、`c`（输出 token）、`cr`（缓存命中的输入 token）和 `len`（完整输入长度，用于 Muse Ember 的长上下文档位）。

Muse Image、SAM 3.1 和 Muse Voice Transcribe 不按 token 计价。插件把这三个模型回复里的用量替换为 Meta 官方价格，单位是百万分之一美元，以 token 数的形式上报：

| 模型 | 以 token 上报的金额 |
| --- | --- |
| `muse-image-1.0` | 每张返回的图片 10,000（0.01 美元）；生成失败或被过滤的图片不计，Muse Image 自己做的搜索不收费 |
| `sam-3.1` | 每张图片 2,500（每千张 2.50 美元）；每个视频帧 200（每千帧 0.20 美元），每个视频请求至少按 50 帧计 |
| `muse-voice-transcribe-1.0` | 每秒音频 50（每小时 0.18 美元），按整秒向下取整 |

因此这三个模型只要设一个价格：每百万 token 1 美元，即按 Meta 官方价计费。表达式为 `tier("base", p + c)`，或模型倍率 `0.5`、补全倍率 `1`。需要加价时按利润率放大即可。

推理模型的联网搜索按次计费，使用 new-api 的工具价格；默认值（`web_search` 每千次 10 美元）是 OpenAI 的价格。Meta 每千次搜索收 2.50 美元：请把工具价格 `web_search:muse-*` 和 `web_search_preview:muse-*` 设为 `2.5`。

下表为 2026 年 11 月 20 日 Meta 官方美元价格；设置时请乘以你的利润率，并核对 [Meta 价格页](https://dev.meta.ai/docs/pricing-rate-limits)。在模型定价编辑器里切换到表达式模式后粘贴。

| 模型 | 表达式 |
| --- | --- |
| `muse-wonder-1.0` | `tier("base", p * 4 + c * 20 + cr * 0.2)` |
| `muse-spark-1.3`、`muse-spark-1.2`、`muse-spark-1.1` | `tier("base", p * 1.25 + c * 4.25 + cr * 0.15)` |
| `muse-spark-1.3-contributor`、`muse-spark-1.2-contributor` | `tier("base", p * 0.1 + c * 0.2 + cr * 0.002)` |
| `muse-ember-1.0` | `len <= 200000 ? tier("base", p * 0.1 + c * 0.5 + cr * 0.004) : tier("long_context", p * 0.3 + c * 1.5 + cr * 0.012)` |
| `muse-image-1.0`、`sam-3.1`、`muse-voice-transcribe-1.0` | `tier("base", p + c)` |

与 Meta 一致：Muse Ember 单次请求输入超过 20 万 token（含缓存命中）时，整个请求都按长上下文价格计费。

若站点用其他货币出售额度，请按自己的汇率换算上述美元数字。

## 测试

```bash
node --test test/
```
