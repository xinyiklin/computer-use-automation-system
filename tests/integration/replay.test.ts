import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CapabilityArtifact } from "../../src/contracts.js";
import {
  createDemoServer,
  type DemoServer,
} from "../../src/demo-app/server.js";
import { EvidenceWriter } from "../../src/evidence.js";
import type { InterventionRequest, Operator } from "../../src/intervention.js";
import { createDefaultPolicy } from "../../src/policy.js";
import { replayCapability } from "../../src/replay.js";
import {
  CONTROLS,
  createPrepareSubaccountArtifact,
} from "../../src/sample-artifact.js";
import { PlaywrightSurfaceSession } from "../../src/surface.js";

const testRoot = path.resolve("output", "test-work");
let demo: DemoServer;
let artifact: CapabilityArtifact;

async function run(
  runId: string,
  inputs: Record<string, unknown>,
  selectedArtifact = artifact,
  operatorFactory?: (surface: PlaywrightSurfaceSession) => Operator,
) {
  await rm(path.join(testRoot, "evidence", runId), {
    recursive: true,
    force: true,
  });
  const evidence = new EvidenceWriter(
    testRoot,
    runId,
    new Set(["memberId"]),
    new Set([String(inputs.memberId ?? "")]),
  );
  const policy = createDefaultPolicy(demo.origin);
  const surface = new PlaywrightSurfaceSession(evidence, policy);
  return await replayCapability({
    artifact: selectedArtifact,
    inputs,
    policy,
    surface,
    evidence,
    ...(operatorFactory ? { operator: operatorFactory(surface) } : {}),
  });
}

class TestOperator implements Operator {
  public constructor(private readonly surface: PlaywrightSurfaceSession) {}
  public async takeControl(_request: InterventionRequest): Promise<void> {}
  public async performManualAction(): Promise<string> {
    await this.surface.humanClick(CONTROLS.supervisorVerified, () => "human");
    return "Synthetic test operator verified supervisor interstitial.";
  }
  public async returnControl(): Promise<void> {}
}

beforeAll(async () => {
  await mkdir(testRoot, { recursive: true });
  demo = await createDemoServer();
  artifact = createPrepareSubaccountArtifact(
    `${demo.origin}/backoffice/members/search`,
  );
});

afterAll(async () => {
  await demo.close();
});

describe("deterministic replay", () => {
  it("replays different inputs to review with typed outputs", async () => {
    const result = await run("success", {
      memberId: "M-1002",
      productCode: "MONEY_MARKET",
      nickname: "Rainy Day",
    });
    expect(result).toMatchObject({
      status: "success",
      outputs: {
        status: "ready_for_review",
        productCode: "MONEY_MARKET",
        nickname: "Rainy Day",
      },
    });
    expect(demo.state.confirmAttempts).toBe(0);
  });

  it("returns missing member as a business outcome", async () => {
    const result = await run("not-found", {
      memberId: "M-4040",
      productCode: "SAV_PLUS",
      nickname: "Unused",
    });
    expect(result).toMatchObject({
      status: "business_outcome",
      code: "MEMBER_NOT_FOUND",
    });
  });

  it("uses the declared bounded recovery without a model", async () => {
    const result = await run("recovery", {
      memberId: "M-4290",
      productCode: "SAV_PLUS",
      nickname: "Recovery",
    });
    expect(result.status).toBe("success");
    const events = await readFile(
      path.join(testRoot, "evidence", "recovery", "events.jsonl"),
      "utf8",
    );
    expect(events).toContain('"eventType":"recovery_attempt"');
    expect(events).toContain('"eventType":"recovery_policy_checked"');
    expect(events).toContain('"modelDecisionCalls":0');
  });

  it("normalizes permission denial and captures rich evidence", async () => {
    const result = await run("permission", {
      memberId: "M-4030",
      productCode: "SAV_PLUS",
      nickname: "Restricted",
    });
    expect(result).toMatchObject({
      status: "failure",
      error: {
        category: "hard_failure",
        code: "PERMISSION_DENIED",
        expected: { kind: "visible" },
        observed: { failureCode: "PERMISSION_DENIED" },
      },
    });
    if (result.status === "failure") {
      expect(result.error.evidencePaths[0]).toMatch(/\.png$/);
    }
  });

  it("blocks irreversible confirmation before a request is made", async () => {
    const unsafeArtifact: CapabilityArtifact = {
      ...artifact,
      steps: [
        ...artifact.steps,
        {
          id: "confirm",
          kind: "click",
          description: "Attempt account confirmation",
          riskClass: "irreversible",
          target: CONTROLS.confirm,
        },
      ],
    };
    const result = await run(
      "policy",
      {
        memberId: "M-1001",
        productCode: "SAV_PLUS",
        nickname: "Must Not Create",
      },
      unsafeArtifact,
    );
    expect(result).toMatchObject({
      status: "failure",
      error: { category: "policy", code: "POLICY_RISK_BLOCKED" },
    });
    expect(demo.state.confirmAttempts).toBe(0);
  });

  it("hands off and resumes in the same live session", async () => {
    const result = await run(
      "handoff",
      {
        memberId: "M-7000",
        productCode: "SAV_PLUS",
        nickname: "Supervisor",
      },
      artifact,
      (surface) => new TestOperator(surface),
    );
    expect(result.status).toBe("success");
    const events = (
      await readFile(
        path.join(testRoot, "evidence", "handoff", "events.jsonl"),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { eventType: string; data: object });
    const transferred = events.findIndex(
      (event) => event.eventType === "control_transferred",
    );
    const humanAction = events.findIndex(
      (event) => event.eventType === "human_action_recorded",
    );
    const resumed = events.findIndex(
      (event) => event.eventType === "automation_resumed",
    );
    expect(transferred).toBeGreaterThan(-1);
    expect(humanAction).toBeGreaterThan(transferred);
    expect(resumed).toBeGreaterThan(humanAction);
    expect(JSON.stringify(events[transferred]?.data)).toContain(
      surfaceId(events),
    );
  });
});

function surfaceId(events: Array<{ eventType: string; data: object }>): string {
  const event = events.find(
    (candidate) => candidate.eventType === "control_transferred",
  );
  const value = (event?.data as { surfaceSessionId?: string }).surfaceSessionId;
  expect(value).toBeTruthy();
  return value ?? "missing";
}
