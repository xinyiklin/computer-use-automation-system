import { describe, expect, it } from "vitest";
import { sanitizePersisted } from "../../src/evidence.js";

describe("evidence sanitization", () => {
  it("redacts sensitive keys and values recursively", () => {
    const sanitized = sanitizePersisted(
      {
        memberId: "M-1001",
        narrative: "Opened M-1001",
        nested: { authorization: "Bearer should-never-persist" },
      },
      new Set(["memberId"]),
      new Set(["M-1001"]),
    );
    expect(JSON.stringify(sanitized)).not.toContain("M-1001");
    expect(JSON.stringify(sanitized)).not.toContain("Bearer");
    expect(sanitized).toEqual({
      memberId: "[REDACTED]",
      narrative: "Opened [REDACTED]",
      nested: { authorization: "[REDACTED]" },
    });
  });

  it("redacts long account-like digit sequences", () => {
    expect(sanitizePersisted("account 4111 1111 1111 1111")).toBe(
      "account [REDACTED-NUMERIC]",
    );
  });
});
