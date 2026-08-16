import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EvidenceWriter, sanitizePersisted } from "../../src/evidence.js";

describe("evidence sanitization", () => {
  it("returns the digest of the exact persisted JSON bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "evidence-digest-"));
    try {
      const writer = new EvidenceWriter(root, "digest-run");
      const receipt = await writer.jsonWithDigest("artifact.json", {
        stable: true,
      });
      const persisted = await readFile(path.join(root, receipt.path), "utf8");
      expect(receipt.sha256).toBe(
        createHash("sha256").update(persisted).digest("hex"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

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

  it("redacts sensitive numeric and boolean primitives under generic keys", () => {
    expect(
      sanitizePersisted(
        { count: 42, enabled: true, publicCount: 7 },
        new Set(),
        new Set(["42", "true"]),
      ),
    ).toEqual({
      count: "[REDACTED]",
      enabled: "[REDACTED]",
      publicCount: 7,
    });
  });

  it("preserves sensitive declarative schema definitions", () => {
    expect(
      sanitizePersisted(
        {
          inputSchema: {
            memberId: {
              type: "string",
              required: true,
              description: "Synthetic member identifier.",
            },
          },
          inputs: { memberId: "M-1001" },
        },
        new Set(["memberId"]),
        new Set(["M-1001"]),
      ),
    ).toEqual({
      inputSchema: {
        memberId: {
          type: "string",
          required: true,
          description: "Synthetic member identifier.",
        },
      },
      inputs: { memberId: "[REDACTED]" },
    });
  });

  it("preserves validated output bindings only inside their trusted container", () => {
    const binding = {
      kind: "scalar",
      source: {
        description: "Member reference value.",
        robustnessNote: "Anchored to stable row text.",
        candidates: [
          {
            kind: "relative",
            anchorText: "Member reference",
            relation: "following",
            elementHint: "td",
          },
        ],
        expectedCardinality: 1,
      },
      parseAs: "string",
      sensitive: true,
    } as const;

    expect(
      sanitizePersisted(
        {
          outputBindings: { memberReference: binding },
          outputs: { memberReference: binding },
        },
        new Set(["memberReference"]),
      ),
    ).toEqual({
      outputBindings: { memberReference: binding },
      outputs: { memberReference: "[REDACTED]" },
    });
  });

  it("does not treat schema-shaped secret payloads as definitions", () => {
    expect(
      sanitizePersisted({
        password: {
          type: "string",
          description: "Untrusted payload shaped like a schema.",
        },
      }),
    ).toEqual({ password: "[REDACTED]" });
  });
});
