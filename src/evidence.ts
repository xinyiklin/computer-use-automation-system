import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ControlOwner, RunEvent } from "./contracts.js";
import { RunEventSchema } from "./contracts.js";

const SECRET_KEY =
  /(api[-_]?key|authorization|cookie|token|password|secret|credential)/i;
const SENSITIVE_VALUE = /\b(?:\d[ -]?){11,18}\d\b/g;

export function sanitizePersisted(
  value: unknown,
  sensitiveFields: ReadonlySet<string> = new Set(),
  sensitiveValues: ReadonlySet<string> = new Set(),
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitizePersisted(item, sensitiveFields, sensitiveValues),
    );
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SECRET_KEY.test(key) || sensitiveFields.has(key)
          ? "[REDACTED]"
          : sanitizePersisted(item, sensitiveFields, sensitiveValues),
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
  return value;
}

export class EvidenceWriter {
  public readonly runDirectory: string;
  public readonly relativeRunDirectory: string;
  private readonly eventsPath: string;

  public constructor(
    public readonly repositoryRoot: string,
    public readonly runId: string,
    private readonly sensitiveFields: ReadonlySet<string> = new Set(),
    private readonly sensitiveValues: ReadonlySet<string> = new Set(),
  ) {
    this.relativeRunDirectory = path.posix.join("evidence", runId);
    this.runDirectory = path.join(repositoryRoot, "evidence", runId);
    this.eventsPath = path.join(this.runDirectory, "events.jsonl");
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
    await this.initialize();
    await writeFile(
      this.absolutePath(name),
      `${JSON.stringify(sanitizePersisted(value, this.sensitiveFields, this.sensitiveValues), null, 2)}\n`,
      "utf8",
    );
    return this.relativePath(name);
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
