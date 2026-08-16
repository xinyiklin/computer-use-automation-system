import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { toJSONSchema } from "zod";
import type {
  AgentProposal,
  DiscoveryRequest,
  Observation,
} from "./contracts.js";
import { AgentProposalSchema } from "./contracts.js";
import { sanitizePersisted } from "./evidence.js";
import { sensitiveValueRepresentations } from "./sensitive-values.js";

export interface CommandResult {
  exitCode: number | null;
  signal?: NodeJS.Signals;
  processId?: number;
  stdout: string;
  stderr: string;
}

export interface CommandInvocation {
  command: string;
  args: string[];
  stdin: string;
  timeoutMs: number;
  signal: AbortSignal;
  workingDirectory?: string;
}

export type CommandRunner = (
  invocation: CommandInvocation,
) => Promise<CommandResult>;

const TRANSPORT_ENVIRONMENT_KEYS = [
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "USER",
] as const;

export function discoveryTransportEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    TRANSPORT_ENVIRONMENT_KEYS.flatMap((key) =>
      source[key] === undefined ? [] : [[key, source[key]]],
    ),
  );
}

export interface CliModelOptions {
  command?: string;
  timeoutMs?: number;
  run?: CommandRunner;
}

export interface ModelClient {
  readonly modelIdentifier: string;
  readonly transport:
    | "openai-responses"
    | "codex-cli"
    | "claude-code-cli"
    | "scripted-test-double";
  readonly executionKind: "external" | "test-double";
  propose(input: {
    request: DiscoveryRequest;
    observation: Observation;
    priorSteps: Array<{ id: string; kind: string; result: string }>;
    remainingSteps: number;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<ModelProposalResult>;
}

export interface ModelExecutionMetadata {
  transport: ModelClient["transport"];
  modelIdentifier: string;
  executionKind: "external" | "test-double";
  adapterImplementation: string;
  runnerKind: "provider-sdk" | "builtin-process" | "injected" | "scripted";
}

const trustedModelMetadata = new WeakMap<object, ModelExecutionMetadata>();

function registerModelMetadata(
  client: ModelClient,
  metadata: ModelExecutionMetadata,
): void {
  trustedModelMetadata.set(client, metadata);
}

export function modelExecutionMetadata(
  client: ModelClient,
): ModelExecutionMetadata {
  const trusted = trustedModelMetadata.get(client);
  if (trusted) return { ...trusted };
  return {
    transport: client.transport,
    modelIdentifier: client.modelIdentifier,
    executionKind: "test-double",
    adapterImplementation: "unregistered-model-client",
    runnerKind: "injected",
  };
}

export type ModelTransportReceipt =
  | {
      kind: "cli-process";
      exitCode: number;
      signal?: NodeJS.Signals;
      outputSource: "schema-output-file" | "stdout";
      schemaValidated: true;
      processId?: number;
      executable: string;
      argumentSha256: string;
      stdinSha256: string;
    }
  | {
      kind: "openai-response";
      responseId: string;
      responseStatus: string;
      schemaValidated: true;
    }
  | {
      kind: "scripted-test-double";
      fixtureIndex: number;
      schemaValidated: true;
    };

export interface ModelProposalResult {
  proposal: AgentProposal;
  receipt: ModelTransportReceipt;
}

export function assertTransportReceiptMatchesExecution(
  metadata: ModelExecutionMetadata,
  receipt: ModelTransportReceipt,
): void {
  const expectedKind =
    metadata.transport === "openai-responses"
      ? "openai-response"
      : metadata.transport === "scripted-test-double"
        ? "scripted-test-double"
        : "cli-process";
  if (receipt.kind !== expectedKind) {
    throw new Error(
      "Discovery transport receipt does not match the registered adapter",
    );
  }
  if (
    metadata.executionKind === "external" &&
    receipt.kind === "cli-process" &&
    (receipt.processId === undefined ||
      receipt.executable.length === 0 ||
      receipt.argumentSha256.length !== 64 ||
      receipt.stdinSha256.length !== 64)
  ) {
    throw new Error(
      "External CLI discovery receipt lacks concrete process attestation",
    );
  }
}

function discoveryInstructions(): string {
  return [
    "You are discovering one reusable UI capability on a synthetic credit-union app.",
    "Return exactly one structured proposal. Do not provide hidden reasoning or prose outside the schema.",
    "Use only navigate, click, fill, select, read, waitFor, or assert actions.",
    "Reference invocation data with {kind:'input', name:'...'}; never copy sensitive values into an action literal.",
    "Prefer exact accessible roles and labels, with CSS only as a fallback. Every target must explain locator robustness and require cardinality 1.",
    "Treat observed semantic roles and regions as authoritative; visual styling does not change a control's role.",
    "Checkpoints are evaluated after the proposed action: after a click or navigation, checkpoint the resulting URL or visible landmark, not a field value that existed before the action.",
    "Never guess a future page heading or text from workflow navigation. For a click that may navigate, omit the checkpoint and let the next observation verify the resulting state unless the outcome is already certain.",
    "For page-state checkpoints, prefer the URL or a landmark in region=main; do not treat persistent navigation or header text as the current page state.",
    "Keep completion success conditions minimal and directly resolvable from observed semantic controls. Prefer stable routes and accessible headings; do not add redundant prose conditions. If exact text is necessary, preserve the observed punctuation exactly.",
    "A relative locator elementHint must be a valid CSS selector such as td, th, input, or button, never prose such as 'table cell'.",
    "Scalar output bindings must locate one bounded leaf field or value independently of the observed value. Use only label or relative candidates; never use role, text, CSS, or coordinates. A label candidate means an actual form label, not visible table text. Relative output locators require a leaf elementHint such as td, dd, input, output, span, strong, or code.",
    "Every step, locator, checkpoint, success condition, and output binding must remain reusable with different invocation inputs. Never copy a current input value or a dynamic record identifier into the artifact. For URL success checks, match a stable route shape or suffix instead of the current URL verbatim.",
    "Risk classes: safe for reads/navigation, reversible for fields, review_only for reaching review. Never propose irreversible, credential, or external navigation.",
    "The goal is complete only at the review screen before final confirmation. Never click Confirm account creation.",
    "On completion, provide declarative success conditions and output bindings that match the requested output names.",
    "If the safe next action is unclear, return stuck with a declarative resumeCondition that a human can satisfy and the system can verify in this same live session.",
  ].join("\n");
}

export type DiscoveryModelInput = {
  request: DiscoveryRequest;
  observation: Observation;
  priorSteps: Array<{ id: string; kind: string; result: string }>;
  remainingSteps: number;
  timeoutMs: number;
};

function sensitiveRequestValues(request: DiscoveryRequest): Set<string> {
  return new Set(
    Object.values(request.inputs)
      .filter((definition) => definition.sensitive)
      .flatMap((definition) =>
        sensitiveValueRepresentations(
          definition.value as string | number | boolean,
        ),
      ),
  );
}

function sensitiveRequestNames(request: DiscoveryRequest): Set<string> {
  return new Set(
    Object.entries(request.inputs)
      .filter(([, definition]) => definition.sensitive)
      .map(([name]) => name),
  );
}

export function discoveryProviderContext(
  input: DiscoveryModelInput,
): Record<string, unknown> {
  const hasUnboundSensitiveOutput = Object.values(
    input.request.desiredOutputs,
  ).some((definition) => definition.sensitive);
  const context = {
    goal: input.request.goal,
    target: input.request.target,
    inputContract: Object.fromEntries(
      Object.entries(input.request.inputs).map(([name, value]) => [
        name,
        {
          type: value.type,
          required: value.required,
          sensitive: value.sensitive ?? false,
          allowedValues: value.allowedValues,
          description: value.description,
        },
      ]),
    ),
    desiredOutputs: input.request.desiredOutputs,
    currentState: hasUnboundSensitiveOutput
      ? {
          url: "[WITHHELD_UNBOUND_SENSITIVE_OUTPUT]",
          title: "[WITHHELD_UNBOUND_SENSITIVE_OUTPUT]",
          semanticTree: "[WITHHELD_UNBOUND_SENSITIVE_OUTPUT]",
          visibleText: "[WITHHELD_UNBOUND_SENSITIVE_OUTPUT]",
        }
      : {
          url: input.observation.url,
          title: input.observation.title,
          semanticTree: input.observation.semanticTree,
          visibleText: input.observation.visibleText,
        },
    priorSteps: input.priorSteps,
    remainingSteps: input.remainingSteps,
  };
  return sanitizePersisted(
    context,
    sensitiveRequestNames(input.request),
    sensitiveRequestValues(input.request),
  ) as Record<string, unknown>;
}

export function canShareDiscoveryScreenshot(
  input: DiscoveryModelInput,
): boolean {
  if (
    Object.values(input.request.desiredOutputs).some(
      (definition) => definition.sensitive,
    )
  ) {
    return false;
  }
  const sensitiveValues = sensitiveRequestValues(input.request);
  if (sensitiveValues.size === 0) return true;
  if (
    input.priorSteps.some((step) =>
      ["navigate", "fill", "select"].includes(step.kind),
    )
  ) {
    return false;
  }
  const observableState = {
    url: input.observation.url,
    title: input.observation.title,
    semanticTree: input.observation.semanticTree,
    visibleText: input.observation.visibleText,
    controls: input.observation.controls,
    priorActionResult: input.observation.priorActionResult,
  };
  return (
    JSON.stringify(observableState) ===
    JSON.stringify(
      sanitizePersisted(
        observableState,
        sensitiveRequestNames(input.request),
        sensitiveValues,
      ),
    )
  );
}

function discoveryPrompt(input: {
  request: DiscoveryRequest;
  observation: Observation;
  priorSteps: Array<{ id: string; kind: string; result: string }>;
  remainingSteps: number;
  timeoutMs: number;
  includeScreenshotPath?: boolean;
}): string {
  const context = discoveryProviderContext(input);
  if (input.includeScreenshotPath) {
    context.currentState = {
      ...(context.currentState as Record<string, unknown>),
      screenshotPath: input.observation.screenshotPath,
    };
  }
  return `${discoveryInstructions()}\n\nReturn only the structured proposal for this discovery turn:\n${JSON.stringify(context)}`;
}

const proposalJsonSchema = toJSONSchema(AgentProposalSchema);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nullableSchema(value: unknown): unknown {
  if (isRecord(value) && Array.isArray(value.anyOf)) {
    return { ...value, anyOf: [...value.anyOf, { type: "null" }] };
  }
  return { anyOf: [value, { type: "null" }] };
}

function codexCompatibleSchema(
  value: unknown,
  recordKeys: readonly string[],
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => codexCompatibleSchema(item, recordKeys));
  }
  if (!isRecord(value)) return value;
  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key === "oneOf" ? "anyOf" : key,
      codexCompatibleSchema(nested, recordKeys),
    ]),
  );
  if (isRecord(value.properties)) {
    const required = new Set(
      Array.isArray(value.required)
        ? value.required.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
    );
    normalized.properties = Object.fromEntries(
      Object.entries(value.properties).map(([key, property]) => [
        key,
        required.has(key)
          ? codexCompatibleSchema(property, recordKeys)
          : nullableSchema(codexCompatibleSchema(property, recordKeys)),
      ]),
    );
    normalized.required = Object.keys(value.properties);
  }
  if (isRecord(value.propertyNames) && isRecord(value.additionalProperties)) {
    normalized.properties = Object.fromEntries(
      recordKeys.map((key) => [
        key,
        codexCompatibleSchema(value.additionalProperties, recordKeys),
      ]),
    );
    normalized.required = [...recordKeys];
    normalized.additionalProperties = false;
    delete normalized.propertyNames;
  }
  return normalized;
}

