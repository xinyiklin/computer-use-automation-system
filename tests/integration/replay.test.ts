import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AutomationPolicy,
  CapabilityArtifact,
  ControlRef,
} from "../../src/contracts.js";
import { parseCapabilityArtifact } from "../../src/contracts.js";
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
  policyOptions: {
    maxRunMs?: number;
    allowedRoutePatterns?: string[];
  } = {},
) {
  await rm(path.join(testRoot, "evidence", runId), {
    recursive: true,
    force: true,
  });
  const evidence = new EvidenceWriter(testRoot, runId);
  const policy: AutomationPolicy = {
    ...createDefaultPolicy(demo.origin, policyOptions),
    ...(policyOptions.allowedRoutePatterns === undefined
      ? {}
      : { allowedRoutePatterns: policyOptions.allowedRoutePatterns }),
  };
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
  public readonly executionKind = "scripted-test-double" as const;
  public constructor(private readonly surface: PlaywrightSurfaceSession) {}
  public async takeControl(
    _request: InterventionRequest,
    _signal: AbortSignal,
  ): Promise<void> {}
  public async performManualAction(_signal: AbortSignal): Promise<string> {
    await this.surface.humanClick(CONTROLS.supervisorVerified, () => "human");
    return "Synthetic test operator verified supervisor interstitial.";
  }
  public async returnControl(_signal: AbortSignal): Promise<void> {}
}

class HangingOperator implements Operator {
  public readonly executionKind = "scripted-test-double" as const;
  public aborted = false;
  public async takeControl(
    _request: InterventionRequest,
    _signal: AbortSignal,
  ): Promise<void> {}
  public async performManualAction(signal: AbortSignal): Promise<string> {
    return await new Promise<string>((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          this.aborted = true;
          reject(signal.reason);
        },
        { once: true },
      );
    });
  }
  public async returnControl(_signal: AbortSignal): Promise<void> {}
}

function control(description: string, selector: string): ControlRef {
  return {
    description,
    robustnessNote: "Dedicated local integration fixture control.",
    candidates: [{ kind: "css", selector }],
    expectedCardinality: 1,
  };
}

function fixturePage(body: string, appFamily = "synthetic-credit-union") {
  return `<!doctype html><html data-automation-surface-kind="web" data-automation-app-family="${appFamily}" data-automation-variant="base"><head><title>Fixture</title></head><body><main>${body}</main></body></html>`;
}

