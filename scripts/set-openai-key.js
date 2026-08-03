import { setOpenAIKey, getOpenAIStatus } from "../server/services/config.js";

const key = process.argv[2];
if (!key) {
  console.error("Mangler nøgle som argument");
  process.exit(1);
}
const status = setOpenAIKey(key);
console.log("OpenAI gemt:", status.masked, "source:", status.source);
