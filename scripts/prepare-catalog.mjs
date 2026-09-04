import { resolve } from "node:path";
import { loadCatalog } from "../server/catalog.mjs";
await loadCatalog(process.cwd(), resolve(process.env.RADIO_DATA ?? "var"));
console.log("Catalogue prepared. Existing programme files were retained.");
