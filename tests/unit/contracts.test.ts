import { describe, expect, it } from "vitest";
import {
  parseCapabilityArtifact,
  validateInvocationInputs,
} from "../../src/contracts.js";
import { createPrepareSubaccountArtifact } from "../../src/sample-artifact.js";

describe("capability contracts", () => {
  it("accepts the reviewable v1 artifact", () => {
    const artifact = createPrepareSubaccountArtifact();
    expect(parseCapabilityArtifact(artifact).capability.id).toBe(
      "prepare-subaccount",
    );
  });

  it("rejects duplicate step identifiers", () => {
    const artifact = createPrepareSubaccountArtifact();
    artifact.steps[1] = { ...artifact.steps[1]!, id: artifact.steps[0]!.id };
    expect(() => parseCapabilityArtifact(artifact)).toThrow(
      /Duplicate step id/,
    );
  });

  it("rejects executable or unknown artifact fields", () => {
    const artifact = {
      ...createPrepareSubaccountArtifact(),
      execute: "require('child_process').exec('unsafe')",
    };
    expect(() => parseCapabilityArtifact(artifact)).toThrow();
  });

  it("validates types and allowed values", () => {
    const artifact = createPrepareSubaccountArtifact();
    expect(
      validateInvocationInputs(artifact.inputSchema, {
        memberId: "M-1002",
        productCode: "MONEY_MARKET",
        nickname: "Rainy Day",
      }),
    ).toEqual({
      memberId: "M-1002",
      productCode: "MONEY_MARKET",
      nickname: "Rainy Day",
    });
    expect(() =>
      validateInvocationInputs(artifact.inputSchema, {
        memberId: "M-1002",
        productCode: "UNLISTED",
        nickname: "Rainy Day",
      }),
    ).toThrow(/must be one of/);
  });

  it("rejects missing required invocation values", () => {
    const artifact = createPrepareSubaccountArtifact();
    expect(() => validateInvocationInputs(artifact.inputSchema, {})).toThrow(
      /Missing required input/,
    );
  });
});
