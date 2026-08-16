import { createHash } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ControlOwner, RunEvent } from "./contracts.js";
import {
  InputDefinitionSchema,
  OutputBindingSchema,
  OutputDefinitionSchema,
  RunEventSchema,
} from "./contracts.js";
import { sensitiveValueRepresentations } from "./sensitive-values.js";

const SECRET_KEY =
  /(api[-_]?key|authorization|cookie|token|password|secret|credential)/i;
const SENSITIVE_VALUE = /\b(?:\d[ -]?){11,18}\d\b/g;

function isDeclarativeDefinition(
  value: unknown,
): value is Record<string, unknown> {
  return (
    InputDefinitionSchema.safeParse(value).success ||
    OutputDefinitionSchema.safeParse(value).success ||
    OutputBindingSchema.safeParse(value).success
  );
}

export function sanitizePersisted(
  value: unknown,
  sensitiveFields: ReadonlySet<string> = new Set(),
  sensitiveValues: ReadonlySet<string> = new Set(),
): unknown {
  return sanitizeValue(value, sensitiveFields, sensitiveValues);
}

const SCHEMA_CONTAINERS = new Set([
  "inputContract",
  "inputSchema",
  "desiredOutputs",
  "outputSchema",
  "outputBindings",
]);

function sanitizeValue(
  value: unknown,
  sensitiveFields: ReadonlySet<string>,
  sensitiveValues: ReadonlySet<string>,
  containerKey?: string,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitizeValue(item, sensitiveFields, sensitiveValues, containerKey),
    );
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        (SECRET_KEY.test(key) || sensitiveFields.has(key)) &&
        !(
          containerKey !== undefined &&
          SCHEMA_CONTAINERS.has(containerKey) &&
          isDeclarativeDefinition(item)
        )
          ? "[REDACTED]"
          : sanitizeValue(item, sensitiveFields, sensitiveValues, key),
      ]),
    );
  }
  if (typeof value === "string") {
    let redacted = value.replace(SENSITIVE_VALUE, "[REDACTED-NUMERIC]");
    for (const sensitive of sensitiveValues) {
      if (sensitive.length > 0)
        redacted = redacted.replaceAll(sensitive, "[REDACTED]");
    }
    return redacted;
  }
  if (
    (typeof value === "number" || typeof value === "boolean") &&
    sensitiveValues.has(String(value))
  ) {
    return "[REDACTED]";
  }
  return value;
}

export class EvidenceWriter {
  public readonly runDirectory: string;
  public readonly relativeRunDirectory: string;
  private readonly eventsPath: string;
  private readonly sensitiveFields: Set<string>;
  private readonly sensitiveValues: Set<string>;

  public constructor(
    public readonly repositoryRoot: string,
    public readonly runId: string,
    sensitiveFields: ReadonlySet<string> = new Set(),
    sensitiveValues: ReadonlySet<string> = new Set(),
  ) {
    this.sensitiveFields = new Set(sensitiveFields);
    this.sensitiveValues = new Set(
      [...sensitiveValues].flatMap((value) =>
        sensitiveValueRepresentations(value),
      ),
    );
    this.relativeRunDirectory = path.posix.join("evidence", runId);
    this.runDirectory = path.join(repositoryRoot, "evidence", runId);
    this.eventsPath = path.join(this.runDirectory, "events.jsonl");
  }

  public addSensitiveFields(fields: Iterable<string>): void {
    for (const field of fields) this.sensitiveFields.add(field);
  }

  public addSensitiveValues(values: Iterable<string | number | boolean>): void {
    for (const value of values) {
      for (const representation of sensitiveValueRepresentations(value)) {
        this.sensitiveValues.add(representation);
      }
    }
  }

  public async initialize(): Promise<void> {
    await mkdir(this.runDirectory, { recursive: true });
  }

  public relativePath(name: string): string {
    return path.posix.join(this.relativeRunDirectory, name);
  }

  public absolutePath(name: string): string {
    return path.join(this.runDirectory, name);
  }

  public async event(
    phase: RunEvent["phase"],
    eventType: string,
    controlOwner: ControlOwner,
    data: Record<string, unknown> = {},
    stepId?: string,
  ): Promise<RunEvent> {
    await this.initialize();
    const event = RunEventSchema.parse({
      timestamp: new Date().toISOString(),
      runId: this.runId,
      phase,
      eventType,
      ...(stepId === undefined ? {} : { stepId }),
      controlOwner,
      data: sanitizePersisted(data, this.sensitiveFields, this.sensitiveValues),
    });
    await appendFile(this.eventsPath, `${JSON.stringify(event)}\n`, "utf8");
    return event;
  }

  public async json(name: string, value: unknown): Promise<string> {
    return (await this.jsonWithDigest(name, value)).path;
  }

  public async jsonWithDigest(
    name: string,
    value: unknown,
  ): Promise<{ path: string; sha256: string }> {
    await this.initialize();
    const content = `${JSON.stringify(
      sanitizePersisted(value, this.sensitiveFields, this.sensitiveValues),
      null,
      2,
    )}\n`;
    await writeFile(this.absolutePath(name), content, "utf8");
    return {
      path: this.relativePath(name),
      sha256: createHash("sha256").update(content).digest("hex"),
    };
  }

  public async text(name: string, value: string): Promise<string> {
    await this.initialize();
    await writeFile(
      this.absolutePath(name),
      String(
        sanitizePersisted(value, this.sensitiveFields, this.sensitiveValues),
      ),
      "utf8",
    );
    return this.relativePath(name);
  }
}
