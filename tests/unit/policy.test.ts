import { describe, expect, it } from "vitest";
import { AutomationError } from "../../src/errors.js";
import {
  assertStepAllowed,
  assertUrlAllowed,
  createDefaultPolicy,
  intersectArtifactPolicy,
} from "../../src/policy.js";
import {
  CONTROLS,
  createPrepareSubaccountArtifact,
} from "../../src/sample-artifact.js";

const origin = "http://127.0.0.1:4317";

describe("automation policy", () => {
  it("permits the bounded synthetic entry route", () => {
    expect(
      assertUrlAllowed(
        `${origin}/backoffice/members/search`,
        createDefaultPolicy(origin),
      ).pathname,
    ).toBe("/backoffice/members/search");
  });

  it.each([
    ["external origin", "https://example.com/backoffice/members/search"],
    ["unlisted local route", `${origin}/__test/state`],
    [
      "irreversible confirm route",
      `${origin}/backoffice/members/M-1001/accounts/new/confirm`,
    ],
  ])("blocks %s", (_label, url) => {
    expect(() => assertUrlAllowed(url, createDefaultPolicy(origin))).toThrow(
      AutomationError,
    );
  });

  it("blocks irreversible actions before execution", () => {
    expect(() =>
      assertStepAllowed(
        {
          id: "confirm",
          kind: "click",
          description: "Confirm account",
          riskClass: "irreversible",
          target: CONTROLS.confirm,
        },
        createDefaultPolicy(origin),
      ),
    ).toThrow(/Risk class is blocked/);
  });

  it("allows artifacts only to narrow configured origins", () => {
    const artifact = createPrepareSubaccountArtifact(origin);
    const configured = createDefaultPolicy("http://127.0.0.1:9999");
    expect(() => intersectArtifactPolicy(configured, artifact)).toThrow(
      /no permitted origin in common/,
    );
  });
});
