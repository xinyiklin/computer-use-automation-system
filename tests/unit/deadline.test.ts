import { describe, expect, it } from "vitest";
import { settleWithinDeadline, withinDeadline } from "../../src/deadline.js";

describe("hard wall-clock deadlines", () => {
  it("returns at the deadline even when work and cancellation never settle", async () => {
    let aborted = false;
    const startedAt = Date.now();
    const operation = withinDeadline(
      startedAt + 40,
      "pending-operation",
      async (signal) =>
        await new Promise<never>(() => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
        }),
      async () => await new Promise<void>(() => undefined),
    );

    await expect(operation).rejects.toMatchObject({
      code: "RUN_DEADLINE_EXCEEDED",
    });
    expect(aborted).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(250);
  });

  it("does not let cleanup extend the owning deadline", async () => {
    const startedAt = Date.now();
    await settleWithinDeadline(
      startedAt + 40,
      async () => await new Promise<void>(() => undefined),
    );
    expect(Date.now() - startedAt).toBeLessThan(250);
  });
});
