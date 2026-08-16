import { describe, expect, it } from "vitest";
import {
  parseCapabilityArtifact,
  validateInvocationInputs,
} from "../../src/contracts.js";
import {
  assertArtifactInputIndependence,
  assertArtifactOutputIndependence,
} from "../../src/discovery.js";
import {
  CONTROLS,
  createPrepareSubaccountArtifact,
} from "../../src/sample-artifact.js";

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

  it("rejects an artifact that can act before entry navigation", () => {
    const artifact = createPrepareSubaccountArtifact();
    artifact.steps = artifact.steps.slice(1);

    expect(() => parseCapabilityArtifact(artifact)).toThrow(
      /first capability step must navigate/i,
    );
  });

  it("rejects the unimplemented relative near relation", () => {
    const artifact = createPrepareSubaccountArtifact();
    const binding = artifact.outputBindings.memberReference;
    if (binding?.kind !== "scalar") throw new Error("Expected scalar binding");
    const candidate = binding.source.candidates[0];
    if (candidate?.kind !== "relative") {
      throw new Error("Expected relative locator");
    }
    const invalid = {
      ...artifact,
      outputBindings: {
        ...artifact.outputBindings,
        memberReference: {
          ...binding,
          source: {
            ...binding.source,
            candidates: [{ ...candidate, relation: "near" }],
          },
        },
      },
    };

    expect(() => parseCapabilityArtifact(invalid)).toThrow();
  });

  it("rejects undeclared input references in navigation sources", () => {
    const artifact = createPrepareSubaccountArtifact();
    artifact.steps[0] = {
      ...artifact.steps[0]!,
      kind: "navigate",
      url: { kind: "input", name: "undeclaredEntryUrl" },
    };

    expect(() => parseCapabilityArtifact(artifact)).toThrow(
      /Unknown input reference: undeclaredEntryUrl/,
    );
  });

  it("rejects undeclared input references nested inside conditions", () => {
    const artifact = createPrepareSubaccountArtifact();
    artifact.success = {
      kind: "all",
      conditions: [
        artifact.success,
        {
          kind: "value_equals",
          target: CONTROLS.nickname,
          value: { kind: "input", name: "undeclaredNickname" },
        },
      ],
    };

    expect(() => parseCapabilityArtifact(artifact)).toThrow(
      /Unknown input reference: undeclaredNickname/,
    );
  });

  it("rejects executable or unknown artifact fields", () => {
    const artifact = {
      ...createPrepareSubaccountArtifact(),
      execute: "require('child_process').exec('unsafe')",
    };
    expect(() => parseCapabilityArtifact(artifact)).toThrow();
  });

  it("rejects scalar output bindings that use the observed text as a locator", () => {
    const artifact = createPrepareSubaccountArtifact();
    const invalidArtifact = {
      ...artifact,
      outputBindings: {
        ...artifact.outputBindings,
        memberReference: {
          kind: "scalar",
          source: {
            description: "prepared member reference value",
            robustnessNote: "Exact text from this discovery run.",
            candidates: [{ kind: "text", text: "Member ••1001", exact: true }],
            expectedCardinality: 1,
          },
          parseAs: "string",
          sensitive: true,
        },
      },
    };

    expect(() => parseCapabilityArtifact(invalidArtifact)).toThrow();
  });

  it("rejects literal bindings for outputs not declared constant", () => {
    const artifact = createPrepareSubaccountArtifact();
    artifact.outputBindings.memberReference = {
      kind: "literal",
      value: "Member ••1001",
    };

    expect(() => parseCapabilityArtifact(artifact)).toThrow(
      /requires an explicit constant output definition: memberReference/,
    );
  });

  it("rejects literal bindings that disagree with a declared constant", () => {
    const artifact = createPrepareSubaccountArtifact();
    artifact.outputBindings.status = {
      kind: "literal",
      value: "completed",
    };

    expect(() => parseCapabilityArtifact(artifact)).toThrow(
      /does not match the declared constant: status/,
    );
  });

  it("rejects constants whose runtime type disagrees with the contract", () => {
    const artifact = createPrepareSubaccountArtifact();
    artifact.outputSchema.status = {
      type: "number",
      constant: "ready_for_review",
      description: "Invalidly typed status.",
    };

    expect(() => parseCapabilityArtifact(artifact)).toThrow(
      /Output constant must match declared type number/,
    );
  });

  it("rejects scalar parsers that disagree with the declared output type", () => {
    const artifact = createPrepareSubaccountArtifact();
    const binding = artifact.outputBindings.productCode;
    if (binding?.kind !== "scalar") {
      throw new Error("Expected productCode to use a scalar binding");
    }
    artifact.outputBindings.productCode = {
      ...binding,
      parseAs: "number",
    };

    expect(() => parseCapabilityArtifact(artifact)).toThrow(
      /Output binding parser must match declared type string: productCode/,
    );
  });

  it("rejects output sensitivity that exists only on the binding", () => {
    const artifact = createPrepareSubaccountArtifact();
    artifact.outputSchema.memberReference = {
      type: "string",
      description: "Member reference without sensitivity metadata.",
    };

    expect(() => parseCapabilityArtifact(artifact)).toThrow(
      /Output binding sensitivity must match its output definition/,
    );
  });

  it("rejects success conditions that embed an invocation value", () => {
    const artifact = createPrepareSubaccountArtifact();
    artifact.success = {
      kind: "url_matches",
      pattern:
        "http://127.0.0.1:4317/backoffice/members/M-1001/accounts/new/review",
    };

    expect(() =>
      assertArtifactInputIndependence(artifact, {
        memberId: "M-1001",
        productCode: "SAV_PLUS",
        nickname: "Discovery Sample",
      }),
    ).toThrow(/embeds invocation input memberId/);
  });

  it("accepts executable behavior parameterized through input references", () => {
    expect(() =>
      assertArtifactInputIndependence(createPrepareSubaccountArtifact(), {
        memberId: "M-1001",
        productCode: "SAV_PLUS",
        nickname: "Discovery Sample",
      }),
    ).not.toThrow();
  });

  it("does not treat an explicitly declared constant as invocation-dependent", () => {
    expect(() =>
      assertArtifactInputIndependence(createPrepareSubaccountArtifact(), {
        nickname: "ready_for_review",
      }),
    ).not.toThrow();
  });

  it("does not confuse a non-sensitive input with a stable semantic label", () => {
    expect(() =>
      assertArtifactInputIndependence(createPrepareSubaccountArtifact(), {
        nickname: "Nickname",
      }),
    ).not.toThrow();
  });

  it("rejects an output locator tied to its live extracted value", () => {
    const artifact = createPrepareSubaccountArtifact();
    artifact.outputBindings.memberReference = {
      kind: "scalar",
      source: {
        description: "discovery-run member value",
        robustnessNote: "This locator improperly copies the observed value.",
        candidates: [
          {
            kind: "relative",
            anchorText: "Member ••1001",
            relation: "following",
            elementHint: "td",
          },
        ],
        expectedCardinality: 1,
      },
      parseAs: "string",
      sensitive: true,
    };

    expect(() =>
      assertArtifactOutputIndependence(artifact, {
        memberReference: "Member ••1001",
      }),
    ).toThrow(/embeds its observed output value/);
  });

  it("rejects output locators that embed an invocation input even when the extracted output differs", () => {
    const artifact = createPrepareSubaccountArtifact();
    artifact.outputBindings.productCode = {
      kind: "scalar",
      source: {
        description: "product code associated with this discovery invocation",
        robustnessNote: "Improperly anchored to the invocation member value.",
        candidates: [
          {
            kind: "relative",
            anchorText: "M-1001",
            relation: "following",
            elementHint: "td",
          },
        ],
        expectedCardinality: 1,
      },
      parseAs: "string",
    };

    expect(() =>
      assertArtifactInputIndependence(
        artifact,
        { memberId: "M-1001" },
        new Set(["memberId"]),
      ),
    ).toThrow(/embeds invocation input memberId/);
  });

  it("does not confuse a short input with text inside stable behavior", () => {
    expect(() =>
      assertArtifactInputIndependence(createPrepareSubaccountArtifact(), {
        memberId: "a",
        productCode: "b",
        nickname: "c",
      }),
    ).not.toThrow();
  });

  it("rejects URL-encoded invocation values embedded in behavior", () => {
    const artifact = createPrepareSubaccountArtifact();
    artifact.success = {
      kind: "url_matches",
      pattern: "^/accounts/A%2FB/review$",
    };

    expect(() =>
      assertArtifactInputIndependence(artifact, { accountPath: "A/B" }),
    ).toThrow(/embeds invocation input accountPath/);
  });

  it("rejects invocation values embedded in compatibility metadata", () => {
    const artifact = createPrepareSubaccountArtifact();
    artifact.compatibility.appFamily = "customer-specific-app";

    expect(() =>
      assertArtifactInputIndependence(artifact, {
        customerType: "customer-specific-app",
      }),
    ).toThrow(/embeds invocation input customerType/);
  });

  it("rejects invocation values embedded in business-outcome details", () => {
    const artifact = createPrepareSubaccountArtifact();
    artifact.businessOutcomes[0]!.details = { attemptedMember: "M-1001" };

    expect(() =>
      assertArtifactInputIndependence(artifact, { memberId: "M-1001" }),
    ).toThrow(/embeds invocation input memberId/);
  });

  it("rejects numeric and boolean invocation values embedded as strings", () => {
    const artifact = createPrepareSubaccountArtifact();
    artifact.success = {
      kind: "url_matches",
      pattern: "^/accounts/42/review?enabled=true$",
    };

    expect(() =>
      assertArtifactInputIndependence(artifact, { quantity: 42 }),
    ).toThrow(/embeds invocation input quantity/);
    expect(() =>
      assertArtifactInputIndependence(artifact, { enabled: true }),
    ).toThrow(/embeds invocation input enabled/);
  });

  it("rejects CSS selectors for scalar output bindings", () => {
    const artifact = createPrepareSubaccountArtifact();
    (artifact.outputBindings as Record<string, unknown>).productCode = {
      kind: "scalar",
      source: {
        description: "prepared product code value",
        robustnessNote: "Broad CSS can capture unrelated page content.",
        candidates: [{ kind: "css", selector: "body" }],
        expectedCardinality: 1,
      },
      parseAs: "string",
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
