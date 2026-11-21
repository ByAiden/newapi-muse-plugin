---
changelogVersion: 1
plugin: "byaiden_muse"
version: "1.0.0"
locale: "en"
translations:
  zh-CN: CHANGELOG.zh-CN.md
---

# Changelog

## [1.0.0]

### Added

- One Task Plugin channel serves Meta Model API text (Muse Wonder, Muse Spark including the Contributor-mode models, Muse Ember) through OpenAI Chat Completions, OpenAI Responses and Claude Messages, streaming included, with any model name passed on unchanged and billed from Meta's token usage.
- Muse Image (`muse-image-1.0`) through OpenAI's image API (generations, and edits as JSON or multipart) and the Responses API, billed per delivered image.
- Segment Anything Model 3.1 (`sam-3.1`) through the Responses API, billed per image or per video frame with Meta's 50-frame minimum.
- Muse Voice Transcribe (`muse-voice-transcribe-1.0`) through OpenAI's transcription API, billed per second of audio, with Meta's modes, keywords and language bias.
- Fetch models lists what Meta returns for the key.
- Ready-to-paste list-price expressions in the README.
