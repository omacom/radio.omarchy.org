import { resolve } from "node:path";
import { loadCatalog } from "../server/catalog.mjs";
import { proposeProgramme } from "../server/planner.mjs";
import { atomic } from "../server/storage.mjs";
const root = process.cwd(),
  data = resolve("var/planning");
const tracks = await loadCatalog(root, data);
const plan = await proposeProgramme(tracks);
await atomic("station/programme.json", JSON.stringify(plan, null, 2) + "\n");
console.log(
  "Saved the next programme. Start it with a new RADIO_DATA directory. The active station keeps its committed order.",
);
