import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createHash, randomUUID } from "node:crypto";
import type { CapabilityArtifact, DiscoveryRequest } from "./contracts.js";
import { discoverCapability } from "./discovery.js";
import { createDemoServer } from "./demo-app/server.js";
import { EvidenceWriter } from "./evidence.js";
import type { InterventionRequest, Operator } from "./intervention.js";
import {
  createDiscoveryModelClient,
  type DiscoveryTransport,
} from "./model-client.js";
import { createDefaultPolicy } from "./policy.js";
import { replayCapability } from "./replay.js";
import { PlaywrightSurfaceSession } from "./surface.js";

const DEFAULT_ALLOWED_ORIGIN = "http://127.0.0.1:4317";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function configuredAllowedOrigin(): string {
  const value =
    flag("--allowed-origin") ??
    process.env.AUTOMATION_ALLOWED_ORIGIN ??
    DEFAULT_ALLOWED_ORIGIN;
  return new URL(value).origin;
}

function configuredMaxRunMs(): number | undefined {
  const value = flag("--max-run-ms");
  if (value === undefined) return undefined;
  const maxRunMs = Number(value);
  if (!Number.isInteger(maxRunMs) || maxRunMs <= 0) {
    throw new Error("--max-run-ms must be a positive integer");
  }
  return maxRunMs;
}

async function jsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(path.resolve(filePath), "utf8"));
}

async function artifactFile(filePath: string): Promise<{
  artifact: unknown;
  sha256: string;
}> {
  const content = await readFile(path.resolve(filePath), "utf8");
  return {
    artifact: JSON.parse(content),
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function repositoryRelativeSource(filePath: string): string {
  const absolute = path.resolve(filePath);
  const relative = path.relative(process.cwd(), absolute);
  return relative.startsWith("..") || path.isAbsolute(relative)
    ? path.basename(absolute)
    : relative.split(path.sep).join(path.posix.sep);
}

function sensitiveContext(
  fields: Record<string, { sensitive?: boolean | undefined; value?: unknown }>,
): { names: Set<string>; values: Set<string> } {
  const names = new Set<string>();
  const values = new Set<string>();
  for (const [name, definition] of Object.entries(fields)) {
    if (definition.sensitive) {
      names.add(name);
      if (definition.value !== undefined) values.add(String(definition.value));
    }
  }
  return { names, values };
}

class ManualCliOperator implements Operator {
  public readonly executionKind = "person-operated-cli" as const;
  private readonly prompt = createInterface({ input: stdin, output: stdout });

  public async takeControl(
    request: InterventionRequest,
    _signal: AbortSignal,
  ): Promise<void> {
    stdout.write(
      `\nHuman intervention requested: ${request.reason}\nUse the existing browser window; do not open a new session.\n`,
    );
  }

  public async performManualAction(signal: AbortSignal): Promise<string> {
    try {
      const action = (
        await this.prompt.question(
          'Complete the action in the live page, then describe the control you used without IDs or values (for example, Clicked "Supervisor verified"): ',
          { signal },
        )
      )
        .replace(/\s+/g, " ")
        .trim();
      if (action.length < 3 || action.length > 160) {
        throw new Error(
          "Manual action description must contain 3 to 160 characters",
        );
      }
      return action;
    } catch (error) {
      this.prompt.close();
      throw error;
    }
  }

  public async returnControl(_signal: AbortSignal): Promise<void> {
    this.prompt.close();
  }
}

async function demoApp(): Promise<void> {
  const port = Number(flag("--port") ?? 4317);
  const demo = await createDemoServer(port);
  stdout.write(`Synthetic Credit Union listening at ${demo.origin}\n`);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await demo.close();
}

async function replay(): Promise<void> {
  const artifactPath = flag("--artifact");
  const inputsPath = flag("--inputs");
  if (!artifactPath || !inputsPath) {
    throw new Error("replay requires --artifact <path> and --inputs <path>");
  }
  const persistedArtifact = await artifactFile(artifactPath);
  const artifact = persistedArtifact.artifact as CapabilityArtifact;
  const inputs = (await jsonFile(inputsPath)) as Record<string, unknown>;
  const sensitiveNames = new Set(
    Object.entries(artifact.inputSchema)
      .filter(([, definition]) => definition.sensitive)
      .map(([name]) => name),
  );
  const sensitiveValues = new Set(
    [...sensitiveNames]
      .map((name) => inputs[name])
      .filter((value) => value !== undefined)
      .map(String),
  );
  const runId = `replay-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const evidence = new EvidenceWriter(
    process.cwd(),
    runId,
    sensitiveNames,
    sensitiveValues,
  );
  const maxRunMs = configuredMaxRunMs();
  const policy = createDefaultPolicy(configuredAllowedOrigin(), {
    ...(maxRunMs === undefined ? {} : { maxRunMs }),
    sensitiveInputNames: sensitiveNames,
  });
  const surface = new PlaywrightSurfaceSession(evidence, policy, {
    headed: hasFlag("--headed"),
  });
  const result = await replayCapability({
    artifact,
    inputs,
    policy,
    surface,
    evidence,
    artifactSource: repositoryRelativeSource(artifactPath),
    artifactSha256: persistedArtifact.sha256,
    ...(hasFlag("--operator") ? { operator: new ManualCliOperator() } : {}),
  });
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === "failure") process.exitCode = 1;
}

async function discover(): Promise<void> {
  const requestPath = flag("--request");
  if (!requestPath) throw new Error("discover requires --request <path>");
  const transport = flag("--transport") ?? "openai";
  if (
    transport !== "openai" &&
    transport !== "codex" &&
    transport !== "claude-code"
  ) {
    throw new Error(
      "discover --transport must be one of: openai, codex, claude-code",
    );
  }
  const request = (await jsonFile(requestPath)) as DiscoveryRequest;
  const context = sensitiveContext(request.inputs);
  const runId = `discovery-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const evidence = new EvidenceWriter(
    process.cwd(),
    runId,
    context.names,
    context.values,
  );
  const maxRunMs = configuredMaxRunMs();
  const policy = createDefaultPolicy(configuredAllowedOrigin(), {
    ...(maxRunMs === undefined ? {} : { maxRunMs }),
    sensitiveInputNames: context.names,
  });
  const surface = new PlaywrightSurfaceSession(evidence, policy, {
    headed: hasFlag("--headed"),
  });
  const result = await discoverCapability({
    request,
    model: createDiscoveryModelClient(
      transport as DiscoveryTransport,
      flag("--model"),
    ),
    surface,
    policy,
    evidence,
    ...(hasFlag("--operator") ? { operator: new ManualCliOperator() } : {}),
  });
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "success") process.exitCode = 1;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  switch (command) {
    case "demo:app":
      await demoApp();
      break;
    case "replay":
      await replay();
      break;
    case "discover":
      await discover();
      break;
    default:
      throw new Error("Usage: tsx src/cli.ts <demo:app|discover|replay>");
  }
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown CLI error";
  process.stderr.write(`${JSON.stringify({ status: "error", message })}\n`);
  process.exitCode = 1;
});
