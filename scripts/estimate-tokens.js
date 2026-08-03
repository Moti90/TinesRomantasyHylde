import { readFileSync } from "fs";

const handbook = readFileSync("data/handbook.md", "utf8");
const columns = readFileSync("data/columns.json", "utf8");
const promptExtra = `
Regler, kalibrering, research, mofibo, query — typisk ca.
`;
const researchSample = 1800; // chars approx for research JSON
const anchorsSample = 1200;
const rules = 900;

const inputChars =
  handbook.length +
  columns.length +
  researchSample +
  anchorsSample +
  rules +
  promptExtra.length;

const inputTokens = Math.ceil(inputChars / 3.5); // dansk/JSON lidt tættere end 4
const outputTokens = 1100; // fuld række med ~40 felter

const prices = {
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
};

function usd(model, tin, tout) {
  const p = prices[model];
  return (tin / 1e6) * p.in + (tout / 1e6) * p.out;
}

console.log({
  handbookChars: handbook.length,
  columnsChars: columns.length,
  estInputTokens: inputTokens,
  estOutputTokens: outputTokens,
  usd_mini: usd("gpt-4o-mini", inputTokens, outputTokens),
  usd_4o: usd("gpt-4o", inputTokens, outputTokens),
  dkk_mini: usd("gpt-4o-mini", inputTokens, outputTokens) * 6.9,
  dkk_4o: usd("gpt-4o", inputTokens, outputTokens) * 6.9,
  books100_mini_dkk: usd("gpt-4o-mini", inputTokens, outputTokens) * 6.9 * 100,
  books100_4o_dkk: usd("gpt-4o", inputTokens, outputTokens) * 6.9 * 100,
});
