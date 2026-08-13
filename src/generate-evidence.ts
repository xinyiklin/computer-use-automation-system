import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CapabilityArtifact } from "./contracts.js";
import { discoverCapability } from "./discovery.js";
import { createDemoServer } from "./demo-app/server.js";
import { EvidenceWriter } from "./evidence.js";
import type { InterventionRequest, Operator } from "./intervention.js";
import { ScriptedModelClient } from "./model-client.js";
import { createDefaultPolicy } from "./policy.js";
import { replayCapability } from "./replay.js";
import {
  CONTROLS,
  createPrepareSubaccountArtifact,
} from "./sample-artifact.js";
import { createScriptedDiscoveryProposals } from "./scripted-discovery.js";
import { PlaywrightSurfaceSession } from "./surface.js";

const repositoryRoot = process.cwd();

async function resetRun(name: string): Promise<void> {
  await rm(path.join(repositoryRoot, "evidence", name), {
    recursive: true,
    force: true,
  });
}

async function runReplay(
  name: string,
  artifact: CapabilityArtifact,
  inputs: Record<string, unknown>,
  operatorFactory?: (surface: PlaywrightSurfaceSession) => Operator,
) {
  await resetRun(name);
  const sensitiveValues = new Set([String(inputs.memberId ?? "")]);
  const evidence = new EvidenceWriter(
    repositoryRoot,
    name,
    new Set(["memberId"]),
    sensitiveValues,
  );
  const origin = artifact.compatibility.allowedOrigins[0];
  if (!origin) throw new Error("Artifact origin is missing");
  const policy = createDefaultPolicy(origin);
  const surface = new PlaywrightSurfaceSession(evidence, policy);
  return await replayCapability({
    artifact,
    inputs,
    policy,
    surface,
    evidence,
    ...(operatorFactory === undefined
      ? {}
      : { operator: operatorFactory(surface) }),
  });
}

class ScriptedOperator implements Operator {
  public constructor(private readonly surface: PlaywrightSurfaceSession) {}
  public async takeControl(_request: InterventionRequest): Promise<void> {}
  public async performManualAction(): Promise<string> {
    await this.surface.humanClick(CONTROLS.supervisorVerified, () => "human");
    return "Test operator selected the synthetic supervisor verification control; no field values recorded.";
  }
  public async returnControl(): Promise<void> {}
}

const demo = await createDemoServer();
try {
  const entryUrl = `${demo.origin}/backoffice/members/search`;
  const artifact = createPrepareSubaccountArtifact(entryUrl);
  const publicArtifact = createPrepareSubaccountArtifact(
    "http://127.0.0.1:4317/backoffice/members/search",
  );
  await mkdir(path.join(repositoryRoot, "artifacts"), { recursive: true });
  await writeFile(
    path.join(repositoryRoot, "artifacts", "prepare-subaccount.v1.json"),
    `${JSON.stringify(publicArtifact, null, 2)}\n`,
    "utf8",
  );

  await resetRun("discovery-scripted");
  const discoveryRequest = {
    goal: "Prepare a Savings Plus sub-account with nickname Discovery Sample for synthetic member M-1001 and stop at review.",
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
        description: "Synthetic product code.",
      },
      nickname: {
        type: "string",
        value: "Discovery Sample",
        required: true,
        description: "Synthetic review nickname.",
      },
    },
    desiredOutputs: artifact.outputSchema,
  } as const;
  const discoveryEvidence = new EvidenceWriter(
    repositoryRoot,
    "discovery-scripted",
    new Set(["memberId"]),
    new Set(["M-1001"]),
  );
  const discoveryPolicy = createDefaultPolicy(demo.origin);
  const discoverySurface = new PlaywrightSurfaceSession(
    discoveryEvidence,
    discoveryPolicy,
  );
  const scriptedModel = new ScriptedModelClient(
    createScriptedDiscoveryProposals(entryUrl),
  );
  const discovery = await discoverCapability({
    request: discoveryRequest,
    model: scriptedModel,
    surface: discoverySurface,
    policy: discoveryPolicy,
    evidence: discoveryEvidence,
  });
  if (discovery.status !== "success") {
    throw new Error(`Scripted discovery failed: ${discovery.code}`);
  }

  const results = {
    discoveryScripted: discovery.status,
    replaySuccess: await runReplay("replay-success", artifact, {
      memberId: "M-1002",
      productCode: "MONEY_MARKET",
      nickname: "Rainy Day",
    }),
    businessOutcome: await runReplay("replay-business-outcome", artifact, {
      memberId: "M-4040",
      productCode: "SAV_PLUS",
      nickname: "Not Used",
    }),
    recovery: await runReplay("replay-recovery", artifact, {
      memberId: "M-4290",
      productCode: "SAV_PLUS",
      nickname: "Recovery Sample",
    }),
    hardFailure: await runReplay("replay-hard-failure", artifact, {
      memberId: "M-4030",
      productCode: "SAV_PLUS",
      nickname: "Restricted",
    }),
    handoff: await runReplay(
      "human-handoff-automated",
      artifact,
      {
        memberId: "M-7000",
        productCode: "SAV_PLUS",
        nickname: "Supervisor Sample",
      },
      (surface) => new ScriptedOperator(surface),
    ),
  };

  const blockedArtifact: CapabilityArtifact = {
    ...artifact,
    steps: [
      ...artifact.steps,
      {
        id: "confirm-account",
        kind: "click",
        description: "Attempt the final account creation for policy evidence.",
        riskClass: "irreversible",
        target: CONTROLS.confirm,
      },
    ],
  };
  const policyBlock = await runReplay("replay-policy-block", blockedArtifact, {
    memberId: "M-1001",
    productCode: "SAV_PLUS",
    nickname: "Must Not Create",
  });
  const manifest = {
    generatedAt: new Date().toISOString(),
    note: "All runs are local, synthetic, and key-free. discovery-scripted is explicitly a test-double run, not genuine LLM evidence.",
    modelDecisionCallsDuringReplay: 0,
    serverConfirmAttempts: demo.state.confirmAttempts,
    results: { ...results, policyBlock },
  };
  await writeFile(
    path.join(repositoryRoot, "evidence", "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
} finally {
  await demo.close();
}
