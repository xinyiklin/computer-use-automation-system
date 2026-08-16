import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverCapability } from "../../src/discovery.js";
import {
  createDemoServer,
  type DemoServer,
} from "../../src/demo-app/server.js";
import { EvidenceWriter } from "../../src/evidence.js";
import type { InterventionRequest, Operator } from "../../src/intervention.js";
import { ScriptedModelClient } from "../../src/model-client.js";
import { createDefaultPolicy } from "../../src/policy.js";
import {
  CONTROLS,
  createPrepareSubaccountArtifact,
} from "../../src/sample-artifact.js";
import { createScriptedDiscoveryProposals } from "../../src/scripted-discovery.js";
import { PlaywrightSurfaceSession } from "../../src/surface.js";

const testRoot = path.resolve("output", "discovery-test-work");
let demo: DemoServer;

class DiscoveryTestOperator implements Operator {
  public readonly executionKind = "scripted-test-double" as const;
  public constructor(private readonly surface: PlaywrightSurfaceSession) {}
  public async takeControl(
    _request: InterventionRequest,
    _signal: AbortSignal,
  ): Promise<void> {}
  public async performManualAction(_signal: AbortSignal): Promise<string> {
    await this.surface.humanClick(CONTROLS.openAccount, () => "human");
    return "Synthetic operator opened the account-preparation form.";
  }
  public async returnControl(_signal: AbortSignal): Promise<void> {}
}

function discoveryFixture(entryUrl: string) {
  const expected = createPrepareSubaccountArtifact(entryUrl);
  return {
    expected,
    request: {
      goal: "Prepare a synthetic Savings Plus sub-account and stop at review.",
      target: {
        entryUrl,
        appFamily: "synthetic-credit-union",
        variant: "base",
      },
      inputs: {
        memberId: {
          type: "string",
          value: "M-1001",
          required: true,
          sensitive: true,
          description: "Synthetic member identifier.",
        },
        productCode: {
          type: "string",
          value: "SAV_PLUS",
          required: true,
          allowedValues: ["SAV_PLUS", "MONEY_MARKET"],
          description: "Synthetic product.",
        },
        nickname: {
          type: "string",
          value: "Discovery Test",
          required: true,
          description: "Synthetic nickname.",
        },
      },
      desiredOutputs: expected.outputSchema,
    } as const,
  };
}

beforeAll(async () => {
  await rm(testRoot, { recursive: true, force: true });
  await mkdir(testRoot, { recursive: true });
  demo = await createDemoServer();
});

afterAll(async () => {
  await demo.close();
});

