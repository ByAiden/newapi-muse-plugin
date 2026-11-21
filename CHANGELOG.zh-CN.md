---
changelogVersion: 1
plugin: "byaiden_muse"
version: "1.0.0"
locale: "zh-CN"
---

# Changelog

## [1.0.0]

### Added

- 一个任务插件渠道即可通过 OpenAI Chat Completions、OpenAI Responses 和 Claude Messages 使用 Meta Model API 文本模型（Muse Wonder、Muse Spark 含 Contributor 模式模型、Muse Ember），支持流式，任何模型名原样转发，按 Meta 返回的 token 用量计费。
- Muse Image（`muse-image-1.0`），支持 OpenAI 图片接口（生成；编辑可用 JSON 或 multipart）和 Responses 接口，按实际返回的图片张数计费。
- Segment Anything Model 3.1（`sam-3.1`），走 Responses 接口，按图片或视频帧数计费，视频按 Meta 规则至少计 50 帧。
- Muse Voice Transcribe（`muse-voice-transcribe-1.0`），走 OpenAI 转写接口，按音频秒数计费，支持 Meta 的识别模式、关键词和语言偏好。
- 获取模型列表返回 Meta 对该密钥列出的模型。
- README 附可直接粘贴的官方价格表达式。