function codexProposalSchema(
  recordKeys: readonly string[],
): Record<string, unknown> {
  const normalized = codexCompatibleSchema(
    proposalJsonSchema,
    recordKeys,
  ) as Record<string, unknown>;
  const variants = Array.isArray(normalized.anyOf)
    ? normalized.anyOf.filter(isRecord)
    : [];
  const variantProperties = variants.map((variant) =>
    isRecord(variant.properties) ? variant.properties : {},
  );
  const propertyNames = [
    ...new Set(
      variantProperties.flatMap((properties) => Object.keys(properties)),
    ),
  ];
  const properties: Record<string, unknown> = {};
  for (const name of propertyNames) {
    if (name === "kind") {
      properties.kind = {
        type: "string",
        enum: variants.flatMap((variant) => {
          const kind = isRecord(variant.properties)
            ? variant.properties.kind
            : undefined;
          return isRecord(kind) && typeof kind.const === "string"
            ? [kind.const]
            : [];
        }),
      };
      continue;
    }
    const schemas = variantProperties
      .map((variant) => variant[name])
      .filter((schema): schema is unknown => schema !== undefined);
    const schema = schemas[0];
    if (schema === undefined) continue;
    const isRequiredInEveryVariant = variantProperties.every((variant) =>
      Object.prototype.hasOwnProperty.call(variant, name),
    );
    properties[name] = isRequiredInEveryVariant
      ? schema
      : nullableSchema(schema);
  }
  return {
    ...(typeof normalized.$schema === "string"
      ? { $schema: normalized.$schema }
      : {}),
    ...(isRecord(normalized.$defs) ? { $defs: normalized.$defs } : {}),
    type: "object",
    properties,
    required: propertyNames,
    additionalProperties: false,
  };
}

