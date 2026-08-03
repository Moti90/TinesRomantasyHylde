import { readFileSync, writeFileSync, existsSync } from "fs";
import { dataPath } from "./paths.js";

const configPath = dataPath("config.json");

function readConfig() {
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(cfg) {
  writeFileSync(configPath, JSON.stringify(cfg, null, 2), "utf8");
}

function maskKey(key) {
  if (!key) return null;
  if (key.length <= 12) return "••••••••";
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

export function getOpenAIKey() {
  const fromFile = readConfig().openaiApiKey?.trim();
  if (fromFile) return fromFile;
  return process.env.OPENAI_API_KEY?.trim() || "";
}

export function hasOpenAIKey() {
  return Boolean(getOpenAIKey());
}

export function getOpenAIStatus() {
  const key = getOpenAIKey();
  if (!key) return { configured: false, masked: null, source: null };
  const fromFile = Boolean(readConfig().openaiApiKey?.trim());
  return {
    configured: true,
    masked: maskKey(key),
    source: fromFile ? "app" : "env",
  };
}

export function setOpenAIKey(key) {
  const cfg = readConfig();
  const trimmed = String(key || "").trim();
  if (!trimmed) delete cfg.openaiApiKey;
  else cfg.openaiApiKey = trimmed;
  writeConfig(cfg);
  if (trimmed) process.env.OPENAI_API_KEY = trimmed;
  else delete process.env.OPENAI_API_KEY;
  return getOpenAIStatus();
}

export function getGeminiKey() {
  const fromFile = readConfig().geminiApiKey?.trim();
  if (fromFile) return fromFile;
  return process.env.GEMINI_API_KEY?.trim() || "";
}

export function hasGeminiKey() {
  return Boolean(getGeminiKey());
}

export function getGeminiStatus() {
  const key = getGeminiKey();
  if (!key) {
    return { configured: false, masked: null, source: null };
  }
  const fromFile = Boolean(readConfig().geminiApiKey?.trim());
  return {
    configured: true,
    masked: maskKey(key),
    source: fromFile ? "app" : "env",
  };
}

export function setGeminiKey(key) {
  const cfg = readConfig();
  const trimmed = String(key || "").trim();
  if (!trimmed) {
    delete cfg.geminiApiKey;
  } else {
    cfg.geminiApiKey = trimmed;
  }
  writeConfig(cfg);
  if (trimmed) process.env.GEMINI_API_KEY = trimmed;
  else delete process.env.GEMINI_API_KEY;
  return getGeminiStatus();
}

/** Aktiv AI-provider: openai > gemini > none */
export function getAiProvider() {
  if (hasOpenAIKey()) return "openai";
  if (hasGeminiKey()) return "gemini";
  return null;
}

export function getAiStatus() {
  const provider = getAiProvider();
  if (provider === "openai") {
    return { provider, ...getOpenAIStatus() };
  }
  if (provider === "gemini") {
    return { provider, ...getGeminiStatus() };
  }
  return { provider: null, configured: false, masked: null, source: null };
}
