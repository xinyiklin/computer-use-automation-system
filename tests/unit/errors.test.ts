import { describe, expect, it } from "vitest";
import { AutomationError, failureResult } from "../../src/errors.js";

describe("public failures", () => {
  it("normalizes internal errors without exposing a stack", () => {
    const result = failureResult(
      "run",
      "capability",
      new Error("browser broke"),
    );
    expect(result).toEqual({
      status: "failure",
      runId: "run",
      capabilityId: "capability",
      error: {
        category: "hard_failure",
        code: "UNEXPECTED_AUTOMATION_ERROR",
        message: "browser broke",
        evidencePaths: [],
      },
    });
    expect(JSON.stringify(result)).not.toContain("stack");
  });

  it("preserves deliberate policy classification", () => {
    const result = failureResult(
      "run",
      "capability",
      new AutomationError("POLICY_BLOCKED", "Blocked", "policy"),
    );
    expect(result.status === "failure" && result.error.category).toBe("policy");
  });
});