function stripJsonFence(value: string): string {
  const match = value.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? value.trim();
}

function stripNullProperties(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNullProperties);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nested]) => nested !== null)
      .map(([key, nested]) => [key, stripNullProperties(nested)]),
  );
}

function normalizeProposalVariant(value: unknown): unknown {
  const stripped = stripNullProperties(value);
  if (!isRecord(stripped) || typeof stripped.kind !== "string") {
    return stripped;
  }
  const fieldsByKind: Record<string, readonly string[]> = {
    act: ["kind", "action", "reason", "expectedEffect"],
    complete: ["kind", "reason", "success", "outputs"],
    stuck: ["kind", "reason", "interventionHint", "resumeCondition"],
  };
  const fields = fieldsByKind[stripped.kind];
  if (!fields) return stripped;
  return Object.fromEntries(
    fields
      .filter((field) => Object.prototype.hasOwnProperty.call(stripped, field))
      .map((field) => [field, stripped[field]]),
  );
}

function findProposal(
  value: unknown,
  seen = new Set<unknown>(),
): AgentProposal | undefined {
  const direct = AgentProposalSchema.safeParse(normalizeProposalVariant(value));
  if (direct.success) return direct.data;
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    const candidate = stripJsonFence(value);
    if (candidate.length === 0) return undefined;
    try {
      return findProposal(JSON.parse(candidate), seen);
    } catch {
      return undefined;
    }
  }
  if (typeof value !== "object" || seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const proposal = findProposal(item, seen);
      if (proposal) return proposal;
    }
    return undefined;
  }
  for (const key of [
    "structured_output",
    "structuredOutput",
    "result",
    "output",
    "message",
    "content",
    "item",
    "last_message",
  ]) {
    const proposal = findProposal(
      (value as Record<string, unknown>)[key],
      seen,
    );
    if (proposal) return proposal;
  }
  for (const nested of Object.values(value)) {
    const proposal = findProposal(nested, seen);
    if (proposal) return proposal;
  }
  return undefined;
}

