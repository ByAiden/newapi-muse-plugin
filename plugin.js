// Meta Model API (Muse) on one New API channel: Muse Wonder, Muse Spark and
// Muse Ember text over Chat Completions, Responses and Messages, Muse Image
// generation and edits, Segment Anything Model 3.1 segmentation and Muse
// Voice Transcribe speech to text.
//
// Text goes through meta.relay unchanged; the host bills it from the vendor's
// token usage like any OpenAI or Claude channel. The other models are billed
// by Meta per image, per segmented image or video frame and per second of
// audio, not per token. The convert hooks replace their usage with the
// vendor's list price in micro-US-dollars as input tokens, so one model ratio
// (0.5 = 1 USD per 1M tokens) prices all of them at Meta's list price.

export const PLUGIN_KEY = "byaiden_muse";

export const TEXT_MODELS = [
  "muse-wonder-1.0",
  "muse-spark-1.3",
  "muse-spark-1.2",
  "muse-spark-1.1",
  "muse-spark-1.3-contributor",
  "muse-spark-1.2-contributor",
  "muse-ember-1.0",
];
export const IMAGE_MODEL = "muse-image-1.0";
export const SEGMENTATION_MODEL = "sam-3.1";
export const TRANSCRIPTION_MODEL = "muse-voice-transcribe-1.0";
export const MODEL_IDS = TEXT_MODELS.concat([IMAGE_MODEL, SEGMENTATION_MODEL, TRANSCRIPTION_MODEL]);

// Meta's list prices in micro-US-dollars (1e-6 USD), the unit the converted
// usage reports as input tokens.
export const MICRO_USD = {
  image: 10000, // Muse Image: 0.01 USD per generated image
  segmentedImage: 2500, // SAM 3.1: 2.50 USD per 1,000 images
  segmentedFrame: 200, // SAM 3.1: 0.20 USD per 1,000 video frames
  audioSecond: 50, // Muse Voice Transcribe: 0.18 USD per hour, whole seconds
};
export const MIN_VIDEO_FRAMES = 50;

export const meta = {
  "apiVersion": 1,
  "key": "byaiden_muse",
  "name": "Muse (Meta Model API)",
  "icon": "Meta",
  "description": {
    "en": "Meta Model API on one channel: Muse Wonder, Spark and Ember text, Muse Image, SAM 3.1 segmentation and Muse Voice Transcribe",
    "zh": "一个渠道接入 Meta Model API：Muse Wonder、Spark、Ember 文本，Muse Image 生图，SAM 3.1 分割，Muse Voice Transcribe 语音识别"
  },
  "version": "1.0.0",
  "author": {
    "name": "ByAiden",
    "url": "https://github.com/ByAiden"
  },
  "website": "https://dev.meta.ai/docs/overview",
  "baseUrl": "https://api.meta.ai",
  "allowedHosts": [
    "api.meta.ai"
  ],
  "models": [
    "muse-wonder-1.0",
    "muse-spark-1.3",
    "muse-spark-1.2",
    "muse-spark-1.1",
    "muse-spark-1.3-contributor",
    "muse-spark-1.2-contributor",
    "muse-ember-1.0",
    "muse-image-1.0",
    "sam-3.1",
    "muse-voice-transcribe-1.0"
  ],
  "keyHint": {
    "en": "Meta Model API key (MODEL_API_KEY)",
    "zh": "Meta Model API 密钥（MODEL_API_KEY）"
  },
  "relay": [
    {
      "incoming_path": "/v1/chat/completions",
      "upstream_path": "/v1/chat/completions"
    },
    {
      "incoming_path": "/v1/messages",
      "upstream_path": "/v1/messages"
    },
    {
      "incoming_path": "/v1/responses",
      "upstream_path": "/v1/responses",
      "converter": "plugin",
      "models": [
        "muse-image-1.0",
        "sam-3.1"
      ]
    },
    {
      "incoming_path": "/v1/responses",
      "upstream_path": "/v1/responses"
    },
    {
      "incoming_path": "/v1/images/generations",
      "upstream_path": "/v1/images/generations",
      "converter": "plugin"
    },
    {
      "incoming_path": "/v1/images/edits",
      "upstream_path": "/v1/images/edits",
      "converter": "plugin"
    },
    {
      "incoming_path": "/v1/audio/transcriptions",
      "upstream_path": "/v1/asr/transcribe",
      "converter": "plugin"
    },
    {
      "incoming_path": "/v1/models",
      "upstream_path": "/v1/models"
    }
  ]
};

