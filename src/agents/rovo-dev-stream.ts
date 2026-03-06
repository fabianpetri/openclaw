import { spawn } from "node:child_process";
import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, StopReason, TextContent } from "@mariozechner/pi-ai";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  buildAssistantMessage as buildStreamAssistantMessage,
  buildStreamErrorAssistantMessage,
  buildUsageWithNoCost,
} from "./stream-message-shared.js";

const log = createSubsystemLogger("rovo-dev-stream");

// ── Constants ───────────────────────────────────────────────────────────────

export const ROVO_DEV_CLI_COMMAND = "acli";
export const ROVO_DEV_CLI_API = "rovo-dev-cli";

// ── Message extraction ──────────────────────────────────────────────────────

type InputContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string };

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return (content as InputContentPart[])
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

/**
 * Build the user instruction from the agent context.
 *
 * The last user message is used as the instruction passed to
 * `acli rovodev run <instruction>`.  When the conversation contains a system
 * prompt it is prepended so Rovo Dev receives the full context.
 */
function buildCliInstruction(context: {
  systemPrompt?: string;
  messages?: Array<{ role: string; content: unknown }>;
}): string {
  const parts: string[] = [];

  if (context.systemPrompt) {
    parts.push(context.systemPrompt);
  }

  const messages = context.messages ?? [];
  for (const msg of messages) {
    const text = extractTextContent(msg.content);
    if (!text) {
      continue;
    }
    if (msg.role === "user") {
      parts.push(text);
    } else if (msg.role === "assistant") {
      parts.push(`[Assistant]: ${text}`);
    }
  }

  return parts.join("\n\n");
}

// ── Main StreamFn factory ───────────────────────────────────────────────────

export function createRovoDevStreamFn(): StreamFn {
  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();

    const run = async () => {
      try {
        const instruction = buildCliInstruction(context);
        if (!instruction.trim()) {
          throw new Error("Rovo Dev: empty instruction – nothing to send");
        }

        log.debug(
          `spawning ${ROVO_DEV_CLI_COMMAND} rovodev run (instruction length: ${instruction.length})`,
        );

        const output = await spawnRovoDevCli(instruction, options?.signal);

        const content: TextContent[] = output.trim()
          ? [{ type: "text" as const, text: output.trim() }]
          : [];

        const stopReason: StopReason = "stop";

        const assistantMessage = buildStreamAssistantMessage({
          model: { api: model.api, provider: model.provider, id: model.id },
          content,
          stopReason,
          usage: buildUsageWithNoCost({}),
        });

        stream.push({
          type: "done",
          reason: stopReason,
          message: assistantMessage,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        log.warn(`Rovo Dev CLI error: ${errorMessage}`);
        stream.push({
          type: "error",
          reason: "error",
          error: buildStreamErrorAssistantMessage({
            model,
            errorMessage,
          }),
        });
      } finally {
        stream.end();
      }
    };

    queueMicrotask(() => void run());
    return stream;
  };
}

// ── CLI process spawning ────────────────────────────────────────────────────

function spawnRovoDevCli(
  instruction: string,
  signal?: AbortSignal | null,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Security: use argv-based invocation, never shell: true
    const child = spawn(ROVO_DEV_CLI_COMMAND, ["rovodev", "run", instruction], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      // Never enable shell to prevent injection
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            `Rovo Dev CLI not found. Install it first: https://developer.atlassian.com/cloud/acli/guides/how-to-get-started/`,
          ),
        );
        return;
      }
      reject(new Error(`Rovo Dev CLI spawn error: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        const detail = stderr.trim() || `exit code ${code}`;
        reject(
          new Error(
            `Rovo Dev CLI failed (exit ${code}): ${detail}`,
          ),
        );
        return;
      }
      resolve(stdout);
    });

    // Abort signal support: kill child process when the agent run is cancelled
    if (signal) {
      if (signal.aborted) {
        child.kill("SIGTERM");
        reject(new Error("Rovo Dev CLI aborted"));
        return;
      }
      const onAbort = () => {
        child.kill("SIGTERM");
        reject(new Error("Rovo Dev CLI aborted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      child.on("close", () => signal.removeEventListener("abort", onAbort));
    }
  });
}
