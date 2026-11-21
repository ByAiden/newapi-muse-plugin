---
locale: en
translations:
  zh-CN: README.zh-CN.md
---

# Muse (Meta Model API)

Every model of Meta Model API from ONE new-api channel with a Meta Model API key: Muse Wonder, Muse Spark and Muse Ember text, Muse Image, Segment Anything Model 3.1 and Muse Voice Transcribe.

**English** | [简体中文](README.zh-CN.md)

- Text: OpenAI Chat Completions, OpenAI Responses and Claude Messages, streaming included. Requests reach Meta unchanged under the model name the channel sends, and new-api bills them from Meta's token usage like any OpenAI or Claude channel; new text models need no plugin update.
- Images: `muse-image-1.0` through OpenAI's image API (generations, and edits as JSON or multipart) and through the Responses API (multi-turn editing), billed per delivered image.
- Segmentation: `sam-3.1` through the Responses API, billed per image or per video frame.
- Speech to text: `muse-voice-transcribe-1.0` through OpenAI's transcription API, billed per second of audio.

Requires new-api v1.0.0-rc.50 or later (plugins with a provider part). The plugin key is `byaiden_muse`.

## Channel setup

1. Install the plugin and add ONE channel of type Task Plugin bound to `byaiden_muse`.
2. Base URL: leave it empty (`https://api.meta.ai`). Key: a Meta Model API key. Leave `/v1` off the end of any Base URL.
3. Fetch models lists what Meta returns for the key.
4. Set prices (see Billing). The channel test button sends a chat request; pick a text model as the test model.

Selecting a plugin in the channel form REPLACES the channel's model list with this plugin's models. Before you switch an existing channel to this plugin, copy its model list and paste it back afterwards; mapping, groups and priority are kept.

## Models and endpoints

| Models | Client endpoints | Sent to Meta |
| --- | --- | --- |
| `muse-wonder-1.0`, `muse-spark-1.3`, `muse-spark-1.2`, `muse-spark-1.1`, `muse-spark-1.3-contributor`, `muse-spark-1.2-contributor`, `muse-ember-1.0`, and any other text model name | `POST /v1/chat/completions`, `POST /v1/responses`, `POST /v1/messages` | the same paths, unchanged |
| `muse-image-1.0` | `POST /v1/images/generations`, `POST /v1/images/edits`, `POST /v1/responses` | the same paths; only the usage of the reply is replaced |
| `sam-3.1` | `POST /v1/responses` | `/v1/responses`; only the usage of the reply is replaced |
| `muse-voice-transcribe-1.0` | `POST /v1/audio/transcriptions` | `POST /v1/asr/transcribe` |
| model list | `GET /v1/models` (Fetch models) | `GET /v1/models` |

The `-contributor` models are Meta's Contributor mode: much lower token prices in exchange for letting Meta train on the prompts and replies. Tell your users before you sell them, or keep them in a group of their own.

Notes:

- Messages: Meta rejects `stop_sequences`, `top_k` and unknown top-level fields with HTTP 400; the error reaches the client as Meta sent it.
- Images: Meta returns `b64_json` by default; `response_format: url` returns Meta's temporary signed link. `size` sets the aspect ratio only. `n` is 1 to 10.
- Segmentation: send the video inline in an `input_video` part (`video_url`, a public link or a `data:` URL, up to 50 MB). The Files API, and retrieving, cancelling or deleting stored responses, are not served by this channel; a `file_id` only works for files uploaded to Meta with the same key.
- Speech to text: Meta takes a WAV file holding mono 16-bit PCM at 16 kHz or 24 kHz, up to 10 minutes and 32 MB (convert with `ffmpeg -i in.m4a -ac 1 -ar 24000 -c:a pcm_s16le out.wav`). `response_format` is `json` or `verbose_json` (turns become `segments`, with `speaker` in diarization). `language` takes an ISO 639-1 code or a language name. Meta's own options: `mode` (`push_to_talk` default, `endpointing`, `diarization`), `keywords` and `language_bias` (comma separated). `prompt` and streaming are refused; the realtime WebSocket is not served.

## Billing

Text is billed by new-api from Meta's token usage, as on any channel: with ratios, or with expressions on `p` (input tokens), `c` (output tokens), `cr` (cached input tokens) and `len` (the whole prompt, for Muse Ember's long-context tier).

Muse Image, SAM 3.1 and Muse Voice Transcribe are not priced per token. For them the plugin replaces Meta's usage with Meta's list price in micro-US-dollars (millionths of a dollar), carried as tokens:

| Model | Charge carried as tokens |
| --- | --- |
| `muse-image-1.0` | 10,000 per delivered image (0.01 USD); images that fail or are filtered are not counted, and Muse Image's own searches are free |
| `sam-3.1` | 2,500 per image (2.50 USD per 1,000); 200 per video frame (0.20 USD per 1,000), at least 50 frames per video request |
| `muse-voice-transcribe-1.0` | 50 per second of audio (0.18 USD per hour), whole seconds rounded down |

So one price, 1 USD per million tokens, bills all three at Meta's list price: the expression `tier("base", p + c)`, or model ratio `0.5` with completion ratio `1`. Raise it by your margin.

Web search on the reasoning models is billed per call at new-api's tool price, whose default (`web_search`, 10 USD per 1,000 calls) is OpenAI's. Meta charges 2.50 USD per 1,000 searches: set the tool prices `web_search:muse-*` and `web_search_preview:muse-*` to `2.5`.

The expressions below are Meta's list prices in USD as of November 20, 2026; multiply them by your margin and check [Meta's pricing](https://dev.meta.ai/docs/pricing-rate-limits) when you set them. Paste each one in the model's pricing editor in expression mode.

| Model | Expression |
| --- | --- |
| `muse-wonder-1.0` | `tier("base", p * 4 + c * 20 + cr * 0.2)` |
| `muse-spark-1.3`, `muse-spark-1.2`, `muse-spark-1.1` | `tier("base", p * 1.25 + c * 4.25 + cr * 0.15)` |
| `muse-spark-1.3-contributor`, `muse-spark-1.2-contributor` | `tier("base", p * 0.1 + c * 0.2 + cr * 0.002)` |
| `muse-ember-1.0` | `len <= 200000 ? tier("base", p * 0.1 + c * 0.5 + cr * 0.004) : tier("long_context", p * 0.3 + c * 1.5 + cr * 0.012)` |
| `muse-image-1.0`, `sam-3.1`, `muse-voice-transcribe-1.0` | `tier("base", p + c)` |

Muse Ember bills a request with more than 200K input tokens, cached ones included, at the long-context rates in full, as Meta does.

On a site that sells quota in another currency, convert these USD numbers at your own rate.

## Tests

```bash
node --test test/
```
