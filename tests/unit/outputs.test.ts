import { describe, expect, it } from "vitest";
import { parseScalarOutput } from "../../src/outputs.js";

describe("output parsing", () => {
  it.each([
    ["number" as const, ""],
    ["number" as const, "   "],
    ["currency" as const, ""],
    ["currency" as const, "$ ,"],
  ])("rejects blank %s output", (parser, value) => {
    expect(() => parseScalarOutput(value, parser, "amount")).toThrow(
      /Could not parse/,
    );
  });
});
