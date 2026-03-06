export const ROVO_DEV_BASE_URL = "https://api.atlassian.com/rovo";
export const ROVO_DEV_DEFAULT_MODEL_ID = "auto";
export const ROVO_DEV_DEFAULT_MODEL_REF = `rovo-dev/${ROVO_DEV_DEFAULT_MODEL_ID}`;
export const ROVO_DEV_CLI_API = "rovo-dev-cli";
export const ROVO_DEV_CLI_COMMAND = "acli";

export type RovoDevModelCatalogEntry = {
  id: string;
  name: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
  contextWindow?: number;
  maxTokens?: number;
};

export const ROVO_DEV_MODEL_CATALOG: RovoDevModelCatalogEntry[] = [
  {
    id: ROVO_DEV_DEFAULT_MODEL_ID,
    name: "Rovo Dev Auto",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 8_192,
  },
];

export const ROVO_DEV_DEFAULT_CONTEXT_WINDOW = 200_000;
export const ROVO_DEV_DEFAULT_MAX_TOKENS = 8_192;
export const ROVO_DEV_DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
} as const;
