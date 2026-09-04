import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
export async function jsonRequest(url, options = {}) {
  const origin = new URL(url).origin,
    signal = AbortSignal.timeout(25000);
  let response;
  for (let hop = 0; hop < 4; hop++) {
    response = await fetch(url, { ...options, redirect: "manual", signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    await response.body?.cancel();
    const next = new URL(location ?? "", url);
    if (
      hop === 3 ||
      !location ||
      next.origin !== origin ||
      next.protocol !== "https:" ||
      (options.method ?? "GET") !== "GET"
    )
      throw new Error("Provider redirect rejected");
    url = next.href;
  }
  if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2_000_000) {
      await reader.cancel();
      throw new Error("Provider response too large");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
export const str = { type: "string" };
export const list = (items) => ({ type: "array", items });
export const object = (properties) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
export async function model(role, policy, input, properties) {
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL)
    throw new Error("Editorial provider is not configured");
  const result = await jsonRequest(
    `${process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/responses`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL,
        store: false,
        max_output_tokens: 1800,
        input: [
          { role: "system", content: policy },
          { role: "user", content: JSON.stringify(input) },
        ],
        text: {
          format: {
            type: "json_schema",
            name: role,
            strict: true,
            schema: object(properties),
          },
        },
      }),
    },
  );
  if (result.status && result.status !== "completed")
    throw new Error(`${role} incomplete`);
  const content = result.output?.flatMap((o) => o.content ?? []) ?? [];
  if (content.some((c) => c.type === "refusal"))
    throw new Error(`${role} refused`);
  const text = content
    .filter((c) => c.type === "output_text")
    .map((c) => c.text)
    .join("");
  return JSON.parse(text);
}
export async function renderVoice(directory, id, text) {
  await mkdir(directory, { recursive: true });
  if (process.env.TTS_PROVIDER === "elevenlabs") {
    if (!process.env.ELEVENLABS_API_KEY || !process.env.ELEVENLABS_VOICE_ID)
      throw new Error("Voice provider is not configured");
    const path = join(directory, `${id}.mp3`);
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(process.env.ELEVENLABS_VOICE_ID)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
        signal: AbortSignal.timeout(45000),
      },
    );
    if (!response.ok) throw new Error(`TTS HTTP ${response.status}`);
    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length > 10_000_000) throw new Error("TTS response too large");
    await writeFile(path, audio);
    return path;
  }
  if (process.env.TTS_PROVIDER !== "local")
    throw new Error("Voice provider is not configured");
  const path = join(directory, `${id}.wav`);
  await new Promise((resolve, reject) => {
    const child = spawn(
      "espeak-ng",
      ["-v", "en-gb", "-s", "158", "-w", path, "--", text],
      { stdio: "ignore" },
    );
    const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error("Local TTS failed"));
    });
  });
  return path;
}
