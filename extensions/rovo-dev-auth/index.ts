import { execFileSync } from "node:child_process";
import {
  emptyPluginConfigSchema,
  type OpenClawPluginApi,
  type ProviderAuthContext,
  type ProviderAuthResult,
} from "openclaw/plugin-sdk/core";

const PROVIDER_ID = "rovo-dev";
const PROVIDER_LABEL = "Atlassian Rovo Dev";
const DEFAULT_MODEL_ID = "auto";
const DEFAULT_MODEL_REF = `${PROVIDER_ID}/${DEFAULT_MODEL_ID}`;
const DEFAULT_BASE_URL = "https://api.atlassian.com/rovo";
const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_TOKENS = 8_192;
const ROVO_DEV_CLI_API = "rovo-dev-cli";
const ROVO_DEV_CLI_COMMAND = "acli";

function buildModelDefinition(params: {
  id: string;
  name: string;
  input: Array<"text" | "image">;
  reasoning?: boolean;
  api?: string;
}) {
  return {
    id: params.id,
    name: params.name,
    reasoning: params.reasoning ?? true,
    input: params.input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  };
}

/**
 * Check whether the Rovo Dev CLI (`acli`) is available on the system PATH.
 */
function isAcliAvailable(): boolean {
  try {
    execFileSync(ROVO_DEV_CLI_COMMAND, ["--version"], {
      stdio: "ignore",
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

// ── Auth handler: CLI-based (primary) ───────────────────────────────────────

async function handleCliLogin(ctx: ProviderAuthContext): Promise<ProviderAuthResult> {
  if (!isAcliAvailable()) {
    throw new Error(
      [
        `The Rovo Dev CLI (${ROVO_DEV_CLI_COMMAND}) was not found on your PATH.`,
        "",
        "Install Rovo Dev CLI and authenticate first:",
        "  https://developer.atlassian.com/cloud/acli/guides/how-to-get-started/",
        "",
        "Then run this login command again.",
      ].join("\n"),
    );
  }

  const models = [
    buildModelDefinition({
      id: DEFAULT_MODEL_ID,
      name: "Rovo Dev Auto",
      input: ["text", "image"],
      reasoning: true,
    }),
  ];

  return {
    profiles: [
      {
        profileId: `${PROVIDER_ID}:cli`,
        credential: {
          type: "token",
          provider: PROVIDER_ID,
          token: "acli-local",
        },
      },
    ],
    configPatch: {
      models: {
        providers: {
          [PROVIDER_ID]: {
            baseUrl: DEFAULT_BASE_URL,
            api: ROVO_DEV_CLI_API,
            models,
          },
        },
      },
      agents: {
        defaults: {
          models: {
            [DEFAULT_MODEL_REF]: { alias: "Rovo Dev" },
          },
        },
      },
    },
    defaultModel: DEFAULT_MODEL_REF,
    notes: [
      `Rovo Dev CLI (${ROVO_DEV_CLI_COMMAND}) detected. Requests will be routed through the local CLI.`,
      "Make sure you have authenticated with: acli auth login",
      "Getting started: https://developer.atlassian.com/cloud/acli/guides/how-to-get-started/",
      "CLI commands: https://support.atlassian.com/rovo/docs/rovo-dev-cli-command",
    ],
  };
}

// ── Auth handler: API key (fallback) ────────────────────────────────────────

async function handleApiKeyLogin(ctx: ProviderAuthContext): Promise<ProviderAuthResult> {
  const key = String(
    await ctx.prompter.text({
      message: "Paste Rovo Dev API key",
      validate: (v: string) => (v?.trim() ? undefined : "Required"),
    }),
  ).trim();

  const models = [
    buildModelDefinition({
      id: DEFAULT_MODEL_ID,
      name: "Rovo Dev Auto",
      input: ["text", "image"],
      reasoning: true,
    }),
  ];

  return {
    profiles: [
      {
        profileId: `${PROVIDER_ID}:default`,
        credential: {
          type: "api_key",
          provider: PROVIDER_ID,
          key,
        },
      },
    ],
    configPatch: {
      models: {
        providers: {
          [PROVIDER_ID]: {
            baseUrl: DEFAULT_BASE_URL,
            apiKey: key,
            api: "openai-completions",
            models,
          },
        },
      },
      agents: {
        defaults: {
          models: {
            [DEFAULT_MODEL_REF]: { alias: "Rovo Dev" },
          },
        },
      },
    },
    defaultModel: DEFAULT_MODEL_REF,
    notes: [
      "Initial auth uses an API key. You can also set the ROVO_DEV_API_KEY environment variable.",
      "For Atlassian Rovo Dev CLI onboarding, see: https://support.atlassian.com/rovo/docs/rovo-dev-cli-command",
      "Getting started guide: https://developer.atlassian.com/cloud/acli/guides/how-to-get-started/",
    ],
  };
}

// ── Plugin definition ───────────────────────────────────────────────────────

const rovoDevPlugin = {
  id: "rovo-dev-auth",
  name: "Rovo Dev Auth",
  description: "Atlassian Rovo Dev provider via local CLI or API key",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerProvider({
      id: PROVIDER_ID,
      label: PROVIDER_LABEL,
      docsPath: "/providers/rovo-dev",
      aliases: ["rovo"],
      envVars: ["ROVO_DEV_API_KEY"],
      auth: [
        {
          id: "cli",
          label: "Rovo Dev CLI (acli)",
          hint: "Use the locally installed Rovo Dev CLI. Requires acli to be installed and authenticated.",
          kind: "custom",
          run: handleCliLogin,
        },
        {
          id: "api_key",
          label: "API key",
          hint: "Paste a Rovo Dev API key or set ROVO_DEV_API_KEY",
          kind: "api_key",
          run: handleApiKeyLogin,
        },
      ],
    });
  },
};

export default rovoDevPlugin;