// ---------------------------------------------------------------------------
// Helpers

const RESPONSES_PATH = "/v1/responses";
const IMAGE_GENERATIONS_PATH = "/v1/images/generations";
const IMAGE_EDITS_PATH = "/v1/images/edits";
const TRANSCRIPTION_PATH = "/v1/audio/transcriptions";
const ASR_PATH = "/v1/asr/transcribe";
const MAX_IMAGES = 10;

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

function fail(message) {
  throw new Error(message);
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function convertError(status, message, code) {
  const error = { status: status, message: message };
  if (code) error.code = code;
  return { error: error };
}

function upstreamError(parsed, status, fallback) {
  const object = plainObject(parsed) || {};
  const inner = plainObject(object.error);
  let message = inner && typeof inner.message === "string" ? inner.message : typeof object.message === "string" ? object.message : "";
  if (!message && typeof object.error === "string") message = object.error;
  const code = inner && typeof inner.code === "string" ? inner.code : typeof object.code === "string" ? object.code : "";
  const httpStatus = status >= 400 && status <= 599 ? status : 502;
  return convertError(httpStatus, message || fallback || "Meta Model API error " + status, code);
}

function wholeNumber(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// The usage a converted reply carries: the vendor's charge in micro-USD,
// split as all but one input token and one output token. A stream whose
// usage has no output tokens gets them estimated from its text (SAM streams
// long mask text), so one is always reported; with a completion ratio of 1
// the sum is exact.
export function microUsdUsage(micro, extra) {
  const amount = Math.max(0, Math.round(micro));
  const output = amount > 0 ? 1 : 0;
  const input = amount - output;
  return Object.assign(
    {
      input_tokens: input,
      output_tokens: output,
      total_tokens: amount,
      input_tokens_details: { cached_tokens: 0, text_tokens: input, image_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
    extra || {}
  );
}

// The host counts web_search_call and image_generation_call items of a
// Responses reply at the model's tool prices. Muse Image's own searches and
// images are inside its per-image price and SAM has no tools, so these
// counts are reported as zero on the converted routes.
const ZERO_TOOLS = { web_search: 0, web_search_preview: 0, image_generation: 0 };

function withZeroTools(result) {
  result.tools = Object.assign({}, ZERO_TOOLS);
  return result;
}

// ---------------------------------------------------------------------------
// Responses: Muse Image and SAM 3.1

function contentParts(input) {
  const parts = [];
  const visit = function (item) {
    if (Array.isArray(item)) {
      for (const entry of item) visit(entry);
      return;
    }
    const object = plainObject(item);
    if (!object) return;
    parts.push(object);
    if (Array.isArray(object.content)) visit(object.content);
  };
  visit(input);
  return parts;
}

export function segmentsVideo(body) {
  return contentParts(body && body.input).some(function (part) {
    return part.type === "input_video";
  });
}

function imageCallKey(item, index) {
  if (typeof item.id === "string" && item.id) return "id:" + item.id;
  return "index:" + index;
}

function deliveredImageCall(item) {
  if (!plainObject(item) || item.type !== "image_generation_call") return false;
  if (!trimmed(item.result)) return false;
  const status = trimmed(item.status).toLowerCase();
  return !["failed", "cancelled", "canceled", "incomplete", "partial", "in_progress", "generating"].includes(status);
}

// Ids of the images a Responses reply delivered, merged with those seen
// before on the stream.
export function imageCallIds(output, seen) {
  const ids = Array.isArray(seen) ? seen.slice() : [];
  if (Array.isArray(output)) {
    output.forEach(function (item, index) {
      if (!deliveredImageCall(item)) return;
      const key = imageCallKey(item, index);
      if (!ids.includes(key)) ids.push(key);
    });
  }
  return ids.slice(0, MAX_IMAGES * 10);
}

export function segmentationMicroUsd(usage, video) {
  if (!video) return MICRO_USD.segmentedImage;
  const frames = wholeNumber(plainObject(usage) && usage.video_frames_processed);
  return Math.max(frames, MIN_VIDEO_FRAMES) * MICRO_USD.segmentedFrame;
}

// One finished Responses object with its usage replaced.
export function billedResponse(response, state, seen) {
  const object = Object.assign({}, response);
  const vendorUsage = plainObject(response.usage);
  const failed = trimmed(response.status).toLowerCase() === "failed";
  if (state.kind === "segmentation") {
    const frames = wholeNumber(vendorUsage && vendorUsage.video_frames_processed);
    const extra = state.video ? { video_frames_processed: frames } : { images_processed: failed ? 0 : 1 };
    object.usage = microUsdUsage(failed ? 0 : segmentationMicroUsd(vendorUsage, state.video), extra);
    return { response: object, seen: seen || [] };
  }
  const ids = imageCallIds(response.output, seen);
  object.usage = microUsdUsage(ids.length * MICRO_USD.image, { images_generated: ids.length });
  return { response: object, seen: ids };
}

function responsesRequest(request) {
  const body = plainObject(request && request.body);
  if (!body) fail("request body must be a JSON object");
  const model = trimmed(request.model) || trimmed(body.model);
  const out = Object.assign({}, body, { model: model });
  const stream = request.stream === true || body.stream === true;
  const state = model === SEGMENTATION_MODEL || /^sam-/i.test(model)
    ? { kind: "segmentation", video: segmentsVideo(body) }
    : { kind: "image_responses" };
  return { body: out, stream: stream, state: state };
}

// ---------------------------------------------------------------------------
// Images: generations and edits

function imageFormRequest(request) {
  const form = request.form;
  if (!form || !plainObject(form.fields) || !Array.isArray(form.files)) fail("A multipart form is required.");
  const fields = Object.assign({}, form.fields);
  fields.model = trimmed(request.model) || trimmed(fields.model);
  const stream = request.stream === true || trimmed(Array.isArray(fields.stream) ? fields.stream[0] : fields.stream) === "true";
  return {
    method: "POST",
    form: {
      fields: fields,
      files: form.files.map(function (file) {
        return { field: String(file.field).replace(/#\d+$/, ""), from: file.field };
      }),
    },
    stream: stream,
    state: { kind: "images", count: 0 },
  };
}

function imageJSONRequest(request) {
  const body = plainObject(request.body);
  if (!body) fail("request body must be a JSON object");
  const out = Object.assign({}, body, { model: trimmed(request.model) || trimmed(body.model) });
  return { body: out, stream: request.stream === true || body.stream === true, state: { kind: "images", count: 0 } };
}

export function deliveredImages(data) {
  if (!Array.isArray(data)) return 0;
  let count = 0;
  for (const item of data) {
    if (plainObject(item) && (trimmed(item.b64_json) || trimmed(item.url))) count++;
  }
  return Math.min(count, MAX_IMAGES);
}

function imagesReply(parsed) {
  const body = Object.assign({}, parsed);
  const count = deliveredImages(parsed.data);
  body.usage = microUsdUsage(count * MICRO_USD.image, { images_generated: count });
  return { body: body };
}

const IMAGE_DONE_EVENTS = ["image_generation.completed", "image_edit.completed"];

function imageStreamEvent(ctx, input, parsed, state) {
  const event = {};
  if (input.event) event.event = input.event;
  if (!plainObject(parsed)) {
    event.data = String(input.data);
    return { events: [event] };
  }
  let count = wholeNumber(state.count);
  const type = trimmed(parsed.type) || trimmed(input.event);
  if (IMAGE_DONE_EVENTS.includes(type) && trimmed(parsed.b64_json)) count = Math.min(count + 1, MAX_IMAGES);
  const copy = Object.assign({}, parsed);
  if (plainObject(parsed.usage)) {
    copy.usage = microUsdUsage(count * MICRO_USD.image, { images_generated: count });
  }
  event.data = JSON.stringify(copy);
  return { events: [event], state: Object.assign({}, state, { count: count }) };
}

// ---------------------------------------------------------------------------
// Speech to text: OpenAI's multipart request to Meta's /v1/asr/transcribe

const LANGUAGES = {
  ar: "Arabic", bn: "Bengali", cs: "Czech", da: "Danish", de: "German", el: "Greek", en: "English",
  es: "Spanish", fa: "Persian", fi: "Finnish", fr: "French", he: "Hebrew", hi: "Hindi", hu: "Hungarian",
  id: "Indonesian", it: "Italian", ja: "Japanese", ko: "Korean", ms: "Malay", nl: "Dutch", no: "Norwegian",
  pl: "Polish", pt: "Portuguese", ro: "Romanian", ru: "Russian", sv: "Swedish", ta: "Tamil", th: "Thai",
  tl: "Tagalog", tr: "Turkish", uk: "Ukrainian", ur: "Urdu", vi: "Vietnamese", zh: "Chinese",
};
const TRANSCRIPTION_FIELDS = ["model", "language", "response_format", "temperature", "prompt", "timestamp_granularities", "timestamp_granularities[]", "mode", "keywords", "keywords[]", "language_bias", "language_bias[]", "stream"];
const MODES = ["PUSH_TO_TALK", "ENDPOINTING", "DIARIZATION"];

function formValues(fields, key) {
  if (!Object.prototype.hasOwnProperty.call(fields, key)) return [];
  const value = fields[key];
  return (Array.isArray(value) ? value : [value]).map(function (item) {
    return String(item);
  });
}

function listField(fields, key) {
  const out = [];
  for (const raw of formValues(fields, key).concat(formValues(fields, key + "[]"))) {
    for (const piece of raw.split(",")) {
      const item = piece.trim();
      if (item && !out.includes(item)) out.push(item);
    }
  }
  return out;
}

export function languageForMeta(code) {
  const value = trimmed(code);
  if (!value) return "";
  const base = value.toLowerCase().split(/[-_]/)[0];
  if (Object.prototype.hasOwnProperty.call(LANGUAGES, base)) return LANGUAGES[base];
  if (/^[A-Za-z][A-Za-z ]{2,40}$/.test(value)) return value;
  fail("language " + value + " is not supported; use an ISO 639-1 code such as en, or a language name");
}

export function buildTranscriptionRequest(form, model) {
  if (!form || !plainObject(form.fields) || !Array.isArray(form.files)) fail("A multipart form with an audio file is required.");
  const fields = form.fields;
  for (const key of Object.keys(fields)) {
    if (!TRANSCRIPTION_FIELDS.includes(key)) fail(key + " is not supported");
  }
  const first = function (key) {
    return trimmed(formValues(fields, key)[0]);
  };
  if (first("stream") === "true") fail("stream is not supported; Meta's file transcription answers once");
  if (first("prompt")) fail("prompt is not supported; send keywords (comma separated) to bias recognition");
  const format = first("response_format") || "json";
  // The gateway bills the audio from the JSON reply's usage, so plain text,
  // SRT and VTT replies are not offered.
  if (!["json", "verbose_json"].includes(format)) fail("response_format must be json or verbose_json");
  const files = form.files.filter(function (file) {
    return file.field === "file";
  });
  if (files.length !== 1 || form.files.length !== 1) fail("exactly one audio file is required in the file field");
  const mode = (first("mode") || "PUSH_TO_TALK").toUpperCase();
  if (!MODES.includes(mode)) fail("mode must be one of " + MODES.join(", "));
  const upstream = { model: trimmed(model) || first("model") || TRANSCRIPTION_MODEL, audioEncoding: "WAV", mode: mode };
  const keywords = listField(fields, "keywords");
  if (keywords.length) upstream.keywords = keywords.slice(0, 100);
  const languages = [];
  const language = languageForMeta(first("language"));
  if (language) languages.push(language);
  for (const item of listField(fields, "language_bias")) {
    const name = languageForMeta(item);
    if (name && !languages.includes(name)) languages.push(name);
  }
  if (languages.length) upstream.languageBias = languages;
  return {
    path: ASR_PATH,
    method: "POST",
    headers: { Accept: "application/json" },
    form: {
      fields: { request: JSON.stringify(upstream) },
      files: [{ field: "audio", from: "file", contentType: "audio/wav" }],
    },
    stream: false,
    state: { kind: "transcription", responseFormat: format, language: language },
  };
}

// Meta meters audio in whole seconds, rounded down.
export function transcriptionReply(parsed, state) {
  const text = typeof parsed.transcript === "string" ? parsed.transcript : "";
  const ms = Number(parsed.audioDurationMs);
  const seconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const micro = seconds * MICRO_USD.audioSecond;
  const usage = {
    type: "tokens",
    input_tokens: micro,
    output_tokens: 0,
    total_tokens: micro,
    prompt_tokens: micro,
    completion_tokens: 0,
    seconds: seconds,
  };
  if (state && state.responseFormat === "verbose_json") {
    const turns = Array.isArray(parsed.turns) ? parsed.turns : [];
    return {
      task: "transcribe",
      language: trimmed(state.language),
      duration: Number.isFinite(ms) ? ms / 1000 : 0,
      text: text,
      segments: turns.filter(plainObject).map(function (turn, index) {
        const segment = {
          id: index,
          start: Number(turn.startMs) / 1000 || 0,
          end: Number(turn.endMs) / 1000 || 0,
          text: typeof turn.transcript === "string" ? turn.transcript : "",
        };
        if (typeof turn.speaker === "string") segment.speaker = turn.speaker;
        return segment;
      }),
      usage: usage,
    };
  }
  return { text: text, usage: usage };
}

// ---------------------------------------------------------------------------
// Convert hooks

export function convertRequest(ctx, request) {
  const path = ctx && ctx.path;
  if (path === RESPONSES_PATH) return responsesRequest(request);
  if (path === IMAGE_GENERATIONS_PATH || path === IMAGE_EDITS_PATH) {
    if (request && request.form) return imageFormRequest(request);
    return imageJSONRequest(request || {});
  }
  if (path === TRANSCRIPTION_PATH) return buildTranscriptionRequest(request && request.form, request && request.model);
  fail("This plugin does not convert " + path);
}

export function convertResponse(ctx, response) {
  const state = plainObject(ctx && ctx.state) || {};
  const status = response.status;
  const text = typeof response.body === "string" ? response.body : "";
  const parsed = text ? parseJSON(text) : null;
  if (status < 200 || status >= 300) return upstreamError(parsed, status);
  if (!plainObject(parsed)) return convertError(502, "Meta Model API returned an unreadable reply");
  if (state.kind === "transcription") return { body: transcriptionReply(parsed, state) };
  if (state.kind === "images") return imagesReply(parsed);
  if (state.kind === "segmentation" || state.kind === "image_responses") {
    return withZeroTools({ body: billedResponse(parsed, state, []).response });
  }
  return { body: text };
}

const TERMINAL_RESPONSE_EVENTS = ["response.completed", "response.incomplete", "response.failed"];

export function convertStreamEvent(ctx, input) {
  const state = plainObject(ctx && ctx.state) || {};
  if (!input || input.done) return {};
  if (input.dataBase64 !== undefined) return { chunks: [{ bodyBase64: input.dataBase64 }] };
  const data = String(input.data === undefined ? "" : input.data);
  const parsed = data.trim() && data.trim() !== "[DONE]" ? parseJSON(data) : null;
  const object = plainObject(parsed);
  if (object && object.error && !object.type) return upstreamError(object, 0, "the Meta Model API stream failed");
  if (state.kind === "images") return imageStreamEvent(ctx, input, parsed, state);
  const event = {};
  if (input.event) event.event = input.event;
  event.data = data;
  if (!object) return { events: [event] };
  const type = trimmed(object.type) || trimmed(input.event);
  if (state.kind === "image_responses" && type === "response.output_item.done" && deliveredImageCall(object.item)) {
    const index = Number.isInteger(object.output_index) ? object.output_index : 0;
    const seen = Array.isArray(state.seen) ? state.seen : [];
    const key = imageCallKey(object.item, index);
    const merged = seen.includes(key) || seen.length >= MAX_IMAGES * 10 ? seen : seen.concat([key]);
    return withZeroTools({ events: [event], state: Object.assign({}, state, { seen: merged }) });
  }
  if (TERMINAL_RESPONSE_EVENTS.includes(type) && plainObject(object.response)) {
    const billed = billedResponse(object.response, state, state.seen);
    event.data = JSON.stringify(Object.assign({}, object, { response: billed.response }));
    return withZeroTools({ events: [event], state: Object.assign({}, state, { seen: billed.seen }) });
  }
  return { events: [event] };
}
