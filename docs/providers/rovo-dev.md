---
summary: "Use Atlassian Rovo Dev as an AI model provider via the local CLI"
read_when:
  - Setting up Atlassian Rovo Dev
  - Using acli rovodev CLI with OpenClaw
  - Configuring a CLI-based model provider
title: "Rovo Dev"
---

# Rovo Dev

[Atlassian Rovo Dev](https://developer.atlassian.com/cloud/acli/guides/how-to-get-started/) is an AI-powered development tool from Atlassian that runs locally via the `acli` CLI.

OpenClaw integrates with Rovo Dev by executing `acli rovodev run` as a local process, so your prompts never leave your machine until the CLI forwards them to Atlassian's backend.

## Prerequisites

1. **Install the Rovo Dev CLI** (`acli`) following the [official getting started guide](https://developer.atlassian.com/cloud/acli/guides/how-to-get-started/)
2. **Authenticate** by running:

```bash
acli auth login
```

3. Verify the CLI works:

```bash
acli rovodev run "Hello, are you there?"
```

## Quick start

Once `acli` is installed and authenticated, connect it to OpenClaw:

```bash
openclaw models auth login --provider rovo-dev --auth-choice cli
```

Then set it as your default model:

```bash
openclaw models default rovo-dev/auto
```

That is it. OpenClaw will now route agent prompts through `acli rovodev run`.

## Authentication options

### Option A: Rovo Dev CLI (recommended)

This is the primary method. It requires the `acli` binary to be installed and authenticated on the same machine as OpenClaw.

```bash
openclaw models auth login --provider rovo-dev --auth-choice cli
```

OpenClaw will verify that `acli` is on your PATH and configure the provider automatically.

### Option B: API key

If you have a Rovo Dev API key, you can use it directly:

```bash
openclaw models auth login --provider rovo-dev --auth-choice api_key
```

Or set the environment variable:

```bash
export ROVO_DEV_API_KEY="your-api-key"
```

## Configuration

After authentication, your config will look like this:

```json5
// ~/.openclaw/config.json
{
  models: {
    providers: {
      "rovo-dev": {
        api: "rovo-dev-cli",   // CLI-based execution
        models: [
          {
            id: "auto",
            name: "Rovo Dev Auto",
            reasoning: true,
            input: ["text", "image"],
            contextWindow: 200000,
            maxTokens: 8192,
          },
        ],
      },
    },
  },
}
```

## How it works

When you send a message, OpenClaw:

1. Builds the instruction from your conversation context
2. Spawns `acli rovodev run [instruction]` as a child process
3. Captures stdout as the assistant response
4. Returns the response through the normal agent pipeline

No HTTP API calls are made by OpenClaw itself; the `acli` binary handles all communication with Atlassian's backend.

## CLI command reference

For the full list of `acli rovodev` commands, see the [Rovo Dev CLI command reference](https://support.atlassian.com/rovo/docs/rovo-dev-cli-command).

## Notes

- The provider ID is `rovo-dev` (alias: `rovo`)
- The default model is `rovo-dev/auto`
- The CLI must be authenticated before use (`acli auth login`)
- Requests are executed locally; the `acli` process handles backend communication
- Cost tracking shows zero because billing is managed by your Atlassian subscription
- Supports text input; image support depends on the underlying model selected by Rovo Dev
