import type { ReplayResult } from "./contracts.js";
import { sanitizePersisted } from "./evidence.js";

export class AutomationError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly category:
      | "recoverable_exhausted"
      | "hard_failure"
      | "policy"
      | "invalid_artifact" = "hard_failure",
    public readonly context: {
      stepId?: string;
      expected?: unknown;
      observed?: unknown;
      evidencePaths?: string[];
    } = {},
  ) {
    super(message);
    this.name = "AutomationError";
  }
}

export function failureResult(
  runId: string,
  capabilityId: string,
  error: unknown,
  sanitization: {
    sensitiveFields?: ReadonlySet<string>;
    sensitiveValues?: ReadonlySet<string>;
  } = {},
): ReplayResult {
  const normalized =
    error instanceof AutomationError
      ? error
      : new AutomationError(
          "UNEXPECTED_AUTOMATION_ERROR",
          "Automation failed because of an unexpected internal error",
        );

  return sanitizePersisted(
    {
      status: "failure",
      runId,
      capabilityId,
      error: {
        category: normalized.category,
        code: normalized.code,
        message: normalized.message,
        ...(normalized.context.stepId === undefined
          ? {}
          : { stepId: normalized.context.stepId }),
        ...(normalized.context.expected === undefined
          ? {}
          : { expected: normalized.context.expected }),
        ...(normalized.context.observed === undefined
          ? {}
          : { observed: normalized.context.observed }),
        evidencePaths: normalized.context.evidencePaths ?? [],
      },
    },
    sanitization.sensitiveFields,
    sanitization.sensitiveValues,
  ) as ReplayResult;
}
