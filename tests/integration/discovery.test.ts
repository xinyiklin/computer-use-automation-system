import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverCapability } from "../../src/discovery.js";
import {
  createDemoServer,
  type DemoServer,
} from "../../src/demo-app/server.js";
import { EvidenceWriter } from "../../src/evidence.js";
import { ScriptedModelClient } from "../../src/model-client.js";
import { createDefaultPolicy } from "../../src/policy.js";
import { createPrepareSubaccountArtifact } from "../../src/sample-artifact.js";
import { createScriptedDiscoveryProposals } from "../../src/scripted-discovery.js";
import { PlaywrightSurfaceSession } from "../../src/surface.js";

const testRoot = path.resolve("output", "discovery-test-work");
let demo: DemoServer;

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
    const expected = createPrepareSubaccountArtifact(entryUrl);
    const request = {
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
    } as const;
    const evidence = new EvidenceWriter(
      testRoot,
      "scripted-discovery",
      new Set(["memberId"]),
      new Set(["M-1001"]),
    );
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
    expect(demo.state.confirmAttempts).toBe(0);
  });
});
