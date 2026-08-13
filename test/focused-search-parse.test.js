import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  inferSeriesRomanticLeads,
  resolveFocusedSearchOutput,
  runFocusedSearch,
  tryParseFocusedSearchText,
} from "../server/services/webResearch.js";
import { ANALYSIS_MODEL, estimateCostUsd } from "../server/services/versions.js";

function mockSearchResponse({ text, urls = [] }) {
  return {
    output_text: text,
    usage: { input_tokens: 80, output_tokens: 40 },
    output: [
      {
        type: "web_search_call",
        action: {
          sources: urls.map((url) => ({ url })),
        },
      },
      {
        type: "message",
        content: [{ type: "output_text", text }],
      },
    ],
  };
}

describe("focused search output contract", () => {
  it("parses structured identity JSON without repair", async () => {
    const text = JSON.stringify({
      pairing: {
        fmc: "Lysa",
        mmc: "Bram",
        confidence: "high",
        basis: ["later-series central pairing"],
        alternatives: [{ name: "Aric", role: "early_love_interest" }],
      },
      findings: [
        {
          url: "https://wiki.example.com/ember/romance",
          title: "Romance",
          summary: "Later books establish Bram as endgame.",
          type: "blog",
        },
      ],
    });
    const resolved = await resolveFocusedSearchOutput({
      text,
      rawUrls: [{ url: "https://wiki.example.com/ember/romance" }],
      purpose: "identity",
      repair: async () => {
        throw new Error("repair should not run");
      },
    });
    assert.equal(resolved.parseStatus, "structured");
    assert.equal(resolved.retryUsed, false);
    assert.equal(resolved.pairing.mmc, "Bram");
    assert.equal(resolved.findings.length, 1);
  });

  it("malformed JSON uses json_fallback then one repair", async () => {
    let repairs = 0;
    const resolved = await resolveFocusedSearchOutput({
      text: 'Here is the result:\n{ "findings": [{ "url": "https://blog.example.com/x", "title": "X", "summary": "Later books", "type": "blog" }',
      rawUrls: [{ url: "https://blog.example.com/x" }],
      purpose: "field",
      repair: async () => {
        repairs += 1;
        return {
          text: JSON.stringify({
            findings: [
              {
                url: "https://blog.example.com/x",
                title: "X",
                summary: "Later books mention the hero.",
                type: "blog",
              },
            ],
          }),
          inputTokens: 20,
          outputTokens: 10,
        };
      },
    });
    assert.equal(repairs, 1);
    assert.equal(resolved.parseStatus, "repaired");
    assert.equal(resolved.retryUsed, true);
    assert.equal(resolved.findings.length, 1);
    assert.equal(resolved.retryInputTokens, 20);
  });

  it("prose identity output can be repaired into structured pairing", async () => {
    let repairs = 0;
    const prose = `I reviewed the sources from the web search.
The central romantic pairing appears to be Bram and Heroine Lysa across later books.
Aric is only an early love interest.`;
    const resolved = await resolveFocusedSearchOutput({
      text: prose,
      rawUrls: [{ url: "https://fandom.example.com/ember" }],
      purpose: "identity",
      repair: async ({ text }) => {
        repairs += 1;
        assert.match(text, /central romantic pairing appears to be Bram/);
        return {
          text: JSON.stringify({
            pairing: {
              fmc: "Lysa",
              mmc: "Bram",
              confidence: "high",
              basis: ["later-series central pairing"],
              alternatives: [{ name: "Aric", role: "early_love_interest" }],
            },
            findings: [],
          }),
          inputTokens: 30,
          outputTokens: 12,
        };
      },
    });
    assert.equal(repairs, 1);
    assert.equal(resolved.parseStatus, "repaired");
    assert.equal(resolved.pairing.mmc, "Bram");
  });

  it("retry is used at most once even if repair is still prose", async () => {
    let repairs = 0;
    const resolved = await resolveFocusedSearchOutput({
      text: "I reviewed the sources and the pairing is unclear.",
      rawUrls: [{ url: "https://wiki.example.com/ember" }],
      purpose: "identity",
      repair: async () => {
        repairs += 1;
        return { text: "Still not JSON.", inputTokens: 5, outputTokens: 5 };
      },
    });
    assert.equal(repairs, 1);
    assert.equal(resolved.retryUsed, true);
    assert.equal(resolved.parseStatus, "raw_only");
    assert.equal(resolved.findings.length, 0);
    assert.equal(resolved.pairing, null);
  });

  it("total parse failure is safe and keeps findings empty", async () => {
    const resolved = await resolveFocusedSearchOutput({
      text: "No usable output.",
      rawUrls: [{ url: "https://wiki.example.com/ember" }],
      purpose: "identity",
      repair: async () => ({ text: "still prose", inputTokens: 1, outputTokens: 1 }),
    });
    assert.equal(resolved.parseStatus, "raw_only");
    assert.deepEqual(resolved.findings, []);
  });

  it("runFocusedSearch preserves raw URLs when model returns prose", async () => {
    let createCalls = 0;
    let repairCalls = 0;
    const raw = "https://bookriot.com/ember-cycle-hero-review";
    const client = {
      responses: {
        create: async () => {
          createCalls += 1;
          return mockSearchResponse({
            text: "I found several reviews but here is a summary in prose.",
            urls: [raw],
          });
        },
      },
      chat: {
        completions: {
          create: async () => {
            repairCalls += 1;
            return {
              choices: [{ message: { content: "still prose, sorry" } }],
              usage: { prompt_tokens: 40, completion_tokens: 8 },
            };
          },
        },
      },
    };

    const result = await runFocusedSearch(client, {
      id: "field-r1-1",
      focus: "helteprofil",
      userPrompt: "Find hero evidence.",
      batch: "helteprofil",
      purpose: "field",
    });

    assert.equal(createCalls, 1);
    assert.equal(repairCalls, 1);
    assert.equal(result.retryUsed, true);
    assert.ok(["raw_only", "failed"].includes(result.parseStatus));
    assert.ok(result.rawUrls.some((u) => u.url === raw));
    assert.equal(result.retryInputTokens, 40);
    assert.equal(result.retryOutputTokens, 8);
    assert.equal(
      result.retryCostUsd,
      Math.round(estimateCostUsd(ANALYSIS_MODEL, 40, 8) * 1e6) / 1e6
    );
    assert.ok(result.retryCostUsd > 0);
    const invented = (result.findings || []).some((f) =>
      /bodyguard|touch her and die|protective/i.test(f.summary || "")
    );
    assert.equal(invented, false);
  });

  it("identityHint from structured pairing is enough for series MMC B", () => {
    const inferred = inferSeriesRomanticLeads({
      identityHint: {
        fmc: "Lysa",
        mmc: "Bram",
        confidence: "high",
        basis: ["later-series central pairing"],
        alternatives: [{ name: "Aric", role: "early_love_interest" }],
      },
      sources: [
        {
          title: "Book 1 blurb",
          summary: "Book 1: romance between Lysa and Aric. Aric is the male love interest in the first book.",
        },
      ],
    });
    assert.equal(inferred.mmc, "Bram");
    assert.equal(inferred.fmc, "Lysa");
    assert.ok(inferred.mmcEndgame || inferred.basis.includes("endgame_partner") || inferred.basis.includes("central_pairing"));
  });

  it("tryParseFocusedSearchText does not treat prose as ok", () => {
    const parsed = tryParseFocusedSearchText(
      "I reviewed the sources. The pairing appears to be Bram and Lysa.",
      { purpose: "identity" }
    );
    assert.equal(parsed.ok, false);
  });
});
