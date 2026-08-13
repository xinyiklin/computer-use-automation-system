import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { randomUUID } from "node:crypto";
import type { CapabilityArtifact, DiscoveryRequest } from "./contracts.js";
import { discoverCapability } from "./discovery.js";
import { createDemoServer } from "./demo-app/server.js";
import { EvidenceWriter } from "./evidence.js";
import type { InterventionRequest, Operator } from "./intervention.js";
import { OpenAIModelClient } from "./model-client.js";
import { createDefaultPolicy } from "./policy.js";
import { replayCapability } from "./replay.js";
import { PlaywrightSurfaceSession } from "./surface.js";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function jsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(path.resolve(filePath), "utf8"));
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
  private readonly prompt = createInterface({ input: stdin, output: stdout });

  public async takeControl(request: InterventionRequest): Promise<void> {
    stdout.write(
      `\nHuman intervention requested: ${request.reason}\nUse the existing browser window; do not open a new session.\n`,
    );
  }

  public async performManualAction(): Promise<string> {
    await this.prompt.question(
      "Complete the supervisor verification in the live page, then press Enter here: ",
    );
    return "Operator completed the requested live-session verification; values were not recorded.";
  }

  public async returnControl(): Promise<void> {
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
  const artifact = (await jsonFile(artifactPath)) as CapabilityArtifact;
  const inputs = (await jsonFile(inputsPath)) as Record<string, unknown>;
  const origin = artifact.compatibility.allowedOrigins[0];
  if (!origin) throw new Error("Artifact has no allowed origin");
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
  const policy = createDefaultPolicy(origin);
  const surface = new PlaywrightSurfaceSession(evidence, policy, {
    headed: hasFlag("--headed"),
  });
  const result = await replayCapability({
    artifact,
    inputs,
    policy,
    surface,
    evidence,
    ...(hasFlag("--operator") ? { operator: new ManualCliOperator() } : {}),
  });
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === "failure") process.exitCode = 1;
}

async function discover(): Promise<void> {
  const requestPath = flag("--request");
  if (!requestPath) throw new Error("discover requires --request <path>");
  const request = (await jsonFile(requestPath)) as DiscoveryRequest;
  const context = sensitiveContext(request.inputs);
  const runId = `discovery-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const evidence = new EvidenceWriter(
    process.cwd(),
    runId,
    context.names,
    context.values,
  );
  const policy = createDefaultPolicy(new URL(request.target.entryUrl).origin);
  const surface = new PlaywrightSurfaceSession(evidence, policy, {
    headed: hasFlag("--headed"),
  });
  const result = await discoverCapability({
    request,
    model: new OpenAIModelClient(flag("--model") ?? "gpt-5.6-sol"),
    surface,
    policy,
    evidence,
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