function parseStructuredProposal(raw: string): AgentProposal {
  const candidates = [raw, ...raw.split(/\r?\n/).filter((line) => line.trim())];
  for (const candidate of candidates) {
    try {
      const proposal = findProposal(JSON.parse(candidate));
      if (proposal) return proposal;
    } catch {
      const proposal = findProposal(candidate);
      if (proposal) return proposal;
    }
  }
  throw new Error(
    "The selected discovery transport returned no valid structured proposal",
  );
}

const defaultCommandRunner: CommandRunner = async ({
  command,
  args,
  stdin,
  timeoutMs,
  signal,
  workingDirectory,
}) =>
  await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      env: discoveryTransportEnvironment(),
      ...(workingDirectory === undefined ? {} : { cwd: workingDirectory }),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    const terminate = (): void => {
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 1_000);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    const onAbort = (): void => {
      terminate();
      finish(
        () =>
          reject(
            signal.reason instanceof Error
              ? signal.reason
              : new Error("The selected discovery transport was cancelled"),
          ),
        true,
      );
    };
    const finish = (callback: () => void, preserveForceKill = false): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!preserveForceKill && forceKillTimer !== undefined)
        clearTimeout(forceKillTimer);
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", () => {
      finish(() =>
        reject(new Error("The selected discovery transport could not start")),
      );
    });
    child.once("close", (exitCode, signal) => {
      finish(() => {
        if (timedOut) {
          reject(new Error("The selected discovery transport timed out"));
          return;
        }
        resolve({
          exitCode,
          ...(signal === null ? {} : { signal }),
          ...(child.pid === undefined ? {} : { processId: child.pid }),
          stdout,
          stderr,
        });
      });
    });
    child.stdin.end(stdin);
  });

