import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("model-free replay boundary", () => {
  it("has no OpenAI or ModelClient import", async () => {
    const source = await readFile(
      new URL("../../src/replay.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/from ["']openai/);
    expect(source).not.toMatch(/model-client/);
    expect(source).not.toMatch(/ModelClient/);
  });
});
