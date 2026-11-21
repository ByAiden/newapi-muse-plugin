import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as plugin from "../plugin.js";

const {
  meta,
  PLUGIN_KEY,
  MODEL_IDS,
  MICRO_USD,
  convertRequest,
  convertResponse,
  convertStreamEvent,
  microUsdUsage,
  languageForMeta,
} = plugin;

const ROOT = new URL("..", import.meta.url).pathname;
const SOURCE = readFileSync(ROOT + "plugin.js", "utf8");

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

const ctx = (path, state) => ({ baseUrl: "https://api.meta.ai", path, config: {}, state: state === undefined ? null : state });
const ok = (body) => ({ status: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const billed = (usage) => usage.input_tokens + usage.output_tokens;

test("meta is a plain JSON literal equal to the evaluated meta", () => {
  const match = SOURCE.match(/export const meta = (\{[\s\S]*?\n\});/);
  assert.ok(match, "meta block found");
  assert.deepEqual(JSON.parse(match[1]), meta);
});

test("constants match meta and no other meta reference exists", () => {
  assert.equal(meta.key, PLUGIN_KEY);
  assert.match(PLUGIN_KEY, /^[a-z0-9]+_muse$/);
  assert.deepEqual(meta.models, MODEL_IDS);
  const outside = SOURCE.replace(/export const meta = \{[\s\S]*?\n\};/, "");
  assert.equal(/\bmeta\b/.test(outside.replace(/\/\/.*$/gm, "").replace(/Meta/g, "")), false);
});

test("every plugin route is converted by the hooks and others pass through", () => {
  const pluginRoutes = meta.relay.filter((route) => route.converter === "plugin");
  assert.deepEqual(pluginRoutes.map((r) => r.incoming_path), ["/v1/responses", "/v1/images/generations", "/v1/images/edits", "/v1/audio/transcriptions"]);
  assert.deepEqual(pluginRoutes[0].models, ["muse-image-1.0", "sam-3.1"]);
  const models = meta.relay.find((r) => r.incoming_path === "/v1/models");
  assert.equal(models.converter, undefined);
});

test("no subscription plan wording in the public source", () => {
  assert.equal(/coding plan|token plan|m plan|subscription|套餐|订阅|everyday|power usage|maximum usage/i.test(SOURCE), false);
});

test("microUsdUsage sums to the micro-USD amount with one output token", () => {
  assert.deepEqual(
    [microUsdUsage(10000).input_tokens, microUsdUsage(10000).output_tokens, microUsdUsage(10000).total_tokens],
    [9999, 1, 10000]
  );
  const zero = microUsdUsage(0);
  assert.equal(zero.input_tokens + zero.output_tokens, 0);
});

test("image generations: model mapped, billed per delivered image", () => {
  const request = deepFreeze({ body: { model: "alias", prompt: "fox", n: 3 }, model: "muse-image-1.0", stream: false });
  const out = convertRequest(ctx("/v1/images/generations"), request);
  assert.equal(out.body.model, "muse-image-1.0");
  assert.equal(out.body.n, 3);
  assert.equal(out.stream, false);
  const reply = convertResponse(ctx("/v1/images/generations", out.state), ok({ created: 1, data: [{ b64_json: "a" }, { b64_json: "b" }], usage: { input_tokens: 9000, output_tokens: 700 } }));
  assert.equal(billed(reply.body.usage), 2 * MICRO_USD.image);
  assert.equal(reply.body.data.length, 2);
});

test("image edits multipart keep fields and files", () => {
  const request = deepFreeze({
    form: { fields: { model: "alias", prompt: "blue", n: "2" }, files: [{ field: "image", filename: "a.png", contentType: "image/png", size: 10 }, { field: "image#1", filename: "b.png", contentType: "image/png", size: 10 }] },
    model: "muse-image-1.0",
    stream: false,
  });
  const out = convertRequest(ctx("/v1/images/edits"), request);
  assert.equal(out.form.fields.model, "muse-image-1.0");
  assert.deepEqual(out.form.files, [{ field: "image", from: "image" }, { field: "image", from: "image#1" }]);
});

test("image stream: usage on the final event covers every completed image", () => {
  const out = convertRequest(ctx("/v1/images/generations"), { body: { model: "muse-image-1.0", prompt: "x", n: 2, stream: true }, model: "muse-image-1.0", stream: true });
  assert.equal(out.stream, true);
  let state = out.state;
  const first = convertStreamEvent(ctx("/v1/images/generations", state), { event: "image_generation.completed", data: JSON.stringify({ type: "image_generation.completed", b64_json: "a", output_index: 0 }) });
  state = first.state;
  const second = convertStreamEvent(ctx("/v1/images/generations", state), { event: "image_generation.completed", data: JSON.stringify({ type: "image_generation.completed", b64_json: "b", output_index: 1, usage: { input_tokens: 5, output_tokens: 5 } }) });
  assert.equal(billed(JSON.parse(second.events[0].data).usage), 2 * MICRO_USD.image);
});

test("vendor errors pass through with their status and are not billed", () => {
  const out = convertResponse(ctx("/v1/images/generations", { kind: "images" }), { status: 400, headers: {}, body: JSON.stringify({ error: { message: "bad size", code: "invalid_size" } }) });
  assert.deepEqual(out, { error: { status: 400, message: "bad size", code: "invalid_size" } });
});

test("SAM image and video are billed per image and per frame with a 50-frame minimum", () => {
  const image = convertRequest(ctx("/v1/responses"), { body: { model: "sam-3.1", input: [{ role: "user", content: [{ type: "input_text", text: "bus" }, { type: "input_image", image_url: "https://x/a.png" }] }] }, model: "sam-3.1", stream: false });
  assert.deepEqual(image.state, { kind: "segmentation", video: false });
  const imageReply = convertResponse(ctx("/v1/responses", image.state), ok({ status: "completed", output: [], usage: { input_tokens: 3000, output_tokens: 5000 } }));
  assert.equal(billed(imageReply.body.usage), MICRO_USD.segmentedImage);
  assert.deepEqual(imageReply.tools, { web_search: 0, web_search_preview: 0, image_generation: 0 });

  const video = convertRequest(ctx("/v1/responses"), { body: { model: "sam-3.1", input: [{ role: "user", content: [{ type: "input_video", file_id: "file-1" }] }] }, model: "sam-3.1", stream: false });
  assert.equal(video.state.video, true);
  const long = convertResponse(ctx("/v1/responses", video.state), ok({ status: "completed", usage: { video_frames_processed: 120 } }));
  assert.equal(billed(long.body.usage), 120 * MICRO_USD.segmentedFrame);
  const short = convertResponse(ctx("/v1/responses", video.state), ok({ status: "completed", usage: { video_frames_processed: 10 } }));
  assert.equal(billed(short.body.usage), 50 * MICRO_USD.segmentedFrame);
  const failed = convertResponse(ctx("/v1/responses", video.state), ok({ status: "failed", usage: { video_frames_processed: 10 } }));
  assert.equal(billed(failed.body.usage), 0);
});

test("SAM stream: the completed event carries the per-frame charge", () => {
  const state = { kind: "segmentation", video: true };
  const delta = convertStreamEvent(ctx("/v1/responses", state), { event: "response.output_text.delta", data: JSON.stringify({ type: "response.output_text.delta", delta: "<0f>1" }) });
  assert.equal(delta.events[0].data, JSON.stringify({ type: "response.output_text.delta", delta: "<0f>1" }));
  const done = convertStreamEvent(ctx("/v1/responses", state), { event: "response.completed", data: JSON.stringify({ type: "response.completed", response: { status: "completed", usage: { video_frames_processed: 75 } } }) });
  assert.equal(billed(JSON.parse(done.events[0].data).response.usage), 75 * MICRO_USD.segmentedFrame);
});

test("Muse Image over Responses: billed per delivered image, its searches free", () => {
  const out = convertRequest(ctx("/v1/responses"), { body: { model: "muse-image-1.0", input: "draw" }, model: "muse-image-1.0", stream: false });
  assert.deepEqual(out.state, { kind: "image_responses" });
  const reply = convertResponse(ctx("/v1/responses", out.state), ok({
    status: "completed",
    output: [
      { type: "web_search_call", id: "ws", status: "completed" },
      { type: "image_generation_call", id: "ig_1", status: "completed", result: "AAA" },
      { type: "image_generation_call", id: "ig_2", status: "failed", result: "" },
      { type: "image_generation_call", id: "ig_3", status: "completed", result: "BBB" },
    ],
    usage: { input_tokens: 9000, output_tokens: 700 },
  }));
  assert.equal(billed(reply.body.usage), 2 * MICRO_USD.image);
  assert.equal(reply.tools.web_search, 0);
  assert.equal(reply.tools.image_generation, 0);
});

test("Muse Image stream: images seen on output_item.done are not counted twice", () => {
  let state = { kind: "image_responses" };
  const item = { type: "image_generation_call", id: "ig_1", status: "completed", result: "AAA" };
  const r1 = convertStreamEvent(ctx("/v1/responses", state), { event: "response.output_item.done", data: JSON.stringify({ type: "response.output_item.done", output_index: 0, item }) });
  state = r1.state;
  const r2 = convertStreamEvent(ctx("/v1/responses", state), { event: "response.completed", data: JSON.stringify({ type: "response.completed", response: { status: "completed", output: [item], usage: { input_tokens: 1 } } }) });
  assert.equal(billed(JSON.parse(r2.events[0].data).response.usage), MICRO_USD.image);
});

test("transcription: OpenAI form to Meta's request part and audio part", () => {
  const request = deepFreeze({ form: { fields: { model: "whisper-1", language: "zh-CN", keywords: "Muse, Meta", response_format: "verbose_json", mode: "diarization" }, files: [{ field: "file", filename: "a.wav", contentType: "audio/wav", size: 100 }] }, model: "muse-voice-transcribe-1.0", stream: false });
  const out = convertRequest(ctx("/v1/audio/transcriptions"), request);
  assert.equal(out.path, "/v1/asr/transcribe");
  assert.equal(out.headers.Accept, "application/json");
  assert.deepEqual(JSON.parse(out.form.fields.request), { model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", mode: "DIARIZATION", keywords: ["Muse", "Meta"], languageBias: ["Chinese"] });
  assert.deepEqual(out.form.files, [{ field: "audio", from: "file", contentType: "audio/wav" }]);
  const reply = convertResponse(ctx("/v1/audio/transcriptions", out.state), ok({ sessionId: "s", transcript: "hi", audioDurationMs: 61999, turns: [{ turnId: 0, startMs: 0, endMs: 1500, transcript: "hi", speaker: "A" }] }));
  assert.equal(reply.body.usage.prompt_tokens, 61 * MICRO_USD.audioSecond);
  assert.equal(reply.body.usage.seconds, 61);
  assert.deepEqual(reply.body.segments, [{ id: 0, start: 0, end: 1.5, text: "hi", speaker: "A" }]);
});

test("transcription refuses what it cannot bill or serve", () => {
  const file = [{ field: "file", filename: "a.wav", contentType: "audio/wav", size: 1 }];
  const run = (fields, files) => () => convertRequest(ctx("/v1/audio/transcriptions"), { form: { fields, files: files || file }, model: "muse-voice-transcribe-1.0" });
  assert.throws(run({ response_format: "text" }), /json or verbose_json/);
  assert.throws(run({ prompt: "names" }), /keywords/);
  assert.throws(run({ mode: "chat" }), /mode must be/);
  assert.throws(run({ foo: "1" }), /foo is not supported/);
  assert.throws(run({}, []), /exactly one audio file/);
  assert.throws(run({ language: "x1" }), /language/);
  assert.equal(languageForMeta("en-US"), "English");
  assert.equal(languageForMeta("Cantonese"), "Cantonese");
});

test("unknown paths are refused", () => {
  assert.throws(() => convertRequest(ctx("/v1/embeddings"), { body: {} }), /does not convert/);
});
