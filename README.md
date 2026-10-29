# pi-ultramarine

[Ultramarine](https://docs.paperinstruments.com/docs/ultramarine) (Paper Instruments) as a pi
model provider: one model, `ultramarine-1-flash`, OpenAI Chat Completions wire format.

The endpoint needs no custom streaming, so this package only registers the provider, the model
metadata, and the compatibility flags that match what the server accepts.

## Install

```bash
pi install ./pi-ultramarine                    # this checkout
pi install git:github.com/<you>/pi-ultramarine # after you push it
pi -e ./pi-ultramarine                         # try it without adding it to settings
```

## Set the key

Add funds on **Billing** at <https://platform.paperinstruments.com>, create a key on **API keys**,
then export it in the shell that starts pi:

```bash
export PAPERINSTRUMENTS_API_KEY="pi_live_..."
```

The key is read from the environment at request time, never stored in this repository or in
`auth.json`.

## Use

```bash
pi
/model      # "Ultramarine 1 Flash"
/thinking   # low | high | max
```

`off` is not available: the API refuses disabled thinking, so pi clamps it to the lowest
supported level.

## What is verified, and what is inferred

Verified against the live API on 2026-10-29:

| Behavior | Consequence |
|---|---|
| `developer` role, `store`, `metadata`, `service_tier` are rejected with `400` | `supportsDeveloperRole: false`, `supportsStore: false` |
| `reasoning_effort` accepts only `low`, `high`, `max`; effort cannot be disabled | `thinkingLevelMap` nulls `off` and `xhigh`, maps `medium` to `high` |
| Output is capped by `max_completion_tokens`; 65,536 recommended | `maxTokensField`, `maxTokens: 65536` |
| Usage arrives via `stream_options.include_usage`, cached input reported separately | pi's footer and `/session` cost are accurate |
| `prompt_cache_retention` is rejected with `invalid_request_error` | `supportsLongCacheRetention: false`, because pi otherwise assumes support for an unrecognised endpoint and sends the field |
| `x-session-id` gives sticky routing | `sessionAffinityFormat: "openrouter"`; a second turn came back ~72% cached input |
| Tool calls, streamed reasoning, and tool-result replay all round-trip | no compatibility workaround needed |

Inferred, not published:

- `contextWindow: 131072` comes from their recommended compaction window. If a long session
  returns an input-size `400`, lower it.
- `cost.cacheWrite` is set to the input rate; the API does not publish a separate write price.

Known rough edge: a `429 insufficient_quota` means the prepaid balance cannot cover the reserved
`maxTokens` ceiling. pi retries 429s, so it wastes a few seconds before failing. Lower `maxTokens`
(to 32768) if that happens.

## Their recommended configuration

Ultramarine publishes [Default Sampling Config](https://docs.paperinstruments.com/docs/ultramarine/default-sampling-config)
and [Prompt Tuning](https://docs.paperinstruments.com/docs/ultramarine/prompt-tuning). Where each
recommendation lives:

| Recommendation | Where it is set | Status |
|---|---|---|
| `temperature 1`, `top_p 0.95`, `top_k -1` | `samplingParams` in `index.ts` | matches |
| `max_completion_tokens` 65,536 | `maxTokens` in `index.ts` | matches |
| `reasoning_effort` default and recommended `max` | pi starts at `medium` (sent as `high`), so set a per-model startup level | needs `settings.json` |
| Compaction trigger at 101,072 of 131,072 tokens | pi triggers when free tokens drop below `reserveTokens` (default 16,384, i.e. 114,688 used) | needs `settings.json` |
| Keep the two most recent turns after compaction | pi keeps `keepRecentTokens` (default 20,000) instead of counting turns | approximates |
| Retune the prompt for concision and verbosity | not shipped; their snippets are for deliverables, not code comments | manual |

In `~/.pi/agent/settings.json`:

```json
{
  "modelThinkingLevels": { "ultramarine/ultramarine-1-flash": "max" },
  "compaction": { "modelOverrides": { "ultramarine/ultramarine-1-flash": { "reserveTokens": 30000 } } }
}
```

131,072 minus their 101,072 trigger is 30,000, which is why `reserveTokens` is that number. Raising
the startup level to `max` costs output tokens, since reasoning bills at the output rate; use
`low` per session with `/thinking` when a task does not need it.

Prompt tuning stays manual in the `models.json` form, which cannot modify the system prompt. Copy
the snippets you need from the Prompt Tuning page into `~/.pi/agent/APPEND_SYSTEM.md`; that file
applies to every model, so keep it there only if Ultramarine is your main model. The extension form
above scopes the same guidelines to `ultramarine` automatically.

Pi's `before_agent_start` handler appends three prompt-tuning guidelines, and only while the active
provider is `ultramarine`. They are the parts of [Prompt Tuning](https://docs.paperinstruments.com/docs/ultramarine/prompt-tuning)
that transfer to a coding agent: concision with completeness, the plain-prose rules (no em dash,
no middle dot, no semicolon between independent clauses, no signposting), and their stopping rule
(don't reopen unchanged files, rerun checks that passed, or add unrequested polish).

Disable it per run with:

```bash
ULTRAMARINE_PROMPT_TUNING=off pi
```

Not included: their visual-design and house-style sections. Those govern decks and documents, and
nothing in this package produces them.

## Without the extension

Same result as a `models.json` entry in `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "ultramarine": {
      "name": "Paper Instruments (Ultramarine)",
      "baseUrl": "https://api.paperinstruments.com/v1",
      "api": "openai-completions",
      "apiKey": "$PAPERINSTRUMENTS_API_KEY",
      "models": [
        {
          "id": "ultramarine-1-flash",
          "reasoning": true,
          "thinkingLevelMap": { "off": null, "minimal": "low", "low": "low", "medium": "high", "high": "high", "xhigh": null, "max": "max" },
          "input": ["text", "image"],
          "contextWindow": 131072,
          "maxTokens": 65536,
          "cost": { "input": 0.15, "output": 0.5, "cacheRead": 0.03, "cacheWrite": 0.15 },
          "samplingParams": { "temperature": 1, "top_p": 0.95, "top_k": -1 },
          "compat": {
            "supportsDeveloperRole": false,
            "supportsStore": false,
            "supportsReasoningEffort": true,
            "thinkingFormat": "openai",
            "maxTokensField": "max_completion_tokens",
            "supportsUsageInStreaming": true,
            "supportsLongCacheRetention": false,
            "sendSessionAffinityHeaders": true,
            "sessionAffinityFormat": "openrouter"
          }
        }
      ]
    }
  }
}
```

## Outside pi

Any OpenAI SDK reaches the same endpoint:

```python
from openai import OpenAI

client = OpenAI(base_url="https://api.paperinstruments.com/v1", api_key=os.environ["PAPERINSTRUMENTS_API_KEY"])
```

Send `reasoning_effort` (`low`/`high`/`max`) and `max_completion_tokens`; use the `system` role,
never `developer`. Current prices: <https://api.paperinstruments.com/v1/pricing>.
