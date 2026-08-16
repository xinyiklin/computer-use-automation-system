import { describe, expect, it } from "vitest";
import { AutomationError, failureResult } from "../../src/errors.js";

describe("public failures", () => {
  it("normalizes internal errors without exposing their message or stack", () => {
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
        message: "Automation failed because of an unexpected internal error",
        evidencePaths: [],
      },
    });
    expect(JSON.stringify(result)).not.toContain("stack");
    expect(JSON.stringify(result)).not.toContain("browser broke");
  });

  it("sanitizes deliberate failure messages and context for callers", () => {
    const result = failureResult(
      "run",
      "capability",
      new AutomationError(
        "CONTROL_FAILED",
        "Could not act for M-1001",
        "hard_failure",
        { observed: { memberId: "M-1001", authorization: "Bearer private" } },
      ),
      {
        sensitiveFields: new Set(["memberId"]),
        sensitiveValues: new Set(["M-1001"]),
      },
    );

    expect(JSON.stringify(result)).not.toContain("M-1001");
    expect(JSON.stringify(result)).not.toContain("Bearer private");
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