async function runWithSchemaFile(
  runner: CommandRunner,
  options: {
    command: string;
    args: string[];
    prompt: string;
    timeoutMs: number;
    signal: AbortSignal;
    schema?: Record<string, unknown>;
  },
): Promise<{
  raw: string;
  receipt: Omit<
    Extract<ModelTransportReceipt, { kind: "cli-process" }>,
    "schemaValidated"
  >;
}> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cuas-discovery-"));
  const schemaPath = path.join(directory, "proposal-schema.json");
  const outputPath = path.join(directory, "proposal.json");
  try {
    await writeFile(
      schemaPath,
      `${JSON.stringify(options.schema ?? proposalJsonSchema)}\n`,
      "utf8",
    );
    const args = [
      ...options.args,
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      "-",
    ];
    const result = await runner({
      command: options.command,
      args,
      stdin: options.prompt,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      workingDirectory: directory,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        "The selected discovery transport exited without a proposal",
      );
    }
    try {
      return {
        raw: await readFile(outputPath, "utf8"),
        receipt: {
          kind: "cli-process",
          exitCode: result.exitCode,
          ...(result.signal === undefined ? {} : { signal: result.signal }),
          ...(result.processId === undefined
            ? {}
            : { processId: result.processId }),
          executable: path.basename(options.command),
          argumentSha256: createHash("sha256")
            .update(JSON.stringify(args))
            .digest("hex"),
          stdinSha256: createHash("sha256")
            .update(options.prompt)
            .digest("hex"),
          outputSource: "schema-output-file",
        },
      };
    } catch {
      return {
        raw: result.stdout,
        receipt: {
          kind: "cli-process",
          exitCode: result.exitCode,
          ...(result.signal === undefined ? {} : { signal: result.signal }),
          ...(result.processId === undefined
            ? {}
            : { processId: result.processId }),
          executable: path.basename(options.command),
          argumentSha256: createHash("sha256")
            .update(JSON.stringify(args))
            .digest("hex"),
          stdinSha256: createHash("sha256")
            .update(options.prompt)
            .digest("hex"),
          outputSource: "stdout",
        },
      };
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function runCliModel(
  runner: CommandRunner,
  options: {
    command: string;
    args: string[];
    prompt: string;
    timeoutMs: number;
    signal: AbortSignal;
    schemaFile?: boolean;
  },
): Promise<ModelProposalResult> {
  let raw: string;
  let runnerReceipt: Omit<
    Extract<ModelTransportReceipt, { kind: "cli-process" }>,
    "schemaValidated"
  >;
  if (options.schemaFile) {
    const completed = await runWithSchemaFile(runner, options);
    raw = completed.raw;
    runnerReceipt = completed.receipt;
  } else {
    const result = await runner({
      command: options.command,
      args: options.args,
      stdin: options.prompt,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        "The selected discovery transport exited without a proposal",
      );
    }
    raw = result.stdout;
    runnerReceipt = {
      kind: "cli-process",
      exitCode: result.exitCode,
      ...(result.signal === undefined ? {} : { signal: result.signal }),
      ...(result.processId === undefined
        ? {}
        : { processId: result.processId }),
      executable: path.basename(options.command),
      argumentSha256: createHash("sha256")
        .update(JSON.stringify(options.args))
        .digest("hex"),
      stdinSha256: createHash("sha256").update(options.prompt).digest("hex"),
      outputSource: "stdout",
    };
  }
  return {
    proposal: parseStructuredProposal(raw),
    receipt: { ...runnerReceipt, schemaValidated: true },
  };
}

export class OpenAIModelClient implements ModelClient {
  public readonly transport = "openai-responses";
  public readonly executionKind = "external";
  private readonly client: OpenAI;

  public constructor(
    public readonly modelIdentifier = process.env.OPENAI_MODEL ?? "gpt-5.6-sol",
    apiKey = process.env.OPENAI_API_KEY,
  ) {
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is required for genuine discovery; replay does not use it.",
      );
    }
    this.client = new OpenAI({ apiKey });
    registerModelMetadata(this, {
      transport: this.transport,
      modelIdentifier: this.modelIdentifier,
      executionKind: "external",
      adapterImplementation: "openai-responses-sdk-v1",
      runnerKind: "provider-sdk",
    });
  }

  public async propose(input: {
    request: DiscoveryRequest;
    observation: Observation;
    priorSteps: Array<{ id: string; kind: string; result: string }>;
    remainingSteps: number;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<ModelProposalResult> {
    const includeScreenshot = canShareDiscoveryScreenshot(input);
    const response = await this.client.responses.parse(
      {
        model: this.modelIdentifier,
        reasoning: { effort: "medium" },
        input: [
          {
            role: "system",
            content: discoveryInstructions(),
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify(discoveryProviderContext(input)),
              },
              ...(includeScreenshot
                ? [
                    {
                      type: "input_image" as const,
                      image_url: input.observation.screenshotDataUrl,
                      detail: "high" as const,
                    },
                  ]
                : []),
            ],
          },
        ],
        text: {
          format: zodTextFormat(AgentProposalSchema, "agent_proposal"),
        },
      },
      { timeout: input.timeoutMs, signal: input.signal },
    );
    if (!response.output_parsed) {
      throw new Error("The discovery model returned no structured proposal");
    }
    return {
      proposal: AgentProposalSchema.parse(response.output_parsed),
      receipt: {
        kind: "openai-response",
        responseId: response.id,
        responseStatus: response.status ?? "completed",
        schemaValidated: true,
      },
    };
  }
}

