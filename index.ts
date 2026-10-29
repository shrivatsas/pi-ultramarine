/**
 * Ultramarine provider for pi.
 *
 * Ultramarine is Paper Instruments' OpenAI-compatible model API. It needs no
 * custom streaming, so this extension only registers the endpoint, the model
 * metadata, and the compatibility flags that make pi's Chat Completions
 * implementation match what the server accepts.
 *
 * Usage:
 *   pi install ./pi-ultramarine
 *   export PAPERINSTRUMENTS_API_KEY="pi_live_..."
 *   pi   # then /model -> "Ultramarine 1 Flash"
 *
 * References:
 *   https://docs.paperinstruments.com/docs/ultramarine
 *   https://docs.paperinstruments.com/docs/ultramarine/chat-completions
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BASE_URL = "https://api.paperinstruments.com/v1";

/**
 * Read from the environment by pi at request time, so the key never lives in
 * this repository.
 */
const API_KEY = "$PAPERINSTRUMENTS_API_KEY";

/**
 * Verified against the live API (2026-10-29):
 *   developer role, store, metadata and service_tier are rejected with 400
 *   reasoning_effort accepts low | high | max, and thinking cannot be disabled
 *   output is capped with max_completion_tokens (65,536 recommended)
 *   streaming usage arrives through stream_options.include_usage
 *   x-session-id gives sticky routing, so cached input is reused across turns
 *   prompt_cache_retention is rejected with invalid_request_error, so long
 *     cache retention must stay off: pi auto-detects support as true for an
 *     endpoint it does not recognise and would send the field once a request
 *     falls in the long-retention tier
 */
const COMPAT = {
  supportsDeveloperRole: false,
  supportsStore: false,
  supportsReasoningEffort: true,
  thinkingFormat: "openai",
  maxTokensField: "max_completion_tokens",
  supportsUsageInStreaming: true,
  supportsLongCacheRetention: false,
  sendSessionAffinityHeaders: true,
  sessionAffinityFormat: "openrouter",
};

const MODELS = [
  {
    id: "ultramarine-1-flash",
    name: "Ultramarine 1 Flash",
    reasoning: true,
    // The server refuses disabled thinking and effort values outside
    // low/high/max, so unsupported levels are marked null and pi clamps them.
    thinkingLevelMap: {
      off: null,
      minimal: "low",
      low: "low",
      medium: "high",
      high: "high",
      xhigh: null,
      max: "max",
    },
    input: ["text", "image"],
    // Not published by the API; taken from their recommended 131,072-token
    // compaction window. Lower it if a long session returns an input-size 400.
    contextWindow: 131072,
    maxTokens: 65536,
    // https://docs.paperinstruments.com/docs/ultramarine/billing
    cost: { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0.15 },
    // Their recommended defaults.
    samplingParams: { temperature: 1, top_p: 0.95, top_k: -1 },
  },
];

/**
 * Ultramarine's prompt tuning, applied only while this provider is active.
 * Their guidance targets prose deliverables, so these are the parts that
 * transfer to a coding agent; see the README for the rest.
 * https://docs.paperinstruments.com/docs/ultramarine/prompt-tuning
 */
const PROMPT_TUNING = [
  "Be concise without losing completeness: write only what the reader needs, keep every requirement, condition, and open question, and cut restatement, filler, and unsolicited extras.",
  "Write plain professional prose: no em dash, no middle dot, no semicolon joining independent clauses, and no rhetorical questions or signposts such as \"it is worth noting that\".",
  "When the requested result is usable, stop: do not reopen unchanged files, rerun checks that already passed, or add polish the request did not ask for.",
];

export default function (pi: ExtensionAPI) {
  pi.registerProvider("ultramarine", {
    name: "Paper Instruments (Ultramarine)",
    baseUrl: BASE_URL,
    api: "openai-completions",
    apiKey: API_KEY,
    models: MODELS.map((model) => ({
      type: "chat" as const,
      ...model,
      compat: COMPAT,
    })),
  });

  pi.on("before_agent_start", (event, ctx) => {
    if (ctx.model?.provider !== "ultramarine") return;
    if (process.env.ULTRAMARINE_PROMPT_TUNING === "off") return;

    const guidelines = event.systemPromptOptions.promptGuidelines;
    // The options object outlives a turn, so add the bullets once per session.
    if (guidelines.includes(PROMPT_TUNING[0])) return;
    guidelines.push(...PROMPT_TUNING);
  });
}