describe("bounded discovery", () => {
  it("drives the live UI and emits a reusable artifact through the model seam", async () => {
    const entryUrl = `${demo.origin}/backoffice/members/search`;
    const { expected, request } = discoveryFixture(entryUrl);
    const evidence = new EvidenceWriter(testRoot, "scripted-discovery");
    const policy = createDefaultPolicy(demo.origin);
    const surface = new PlaywrightSurfaceSession(evidence, policy);
    const model = new ScriptedModelClient(
      createScriptedDiscoveryProposals(entryUrl),
    );
    const result = await discoverCapability({
      request,
      model,
      surface,
      policy,
      evidence,
    });
    expect(result.status).toBe("success");
    expect(model.calls).toBe(expected.steps.length + 1);
    if (result.status === "success") {
      expect(result.artifact.provenance.modelIdentifier).toBe(
        "scripted-model-test-double",
      );
      expect(result.artifact.steps).toHaveLength(expected.steps.length);
      expect(JSON.stringify(result.artifact)).not.toContain("M-1001");
    }
    const entrySurface = JSON.parse(
      await readFile(
        path.join(
          testRoot,
          "evidence",
          "scripted-discovery",
          "02-discovery-1-surface.json",
        ),
        "utf8",
      ),
    ) as { semanticTree: string; visibleText: string };
    expect(entrySurface.semanticTree).toContain('name="[WITHHELD]"');
    expect(entrySurface.semanticTree).not.toContain("Find a member");
    expect(entrySurface.semanticTree).not.toContain("Member ID");
    expect(entrySurface.visibleText).toBe(
      "[WITHHELD_UNBOUND_SENSITIVE_OUTPUT]",
    );
    const entryScreenshot = await readFile(
      path.join(
        testRoot,
        "evidence",
        "scripted-discovery",
        "02-discovery-1.png",
      ),
    );
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(
        `<img id="source" src="data:image/png;base64,${entryScreenshot.toString("base64")}">`,
      );
      const pixel = await page.locator("#source").evaluate((element) => {
        const image = element as HTMLImageElement;
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas context unavailable");
        context.drawImage(image, 0, 0);
        return [...context.getImageData(40, 40, 1, 1).data];
      });
      expect(pixel.slice(0, 3)).toEqual([17, 24, 39]);
    } finally {
      await browser.close();
    }
    const finalSurface = await readFile(
      path.join(
        testRoot,
        "evidence",
        "scripted-discovery",
        "08-discovery-7-surface.json",
      ),
      "utf8",
    );
    expect(finalSurface).not.toContain("Member ••1001");
    expect(finalSurface).toContain("th[role=rowheader]");
    expect(finalSurface).toContain("td[role=cell]");
    const events = await readFile(
      path.join(testRoot, "evidence", "scripted-discovery", "events.jsonl"),
      "utf8",
    );
    expect(events).toContain('"eventType":"model_transport_invoked"');
    expect(events).toContain('"transport":"scripted-test-double"');
    expect(events).toContain('"executionKind":"test-double"');
    expect(events).toContain('"kind":"scripted-test-double"');
    expect(events).toContain('"schemaValidated":true');
    expect(events).toContain('"eventType":"compatibility_verified"');
    expect(events).not.toContain("M-1001");
    if (result.status === "success") {
      const completed = events
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as {
              eventType: string;
              data: Record<string, unknown>;
            },
        )
        .find((event) => event.eventType === "run_completed");
      expect(completed?.data.artifactSha256).toBe(
        createHash("sha256")
          .update(
            await readFile(
              path.join(
                testRoot,
                "evidence",
                "scripted-discovery",
                "capability.v1.json",
              ),
            ),
          )
          .digest("hex"),
      );
      expect(completed?.data.artifactDigestKind).toBe("persisted-file-bytes");
    }
    expect(demo.state.confirmAttempts).toBe(0);
  });

  it("rejects requested compatibility metadata that does not match the live surface", async () => {
    const entryUrl = `${demo.origin}/backoffice/members/search`;
    const { request } = discoveryFixture(entryUrl);
    const mismatchedRequest = {
      ...request,
      target: {
        ...request.target,
        appFamily: "caller-supplied-wrong-application",
      },
    };
    const evidence = new EvidenceWriter(testRoot, "discovery-live-identity");
    const policy = createDefaultPolicy(demo.origin);
    const model = new ScriptedModelClient(
      createScriptedDiscoveryProposals(entryUrl),
    );
    const result = await discoverCapability({
      request: mismatchedRequest,
      model,
      surface: new PlaywrightSurfaceSession(evidence, policy),
      policy,
      evidence,
    });

    expect(result).toMatchObject({
      status: "stopped",
      code: "DISCOVERY_SURFACE_INCOMPATIBLE",
    });
    expect(model.calls).toBe(1);
  });

  it("hands a stuck discovery to a human and resumes the same session", async () => {
    const entryUrl = `${demo.origin}/backoffice/members/search`;
    const { request } = discoveryFixture(entryUrl);
    const baseProposals = createScriptedDiscoveryProposals(entryUrl);
    const proposals = [
      ...baseProposals.slice(0, 3),
      {
        kind: "stuck" as const,
        reason: "A person must choose whether to open account preparation.",
        interventionHint: "Open the new sub-account preparation form.",
        resumeCondition: {
          kind: "visible" as const,
          target: CONTROLS.accountHeading,
        },
      },
      ...baseProposals.slice(4),
    ];
    const evidence = new EvidenceWriter(
      testRoot,
      "discovery-handoff",
      new Set(["memberId"]),
      new Set(["M-1001"]),
    );
    const policy = createDefaultPolicy(demo.origin);
    const surface = new PlaywrightSurfaceSession(evidence, policy);
    const result = await discoverCapability({
      request,
      model: new ScriptedModelClient(proposals),
      surface,
      policy,
      evidence,
      operator: new DiscoveryTestOperator(surface),
    });

    expect(result.status).toBe("success");
    const events = await readFile(
      path.join(testRoot, "evidence", "discovery-handoff", "events.jsonl"),
      "utf8",
    );
    expect(events).toContain('"eventType":"control_transferred"');
    expect(events).toContain('"eventType":"human_action_recorded"');
    expect(events).toContain('"eventType":"automation_resumed"');
    expect(events).toContain(`"surfaceSessionId":"${surface.id}"`);
    expect(demo.state.confirmAttempts).toBe(0);
  });

  it("rejects completion when a declared output cannot be read", async () => {
    const entryUrl = `${demo.origin}/backoffice/members/search`;
    const { request } = discoveryFixture(entryUrl);
    const proposals = createScriptedDiscoveryProposals(entryUrl);
    const completion = proposals.at(-1);
    if (completion?.kind !== "complete") {
      throw new Error("Expected a completion proposal fixture");
    }
    completion.outputs.memberReference = {
      kind: "scalar",
      source: {
        description: "displayed member reference",
        robustnessNote: "A form label does not identify this table value.",
        candidates: [{ kind: "label", text: "Member reference", exact: true }],
        expectedCardinality: 1,
      },
      parseAs: "string",
      sensitive: true,
    };
    const evidence = new EvidenceWriter(
      testRoot,
      "invalid-output-discovery",
      new Set(["memberId"]),
      new Set(["M-1001"]),
    );
    const policy = createDefaultPolicy(demo.origin);
    const result = await discoverCapability({
      request,
      model: new ScriptedModelClient(proposals),
      surface: new PlaywrightSurfaceSession(evidence, policy),
      policy,
      evidence,
    });

    expect(result).toMatchObject({
      status: "stopped",
      code: "CONTROL_NOT_FOUND",
    });
    expect(demo.state.confirmAttempts).toBe(0);
  });

  it("redacts sensitive desired-output proposals before artifact validation", async () => {
    const entryUrl = `${demo.origin}/backoffice/members/search`;
    const { request } = discoveryFixture(entryUrl);
    const proposals = createScriptedDiscoveryProposals(entryUrl);
    const completion = proposals.at(-1);
    if (completion?.kind !== "complete") {
      throw new Error("Expected a completion proposal fixture");
    }
    const rawSensitiveOutput = "SENSITIVE-DISCOVERY-OUTPUT";
    completion.outputs.memberReference = {
      kind: "literal",
      value: rawSensitiveOutput,
    };
    const evidence = new EvidenceWriter(
      testRoot,
      "sensitive-output-proposal",
      new Set(["memberId"]),
      new Set(["M-1001"]),
    );
    const policy = createDefaultPolicy(demo.origin, {
      sensitiveInputNames: ["memberId"],
    });
    const result = await discoverCapability({
      request,
      model: new ScriptedModelClient(proposals),
      surface: new PlaywrightSurfaceSession(evidence, policy),
      policy,
      evidence,
    });

    expect(result.status).toBe("stopped");
    const events = await readFile(
      path.join(
        testRoot,
        "evidence",
        "sensitive-output-proposal",
        "events.jsonl",
      ),
      "utf8",
    );
    expect(events).not.toContain(rawSensitiveOutput);
    expect(events).toContain('"memberReference":"[REDACTED]"');
  });
});