export class CodexCliModelClient implements ModelClient {
  public readonly transport = "codex-cli";
  public readonly executionKind: "external" | "test-double";
  public readonly modelIdentifier: string;
  private readonly modelName: string | undefined;
  private readonly options: Required<Pick<CliModelOptions, "command">> &
    Pick<CliModelOptions, "run" | "timeoutMs">;

  public constructor(modelName?: string, options: CliModelOptions = {}) {
    this.modelName = modelName;
    this.modelIdentifier = `codex-cli:${modelName ?? "configured-default"}`;
    this.executionKind = options.run === undefined ? "external" : "test-double";
    this.options = {
      command: options.command ?? "codex",
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
      ...(options.run === undefined ? {} : { run: options.run }),
    };
    registerModelMetadata(this, {
      transport: this.transport,
      modelIdentifier: this.modelIdentifier,
      executionKind: this.executionKind,
      adapterImplementation: "codex-cli-schema-file-v1",
      runnerKind: options.run === undefined ? "builtin-process" : "injected",
    });
  }

  public async propose(input: {
    request: DiscoveryRequest;
    observation: Observation;
    priorSteps: Array<{ id: string; kind: string; result: string }>;
    remainingSteps: number;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<ModelProposalResult> {
    const includeScreenshot = canShareDiscoveryScreenshot(input);
    const args = [
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "--disable",
      "shell_tool",
      "--disable",
      "shell_snapshot",
      "--sandbox",
      "read-only",
      "--config",
      'approval_policy="never"',
      "--config",
      'model_reasoning_effort="xhigh"',
      "--config",
      'web_search="disabled"',
      "--config",
      "tools.view_image=false",
      ...(includeScreenshot
        ? ["--image", path.resolve(input.observation.screenshotPath)]
        : []),
      ...(this.modelName === undefined ? [] : ["--model", this.modelName]),
    ];
    const completed = await runWithSchemaFile(
      this.options.run ?? defaultCommandRunner,
      {
        command: this.options.command,
        args,
        prompt: discoveryPrompt({ ...input, includeScreenshotPath: false }),
        timeoutMs: Math.min(
          this.options.timeoutMs ?? input.timeoutMs,
          input.timeoutMs,
        ),
        signal: input.signal,
        schema: codexProposalSchema(Object.keys(input.request.desiredOutputs)),
      },
    );
    return {
      proposal: parseStructuredProposal(completed.raw),
      receipt: { ...completed.receipt, schemaValidated: true },
    };
  }
}

export class ClaudeCodeCliModelClient implements ModelClient {
  public readonly transport = "claude-code-cli";
  public readonly executionKind: "external" | "test-double";
  public readonly modelIdentifier: string;
  private readonly modelName: string | undefined;
  private readonly options: Required<Pick<CliModelOptions, "command">> &
    Pick<CliModelOptions, "run" | "timeoutMs">;

  public constructor(modelName?: string, options: CliModelOptions = {}) {
    this.modelName = modelName;
    this.modelIdentifier = `claude-code-cli:${modelName ?? "configured-default"}`;
    this.executionKind = options.run === undefined ? "external" : "test-double";
    this.options = {
      command: options.command ?? "claude",
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
      ...(options.run === undefined ? {} : { run: options.run }),
    };
    registerModelMetadata(this, {
      transport: this.transport,
      modelIdentifier: this.modelIdentifier,
      executionKind: this.executionKind,
      adapterImplementation: "claude-code-json-schema-v1",
      runnerKind: options.run === undefined ? "builtin-process" : "injected",
    });
  }

  public async propose(input: {
    request: DiscoveryRequest;
    observation: Observation;
    priorSteps: Array<{ id: string; kind: string; result: string }>;
    remainingSteps: number;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<ModelProposalResult> {
    const includeScreenshot = canShareDiscoveryScreenshot(input);
    const schema = JSON.stringify(proposalJsonSchema);
    const args = [
      "--print",
      "--no-session-persistence",
      "--output-format",
      "json",
      "--json-schema",
      schema,
      "--safe-mode",
      "--permission-mode",
      "dontAsk",
      "--tools",
      includeScreenshot ? "Read" : "",
      ...(includeScreenshot
        ? ["--allowed-tools", `Read(${input.observation.screenshotPath})`]
        : []),
      ...(this.modelName === undefined ? [] : ["--model", this.modelName]),
    ];
    return await runCliModel(this.options.run ?? defaultCommandRunner, {
      command: this.options.command,
      args,
      prompt: discoveryPrompt({
        ...input,
        includeScreenshotPath: includeScreenshot,
      }),
      timeoutMs: Math.min(
        this.options.timeoutMs ?? input.timeoutMs,
        input.timeoutMs,
      ),
      signal: input.signal,
    });
  }
}

export type DiscoveryTransport = "openai" | "codex" | "claude-code";

export function createDiscoveryModelClient(
  transport: DiscoveryTransport,
  modelName?: string,
): ModelClient {
  switch (transport) {
    case "openai":
      return new OpenAIModelClient(modelName);
    case "codex":
      return new CodexCliModelClient(modelName);
    case "claude-code":
      return new ClaudeCodeCliModelClient(modelName);
  }
}

export class ScriptedModelClient implements ModelClient {
  public readonly transport = "scripted-test-double";
  public readonly executionKind = "test-double";
  public readonly modelIdentifier = "scripted-model-test-double";
  public calls = 0;

  public constructor(private readonly proposals: readonly AgentProposal[]) {
    registerModelMetadata(this, {
      transport: this.transport,
      modelIdentifier: this.modelIdentifier,
      executionKind: "test-double",
      adapterImplementation: "scripted-proposal-sequence-v1",
      runnerKind: "scripted",
    });
  }

  public async propose(): Promise<ModelProposalResult> {
    const fixtureIndex = this.calls;
    const proposal = this.proposals[this.calls];
    this.calls += 1;
    if (!proposal) throw new Error("Scripted model has no remaining proposal");
    return {
      proposal: AgentProposalSchema.parse(proposal),
      receipt: {
        kind: "scripted-test-double",
        fixtureIndex,
        schemaValidated: true,
      },
    };
  }
}