beforeAll(async () => {
  await mkdir(testRoot, { recursive: true });
  demo = await createDemoServer();
  artifact = createPrepareSubaccountArtifact(
    `${demo.origin}/backoffice/members/search`,
  );
  demo.app.get("/backoffice/test/aria-policy", (_request, response) =>
    response.send(
      fixturePage(
        '<span id="blocked-label" style="position:absolute;clip:rect(0 0 0 0)">Confirm account creation</span><button id="guarded" aria-labelledby="blocked-label">Continue</button>',
      ),
    ),
  );
  demo.app.get("/backoffice/test/origin-start", (_request, response) =>
    response.send(
      fixturePage(
        '<a id="leave" href="http://127.0.0.1:1/backoffice/members/search">Leave fixture</a>',
      ),
    ),
  );
  demo.app.get("/backoffice/test/popup-start", (_request, response) =>
    response.send(
      fixturePage(
        '<a id="popup" target="_blank" href="http://127.0.0.1:1/backoffice/members/search">Open second surface</a>',
      ),
    ),
  );
  demo.app.get("/backoffice/test/identity-start", (_request, response) =>
    response.send(
      fixturePage(
        '<a id="drift" href="/backoffice/test/identity-drift">Continue</a>',
      ),
    ),
  );
  demo.app.get("/backoffice/test/identity-drift", (_request, response) =>
    response.send(fixturePage("<h1>Different application</h1>", "other-app")),
  );
  demo.app.get("/backoffice/test/sensitive-mask", (_request, response) =>
    response.send(
      fixturePage(
        '<h1>Mask fixture</h1><label for="customer-key">Customer key</label><input id="customer-key" name="customerKey" value="Secret-42">',
      ),
    ),
  );
  demo.app.get("/backoffice/test/sensitive-output", (_request, response) =>
    response.send(
      fixturePage(
        "<h1>Private result</h1><table><tr><th>Secret result</th><td>PRIVATE-RESULT-42</td></tr></table>",
      ),
    ),
  );
  demo.app.get("/backoffice/test/broad-output", (_request, response) =>
    response.send(
      fixturePage(
        "<h1>Broad output fixture</h1><table><tr><th>Summary</th><td><section>PRIVATE-BROAD-CONTENT</section></td></tr></table>",
      ),
    ),
  );
  demo.app.get(
    "/backoffice/test/sensitive-name-mismatch",
    (_request, response) =>
      response.send(
        fixturePage(
          '<style>body{margin:0}#unrelated{position:fixed;left:20px;top:20px;width:200px;height:60px}</style><input id="unrelated" name="unrelatedDomName" aria-label="Access reference">',
        ),
      ),
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
    const persisted = JSON.parse(
      await readFile(
        path.join(testRoot, "evidence", "success", "result.json"),
        "utf8",
      ),
    ) as { outputs: { memberReference: string } };
    expect(persisted.outputs.memberReference).toBe("[REDACTED]");
    const persistedSurface = await readFile(
      path.join(testRoot, "evidence", "success", "01-success-surface.json"),
      "utf8",
    );
    expect(persistedSurface).not.toContain("Member ••1002");
    const events = (
      await readFile(
        path.join(testRoot, "evidence", "success", "events.jsonl"),
        "utf8",
      )
    )
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { eventType: string; data: object });
    const started = events.find((event) => event.eventType === "run_started");
    expect(started?.data).toMatchObject({
      artifactDiscoveryRunId: artifact.provenance.discoveryRunId,
      artifactSha256: createHash("sha256")
        .update(JSON.stringify(parseCapabilityArtifact(artifact)))
        .digest("hex"),
      artifactDigestKind: "canonical-json",
    });
    expect(demo.state.confirmAttempts).toBe(0);
  });

  it("rejects a capability whose declared application identity is wrong", async () => {
    const incompatibleArtifact: CapabilityArtifact = {
      ...artifact,
      compatibility: {
        ...artifact.compatibility,
        appFamily: "different-servicing-application",
      },
    };
    const result = await run(
      "incompatible-identity",
      {
        memberId: "M-1002",
        productCode: "MONEY_MARKET",
        nickname: "Rainy Day",
      },
      incompatibleArtifact,
    );

    expect(result).toMatchObject({
      status: "failure",
      error: { code: "SURFACE_INCOMPATIBLE" },
    });
  });

  it("enforces the replay wall-clock bound inside a waiting action", async () => {
    const boundedArtifact: CapabilityArtifact = {
      ...artifact,
      steps: [
        artifact.steps[0]!,
        {
          id: "wait-for-impossible-route",
          kind: "waitFor",
          description: "Wait for a route that never appears.",
          riskClass: "safe",
          condition: { kind: "url_matches", pattern: "^/never$" },
        },
      ],
    };
    const startedAt = Date.now();
    const result = await run(
      "bounded-wait",
      {
        memberId: "M-1002",
        productCode: "MONEY_MARKET",
        nickname: "Rainy Day",
      },
      boundedArtifact,
      undefined,
      { maxRunMs: 250 },
    );

    expect(result).toMatchObject({
      status: "failure",
      error: { code: "RUN_DEADLINE_EXCEEDED" },
    });
    expect(Date.now() - startedAt).toBeLessThan(1_500);
  });

  it("cancels a pending browser launch at the wall-clock deadline", async () => {
    let releaseLaunch: ((browser: Browser) => void) | undefined;
    const pendingLaunch = new Promise<Browser>((resolve) => {
      releaseLaunch = resolve;
    });
    let closed = false;
    const fakeBrowser = {
      close: async () => {
        closed = true;
      },
    } as unknown as Browser;
    const evidence = new EvidenceWriter(testRoot, "bounded-start");
    const policy: AutomationPolicy = {
      ...createDefaultPolicy(demo.origin),
      maxRunMs: 75,
    };
    const startedAt = Date.now();
    const result = await replayCapability({
      artifact,
      inputs: {
        memberId: "M-1002",
        productCode: "MONEY_MARKET",
        nickname: "Rainy Day",
      },
      policy,
      surface: new PlaywrightSurfaceSession(evidence, policy, {
        launchBrowser: () => pendingLaunch,
      }),
      evidence,
    });

    expect(result).toMatchObject({
      status: "failure",
      error: { code: "RUN_DEADLINE_EXCEEDED" },
    });
    expect(Date.now() - startedAt).toBeLessThan(750);
    releaseLaunch?.(fakeBrowser);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).toBe(true);
  });

  it("closes a browser context that resolves after startup cancellation", async () => {
    let releaseContext: ((context: BrowserContext) => void) | undefined;
    const pendingContext = new Promise<BrowserContext>((resolve) => {
      releaseContext = resolve;
    });
    let contextClosed = false;
    const fakeBrowser = {
      close: async () => undefined,
    } as unknown as Browser;
    const lateContext = {
      close: async () => {
        contextClosed = true;
      },
    } as unknown as BrowserContext;
    const evidence = new EvidenceWriter(testRoot, "bounded-context-start");
    const policy: AutomationPolicy = {
      ...createDefaultPolicy(demo.origin),
      maxRunMs: 75,
    };
    const result = await replayCapability({
      artifact,
      inputs: {
        memberId: "M-1002",
        productCode: "MONEY_MARKET",
        nickname: "Rainy Day",
      },
      policy,
      surface: new PlaywrightSurfaceSession(evidence, policy, {
        launchBrowser: async () => fakeBrowser,
        createContext: async () => await pendingContext,
      }),
      evidence,
    });

    expect(result).toMatchObject({
      status: "failure",
      error: { code: "RUN_DEADLINE_EXCEEDED" },
    });
    releaseContext?.(lateContext);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(contextClosed).toBe(true);
  });

  it("closes a page that resolves after startup cancellation", async () => {
    let releasePage: ((page: Page) => void) | undefined;
    const pendingPage = new Promise<Page>((resolve) => {
      releasePage = resolve;
    });
    let pageClosed = false;
    const fakeBrowser = {
      close: async () => undefined,
    } as unknown as Browser;
    const fakeContext = {
      route: async () => undefined,
      close: async () => undefined,
    } as unknown as BrowserContext;
    const latePage = {
      close: async () => {
        pageClosed = true;
      },
    } as unknown as Page;
    const evidence = new EvidenceWriter(testRoot, "bounded-page-start");
    const policy: AutomationPolicy = {
      ...createDefaultPolicy(demo.origin),
      maxRunMs: 75,
    };
    const result = await replayCapability({
      artifact,
      inputs: {
        memberId: "M-1002",
        productCode: "MONEY_MARKET",
        nickname: "Rainy Day",
      },
      policy,
      surface: new PlaywrightSurfaceSession(evidence, policy, {
        launchBrowser: async () => fakeBrowser,
        createContext: async () => fakeContext,
        createPage: async () => await pendingPage,
      }),
      evidence,
    });

    expect(result).toMatchObject({
      status: "failure",
      error: { code: "RUN_DEADLINE_EXCEEDED" },
    });
    releasePage?.(latePage);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(pageClosed).toBe(true);
  });

  it("attempts browser shutdown even when context shutdown hangs", async () => {
    let browserClosed = false;
    const fakeBrowser = {
      close: async () => {
        browserClosed = true;
      },
    } as unknown as Browser;
    const fakeContext = {
      route: async () => undefined,
      on: () => undefined,
      close: async () => await new Promise<void>(() => undefined),
    } as unknown as BrowserContext;
    const fakePage = {} as Page;
    const evidence = new EvidenceWriter(testRoot, "hanging-context-close");
    const policy = createDefaultPolicy(demo.origin);
    const surface = new PlaywrightSurfaceSession(evidence, policy, {
      launchBrowser: async () => fakeBrowser,
      createContext: async () => fakeContext,
      createPage: async () => fakePage,
    });
    await surface.start();

    void surface.close();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(browserClosed).toBe(true);
  });

  it("re-checks automation ownership after resolving a control", async () => {
    const evidence = new EvidenceWriter(testRoot, "ownership-recheck");
    const policy = createDefaultPolicy(demo.origin);
    const surface = new PlaywrightSurfaceSession(evidence, policy);
    await surface.start();
    try {
      await surface.execute(
        artifact.steps[0]!,
        {},
        policy,
        () => "automation",
        Date.now() + 5_000,
      );
      let ownershipChecks = 0;
      await expect(
        surface.execute(
          {
            id: "ownership-transition",
            kind: "click",
            description: "Attempt search after ownership changes.",
            riskClass: "safe",
            target: CONTROLS.search,
          },
          {},
          policy,
          () => {
            ownershipChecks += 1;
            return ownershipChecks === 1 ? "automation" : "human";
          },
          Date.now() + 5_000,
        ),
      ).rejects.toThrow(/while human owns control/);
    } finally {
      await surface.close();
    }
  });

  it("blocks a resolved control whose accessible name comes from aria-labelledby", async () => {
    const evidence = new EvidenceWriter(testRoot, "aria-policy");
    const policy: AutomationPolicy = {
      ...createDefaultPolicy(demo.origin),
      allowedRoutePatterns: ["^/backoffice/test/aria-policy$"],
    };
    const surface = new PlaywrightSurfaceSession(evidence, policy);
    await surface.start();
    try {
      await surface.execute(
        {
          id: "fixture-entry",
          kind: "navigate",
          description: "Open the local policy fixture.",
          riskClass: "safe",
          url: {
            kind: "literal",
            value: `${demo.origin}/backoffice/test/aria-policy`,
          },
        },
        {},
        policy,
        () => "automation",
        Date.now() + 5_000,
      );
      await expect(
        surface.execute(
          {
            id: "guarded-action",
            kind: "click",
            description: "Continue from the fixture.",
            riskClass: "safe",
            target: control("Generic fixture action.", "#guarded"),
          },
          {},
          policy,
          () => "automation",
          Date.now() + 5_000,
        ),
      ).rejects.toThrow(/independently blocked/);
    } finally {
      await surface.close();
    }
  });

  it("uses the artifact-intersected origin policy for click-triggered navigation", async () => {
    const fixtureLink = control("Fixture exit link.", "#leave");
    const selectedArtifact: CapabilityArtifact = {
      ...artifact,
      compatibility: {
        ...artifact.compatibility,
        allowedOrigins: [demo.origin],
        entryRoutePattern: "^/backoffice/test/origin-start$",
        requiredLandmarks: [{ kind: "visible", target: fixtureLink }],
      },
      steps: [
        {
          id: "fixture-entry",
          kind: "navigate",
          description: "Open the origin-policy fixture.",
          riskClass: "safe",
          url: {
            kind: "literal",
            value: `${demo.origin}/backoffice/test/origin-start`,
          },
        },
        {
          id: "leave-fixture",
          kind: "click",
          description: "Follow the fixture link.",
          riskClass: "safe",
          target: fixtureLink,
        },
      ],
    };
    const evidence = new EvidenceWriter(testRoot, "intersected-origin");
    const configuredPolicy: AutomationPolicy = {
      ...createDefaultPolicy(demo.origin),
      allowedOrigins: [demo.origin, "http://127.0.0.1:1"],
      allowedRoutePatterns: [
        "^/backoffice/test/origin-start$",
        "^/backoffice/members/search$",
      ],
    };
    const surface = new PlaywrightSurfaceSession(evidence, configuredPolicy);
    const result = await replayCapability({
      artifact: selectedArtifact,
      inputs: {
        memberId: "M-1002",
        productCode: "MONEY_MARKET",
        nickname: "Rainy Day",
      },
      policy: configuredPolicy,
      surface,
      evidence,
    });

    expect(result).toMatchObject({
      status: "failure",
      error: { category: "policy", code: "POLICY_ORIGIN_BLOCKED" },
    });
  });

  it("blocks and closes popup-created surfaces", async () => {
    const popup = control("Popup fixture link.", "#popup");
    const selectedArtifact: CapabilityArtifact = {
      ...artifact,
      compatibility: {
        ...artifact.compatibility,
        entryRoutePattern: "^/backoffice/test/popup-start$",
        requiredLandmarks: [{ kind: "visible", target: popup }],
      },
      steps: [
        {
          id: "popup-entry",
          kind: "navigate",
          description: "Open the popup fixture.",
          riskClass: "safe",
          url: {
            kind: "literal",
            value: `${demo.origin}/backoffice/test/popup-start`,
          },
        },
        {
          id: "open-popup",
          kind: "click",
          description: "Attempt to open a second browser surface.",
          riskClass: "safe",
          target: popup,
        },
      ],
    };
    const evidence = new EvidenceWriter(testRoot, "popup-policy");
    const policy: AutomationPolicy = {
      ...createDefaultPolicy(demo.origin),
      allowedRoutePatterns: [
        "^/backoffice/test/popup-start$",
        "^/backoffice/members/search$",
      ],
    };
    const result = await replayCapability({
      artifact: selectedArtifact,
      inputs: {
        memberId: "M-1002",
        productCode: "MONEY_MARKET",
        nickname: "Rainy Day",
      },
      policy,
      surface: new PlaywrightSurfaceSession(evidence, policy),
      evidence,
    });

    expect(result).toMatchObject({
      status: "failure",
      error: { category: "policy", code: "POLICY_POPUP_BLOCKED" },
    });
  });

  it("re-checks application identity after every action", async () => {
    const fixtureLink = control("Identity drift link.", "#drift");
    const selectedArtifact: CapabilityArtifact = {
      ...artifact,
      compatibility: {
        ...artifact.compatibility,
        entryRoutePattern: "^/backoffice/test/identity-start$",
        requiredLandmarks: [{ kind: "visible", target: fixtureLink }],
      },
      steps: [
        {
          id: "identity-entry",
          kind: "navigate",
          description: "Open the identity fixture.",
          riskClass: "safe",
          url: {
            kind: "literal",
            value: `${demo.origin}/backoffice/test/identity-start`,
          },
        },
        {
          id: "identity-drift",
          kind: "click",
          description: "Enter a same-origin incompatible application.",
          riskClass: "safe",
          target: fixtureLink,
        },
      ],
    };
    const evidence = new EvidenceWriter(testRoot, "identity-drift");
    const policy: AutomationPolicy = {
      ...createDefaultPolicy(demo.origin),
      allowedRoutePatterns: [
        "^/backoffice/test/identity-start$",
        "^/backoffice/test/identity-drift$",
      ],
    };
    const result = await replayCapability({
      artifact: selectedArtifact,
      inputs: {
        memberId: "M-1002",
        productCode: "MONEY_MARKET",
        nickname: "Rainy Day",
      },
      policy,
      surface: new PlaywrightSurfaceSession(evidence, policy),
      evidence,
    });

    expect(result).toMatchObject({
      status: "failure",
      error: { code: "SURFACE_INCOMPATIBLE" },
    });
  });

  it("masks dynamically declared sensitive input names in surface evidence", async () => {
    const evidence = new EvidenceWriter(testRoot, "dynamic-sensitive-mask");
    const policy: AutomationPolicy = {
      ...createDefaultPolicy(demo.origin, {
        sensitiveInputNames: ["customerKey"],
      }),
      allowedRoutePatterns: ["^/backoffice/test/sensitive-mask$"],
    };
    const surface = new PlaywrightSurfaceSession(evidence, policy);
    await surface.start();
    try {
      await surface.execute(
        {
          id: "sensitive-fixture-entry",
          kind: "navigate",
          description: "Open the sensitive-value fixture.",
          riskClass: "safe",
          url: {
            kind: "literal",
            value: `${demo.origin}/backoffice/test/sensitive-mask`,
          },
        },
        {},
        policy,
        () => "automation",
        Date.now() + 5_000,
      );
      await surface.observe("dynamic-sensitive");
    } finally {
      await surface.close();
    }
    const persistedSurface = await readFile(
      path.join(
        testRoot,
        "evidence",
        "dynamic-sensitive-mask",
        "01-dynamic-sensitive-surface.json",
      ),
      "utf8",
    );
    expect(persistedSurface).not.toContain("Secret-42");
  });

  it("derives direct-API sensitive input redaction inside replay", async () => {
    const heading = control("Mask fixture heading.", "h1");
    const selectedArtifact: CapabilityArtifact = {
      ...artifact,
      compatibility: {
        ...artifact.compatibility,
        entryRoutePattern: "^/backoffice/test/sensitive-mask$",
        requiredLandmarks: [{ kind: "visible", target: heading }],
      },
      inputSchema: {
        customerKey: {
          type: "string",
          required: true,
          sensitive: true,
          description: "Synthetic customer key.",
        },
      },
      outputSchema: {
        status: {
          type: "string",
          constant: "visible",
          description: "Fixture status.",
        },
      },
      outputBindings: {
        status: { kind: "literal", value: "visible" },
      },
      steps: [
        {
          id: "open-sensitive-input",
          kind: "navigate",
          description: "Open the sensitive-input fixture.",
          riskClass: "safe",
          url: {
            kind: "literal",
            value: `${demo.origin}/backoffice/test/sensitive-mask`,
          },
        },
      ],
      businessOutcomes: [],
      success: { kind: "visible", target: heading },
    };
    const result = await run(
      "engine-sensitive-input",
      { customerKey: "Secret-42" },
      selectedArtifact,
      undefined,
      { allowedRoutePatterns: ["^/backoffice/test/sensitive-mask$"] },
    );

    expect(result.status).toBe("success");
    const runDirectory = path.join(
      testRoot,
      "evidence",
      "engine-sensitive-input",
    );
    const persisted = [
      await readFile(path.join(runDirectory, "events.jsonl"), "utf8"),
      await readFile(path.join(runDirectory, "result.json"), "utf8"),
      await readFile(
        path.join(runDirectory, "01-success-surface.json"),
        "utf8",
      ),
    ].join("\n");
    expect(persisted).not.toContain("Secret-42");
    expect(persisted).toContain('"customerKey":"[REDACTED]"');
  });

  it("masks a sensitive input value when its DOM name differs from the contract", async () => {
    const target = control("Unrelated DOM field.", "#unrelated");
    const secret = "PRIVATE-CUSTOMER-42";
    const selectedArtifact: CapabilityArtifact = {
      ...artifact,
      compatibility: {
        ...artifact.compatibility,
        entryRoutePattern: "^/backoffice/test/sensitive-name-mismatch$",
        requiredLandmarks: [{ kind: "visible", target }],
      },
      inputSchema: {
        customerKey: {
          type: "string",
          required: true,
          sensitive: true,
          description: "Synthetic private customer key.",
        },
      },
      outputSchema: {
        status: {
          type: "string",
          constant: "filled",
          description: "Fixture completion status.",
        },
      },
      outputBindings: {
        status: { kind: "literal", value: "filled" },
      },
      steps: [
        {
          id: "open-name-mismatch",
          kind: "navigate",
          description: "Open the mismatched-name fixture.",
          riskClass: "safe",
          url: {
            kind: "literal",
            value: `${demo.origin}/backoffice/test/sensitive-name-mismatch`,
          },
        },
        {
          id: "fill-name-mismatch",
          kind: "fill",
          description: "Fill a differently named DOM control.",
          riskClass: "reversible",
          target,
          value: { kind: "input", name: "customerKey" },
        },
      ],
      businessOutcomes: [],
      success: {
        kind: "value_equals",
        target,
        value: { kind: "input", name: "customerKey" },
      },
    };
    const result = await run(
      "sensitive-name-mismatch",
      { customerKey: secret },
      selectedArtifact,
      undefined,
      {
        allowedRoutePatterns: ["^/backoffice/test/sensitive-name-mismatch$"],
      },
    );

    expect(result.status).toBe("success");
    const runDirectory = path.join(
      testRoot,
      "evidence",
      "sensitive-name-mismatch",
    );
    const persisted = await readFile(
      path.join(runDirectory, "01-success-surface.json"),
      "utf8",
    );
    expect(persisted).not.toContain(secret);

    const screenshot = await readFile(
      path.join(runDirectory, "01-success.png"),
    );
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(
        `<img id="source" src="data:image/png;base64,${screenshot.toString("base64")}">`,
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
  });

  it("masks an unmarked declared-sensitive output before final observation", async () => {
    const heading = control("Private result heading.", "h1");
    const selectedArtifact: CapabilityArtifact = {
      ...artifact,
      compatibility: {
        ...artifact.compatibility,
        entryRoutePattern: "^/backoffice/test/sensitive-output$",
        requiredLandmarks: [{ kind: "visible", target: heading }],
      },
      outputSchema: {
        secretResult: {
          type: "string",
          sensitive: true,
          description: "A sensitive result without application markup.",
        },
      },
      outputBindings: {
        secretResult: {
          kind: "scalar",
          source: {
            description: "Secret result table value.",
            robustnessNote: "Stable row heading identifies the adjacent value.",
            candidates: [
              {
                kind: "relative",
                anchorText: "Secret result",
                relation: "following",
                elementHint: "td",
              },
            ],
            expectedCardinality: 1,
          },
          parseAs: "string",
          sensitive: true,
        },
      },
      steps: [
        {
          id: "open-private-result",
          kind: "navigate",
          description: "Open the private-result fixture.",
          riskClass: "safe",
          url: {
            kind: "literal",
            value: `${demo.origin}/backoffice/test/sensitive-output`,
          },
        },
      ],
      businessOutcomes: [],
      success: { kind: "visible", target: heading },
    };
    const result = await run(
      "sensitive-output-mask",
      {
        memberId: "M-1002",
        productCode: "MONEY_MARKET",
        nickname: "Rainy Day",
      },
      selectedArtifact,
      undefined,
      { allowedRoutePatterns: ["^/backoffice/test/sensitive-output$"] },
    );

    expect(result).toMatchObject({
      status: "success",
      outputs: { secretResult: "PRIVATE-RESULT-42" },
    });
    const persistedSurface = await readFile(
      path.join(
        testRoot,
        "evidence",
        "sensitive-output-mask",
        "01-success-surface.json",
      ),
      "utf8",
    );
    expect(persistedSurface).not.toContain("PRIVATE-RESULT-42");
    const persistedResult = await readFile(
      path.join(testRoot, "evidence", "sensitive-output-mask", "result.json"),
      "utf8",
    );
    expect(persistedResult).not.toContain("PRIVATE-RESULT-42");
  });

  it("rejects a structured container as a scalar output source", async () => {
    const heading = control("Broad output heading.", "h1");
    const selectedArtifact: CapabilityArtifact = {
      ...artifact,
      compatibility: {
        ...artifact.compatibility,
        entryRoutePattern: "^/backoffice/test/broad-output$",
        requiredLandmarks: [{ kind: "visible", target: heading }],
      },
      outputSchema: {
        summary: {
          type: "string",
          description: "A scalar summary value.",
        },
      },
      outputBindings: {
        summary: {
          kind: "scalar",
          source: {
            description: "Summary table container.",
            robustnessNote:
              "The stable row heading identifies the adjacent table cell.",
            candidates: [
              {
                kind: "relative",
                anchorText: "Summary",
                relation: "following",
                elementHint: "td",
              },
            ],
            expectedCardinality: 1,
          },
          parseAs: "string",
        },
      },
      steps: [
        {
          id: "open-broad-output",
          kind: "navigate",
          description: "Open the broad-output fixture.",
          riskClass: "safe",
          url: {
            kind: "literal",
            value: `${demo.origin}/backoffice/test/broad-output`,
          },
        },
      ],
      businessOutcomes: [],
      success: { kind: "visible", target: heading },
    };
    const result = await run(
      "broad-output-rejected",
      {
        memberId: "M-1002",
        productCode: "MONEY_MARKET",
        nickname: "Rainy Day",
      },
      selectedArtifact,
      undefined,
      { allowedRoutePatterns: ["^/backoffice/test/broad-output$"] },
    );

    expect(result).toMatchObject({
      status: "failure",
      error: { category: "invalid_artifact", code: "OUTPUT_SOURCE_UNSAFE" },
    });
    const persistedResult = await readFile(
      path.join(testRoot, "evidence", "broad-output-rejected", "result.json"),
      "utf8",
    );
    expect(persistedResult).not.toContain("PRIVATE-BROAD-CONTENT");
  });

  it("does not persist a raw sensitive value when output parsing fails", async () => {
    const invalidOutputArtifact: CapabilityArtifact = {
      ...artifact,
      outputSchema: {
        ...artifact.outputSchema,
        memberReference: {
          type: "number",
          sensitive: true,
          description: "Synthetic member reference parsed as a number.",
        },
      },
      outputBindings: {
        ...artifact.outputBindings,
        memberReference: {
          kind: "scalar",
          source: CONTROLS.memberReference,
          parseAs: "number",
          sensitive: true,
        },
      },
    };
    const result = await run(
      "sensitive-output-parse",
      {
        memberId: "M-1002",
        productCode: "MONEY_MARKET",
        nickname: "Rainy Day",
      },
      invalidOutputArtifact,
    );
    expect(result).toMatchObject({
      status: "failure",
      error: { code: "OUTPUT_PARSE_FAILED" },
    });
    const runDirectory = path.join(
      testRoot,
      "evidence",
      "sensitive-output-parse",
    );
    const persisted = await readFile(
      path.join(runDirectory, "result.json"),
      "utf8",
    );
    const events = await readFile(
      path.join(runDirectory, "events.jsonl"),
      "utf8",
    );
    expect(persisted).not.toContain("Member ••1002");
    expect(events).not.toContain("Member ••1002");
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

  it("blocks a disguised safe action after resolving the actual control", async () => {
    const disguisedArtifact: CapabilityArtifact = {
      ...artifact,
      steps: [
        ...artifact.steps,
        {
          id: "continue",
          kind: "click",
          description: "Continue from review.",
          riskClass: "safe",
          target: {
            description: "Primary review action.",
            robustnessNote:
              "Generic metadata must not bypass resolved-element policy.",
            candidates: [{ kind: "css", selector: "button.danger" }],
            expectedCardinality: 1,
          },
        },
      ],
    };
    const result = await run(
      "resolved-policy",
      {
        memberId: "M-1001",
        productCode: "SAV_PLUS",
        nickname: "Must Not Create",
      },
      disguisedArtifact,
    );
    expect(result).toMatchObject({
      status: "failure",
      error: { category: "policy", code: "POLICY_CONTROL_BLOCKED" },
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
    expect(JSON.stringify(events[transferred]?.data)).toContain(
      '"operatorExecutionKind":"scripted-test-double"',
    );
    expect(JSON.stringify(events[transferred]?.data)).toContain(
      '"surfaceMode":"headless"',
    );
    expect(events[humanAction]?.data).toMatchObject({
      action: "Synthetic test operator verified supervisor interstitial.",
    });
  });

  it("enforces the wall-clock deadline while a human callback is pending", async () => {
    const startedAt = Date.now();
    const operator = new HangingOperator();
    const result = await run(
      "handoff-deadline",
      {
        memberId: "M-7000",
        productCode: "SAV_PLUS",
        nickname: "Supervisor",
      },
      artifact,
      () => operator,
      { maxRunMs: 1_500 },
    );

    expect(result).toMatchObject({
      status: "failure",
      error: { code: "RUN_DEADLINE_EXCEEDED" },
    });
    expect(Date.now() - startedAt).toBeLessThan(4_000);
    expect(operator.aborted).toBe(true);
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
