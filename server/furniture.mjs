import { basename, join } from "node:path";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { hashFile } from "./catalog.mjs";
import { readJSON, atomic } from "./storage.mjs";
import { decodeVoice, frames } from "./audio.mjs";
export async function loadFurniture(root, data) {
  const config = await readJSON(join(root, "station/furniture.json"), null);
  if (!config) return null;
  const load = async (file) => {
    if (typeof file !== "string" || basename(file) !== file)
      throw new Error("Invalid furniture filename");
    const source = join(root, "station/furniture", file),
      sha256 = await hashFile(source),
      path = join(data, "catalog", `${sha256}-furniture-v1.raw`);
    let length = (await stat(path).catch(() => null))?.size;
    if (!length) {
      const pcm = await decodeVoice(source);
      await atomic(path, pcm);
      length = pcm.length;
    }
    if (length / 4 > frames(45) || length % 4)
      throw new Error("Furniture must be stereo and shorter than 45 seconds");
    return { path, sha256, frames: length / 4 };
  };
  const bed = await load(config.bed),
    sting = await load(config.sting),
    idents = [];
  for (const row of config.idents) {
    const audio = await load(row.file);
    if (audio.frames + frames(0.2) > sting.frames)
      throw new Error("Ident exceeds its reserved opening");
    idents.push({ ...audio, text: String(row.text).slice(0, 200) });
  }
  if (!idents.length || bed.frames < frames(15))
    throw new Error("Furniture needs an ident and a presentation bed");
  const result = {
    bed,
    sting,
    idents,
    frames: bed.frames + sting.frames,
    micStart: sting.frames,
    micEnd: bed.frames + sting.frames,
  };
  return {
    ...result,
    id: createHash("sha256")
      .update(
        JSON.stringify(result, (key, value) =>
          key === "path" ? undefined : value,
        ),
      )
      .digest("hex"),
  };
}
