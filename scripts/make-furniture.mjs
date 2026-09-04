// Offline production only. Never called by the live station.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderVoice } from "../server/providers.mjs";
const directory = "station/furniture";
await mkdir(directory, { recursive: true });
const requests = [
  {
    file: "bed-30.mp3",
    music_length_ms: 30000,
    force_instrumental: true,
    prompt:
      "A restrained 30 second instrumental radio presentation bed for Omarchy Radio, an independent Linux community station. Warm minimal analog synth pulse, soft rounded bass, subtle electronic percussion, 104 BPM, polished late night alternative radio. Spacious middle with no lead melody, no voices, no singing, no samples or sound effects that resemble speech. A subtle opening sonic logo, steady quiet texture under a presenter, and a clean resolved ending. This is station furniture under speech, not a full song.",
  },
  {
    file: "jingle.mp3",
    music_length_ms: 5000,
    force_instrumental: true,
    prompt:
      "A five second professional radio station sonic logo: playful three note analog synthesizer motif, warm rounded bass hit, crisp electronic sparkle, stylish and understated, a subtle nod to vintage computer startup sounds. No voice, no vocals, no singing. Brief energetic opening and a clean resolved final note. For an independent electronic community radio station.",
  },
];
for (const request of requests) {
  const { file, ...body } = request;
  const response = await fetch(
    "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128",
    {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...body, model_id: "music_v1" }),
      signal: AbortSignal.timeout(180000),
    },
  );
  if (!response.ok) throw new Error("Eleven Music HTTP " + response.status);
  await writeFile(
    join(directory, file),
    Buffer.from(await response.arrayBuffer()),
  );
  console.log("Created " + file);
}
for (const [id, text] of [
  ["ident-1", "Omarchy Radio. Made by the community."],
  ["ident-2", "Your desktop. Your music. Omarchy Radio."],
]) {
  await renderVoice(directory, id, text);
  console.log("Created " + id);
}
await writeFile(
  join(directory, "production.json"),
  JSON.stringify(
    {
      provider: "ElevenLabs",
      createdAt: new Date().toISOString(),
      requests,
      idents: [
        "Omarchy Radio. Made by the community.",
        "Your desktop. Your music. Omarchy Radio.",
      ],
      description:
        "Prerecorded station furniture. The catalogue music is unchanged.",
    },
    null,
    2,
  ) + "\n",
);
