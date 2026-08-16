import { createHash, randomUUID } from "node:crypto";
import type {
  AgentProposal,
  AutomationPolicy,
  CapabilityArtifact,
  CapabilityStep,
  DiscoveryRequest,
} from "./contracts.js";
import {
  CapabilityArtifactSchema,
  DiscoveryRequestSchema,
  validateInvocationInputs,
} from "./contracts.js";
import {
  remainingDeadlineMs,
  settleWithinDeadline,
  withinDeadline,
} from "./deadline.js";
import { AutomationError } from "./errors.js";
import { sanitizePersisted, type EvidenceWriter } from "./evidence.js";
import { ControlCoordinator, type Operator } from "./intervention.js";
import type { ModelClient } from "./model-client.js";
import {
  assertTransportReceiptMatchesExecution,
  modelExecutionMetadata,
} from "./model-client.js";
import { extractOutputs } from "./outputs.js";
import { registerSensitiveInputRules } from "./policy.js";
import { CONTROLS } from "./sample-artifact.js";
import { sensitiveValueRepresentations } from "./sensitive-values.js";
import type { SurfaceSession } from "./surface.js";

export type DiscoveryResult =
  | {
      status: "success";
      runId: string;
      artifact: CapabilityArtifact;
      artifactPath: string;
    }
  | {
      status: "stopped";
      runId: string;
      code: string;
      message: string;
      evidencePaths: string[];
    };

function requestValues(
  request: DiscoveryRequest,
): Record<string, string | number | boolean> {
  const schema = Object.fromEntries(
    Object.entries(request.inputs).map(([name, input]) => [
      name,
      {
        type: input.type,
        required: input.required,
        ...(input.sensitive === undefined
          ? {}
          : { sensitive: input.sensitive }),
        description: input.description,
        ...(input.allowedValues === undefined
          ? {}
          : { allowedValues: input.allowedValues }),
      },
    ]),
  );
  return validateInvocationInputs(
    schema,
    Object.fromEntries(
      Object.entries(request.inputs).map(([name, input]) => [
        name,
        input.value,
      ]),
    ),
  );
}

type VerifiedSurfaceIdentity = {
  surfaceKind: string;
  appFamily: string;
  variant?: string;
};

function assertDiscoveryEntryAction(
  request: DiscoveryRequest,
  inputs: Record<string, string | number | boolean>,
  action: CapabilityStep,
): void {
  if (action.kind !== "navigate") {
    throw new AutomationError(
      "DISCOVERY_ENTRY_REQUIRED",
      "Discovery must begin by navigating to the declared entry surface",
      "policy",
      { stepId: action.id },
    );
  }
  const rawUrl =
    action.url.kind === "literal" ? action.url.value : inputs[action.url.name];
  let observed: URL;
  try {
    observed = new URL(String(rawUrl));
  } catch {
    throw new AutomationError(
      "DISCOVERY_ENTRY_REQUIRED",
      "Discovery entry navigation did not resolve to an absolute URL",
      "policy",
      { stepId: action.id },
    );
  }
  const expected = new URL(request.target.entryUrl);
  if (
    observed.origin !== expected.origin ||
    observed.pathname !== expected.pathname ||
    observed.search !== expected.search
  ) {
    throw new AutomationError(
      "DISCOVERY_ENTRY_REQUIRED",
      "Discovery entry navigation did not target the declared entry surface",
      "policy",
      {
        stepId: action.id,
        expected: expected.pathname,
        observed: observed.pathname,
      },
    );
  }
}

async function verifyDiscoverySurfaceIdentity(
  request: DiscoveryRequest,
  surface: SurfaceSession,
): Promise<VerifiedSurfaceIdentity> {
  const observed = await surface.compatibilityIdentity();
  const expected: VerifiedSurfaceIdentity = {
    surfaceKind: "web",
    appFamily: request.target.appFamily,
    ...(request.target.variant === undefined
      ? {}
      : { variant: request.target.variant }),
  };
  if (
    observed.surfaceKind !== expected.surfaceKind ||
    observed.appFamily !== expected.appFamily ||
    observed.variant !== expected.variant
  ) {
    throw new AutomationError(
      "DISCOVERY_SURFACE_INCOMPATIBLE",
      "Live discovery surface identity does not match the requested target",
      "hard_failure",
      { expected, observed },
    );
  }
  const liveOrigin = new URL(surface.currentUrl()).origin;
  const expectedOrigin = new URL(request.target.entryUrl).origin;
  if (liveOrigin !== expectedOrigin) {
    throw new AutomationError(
      "DISCOVERY_SURFACE_INCOMPATIBLE",
      "Live discovery surface origin does not match the requested target",
      "hard_failure",
      { expected: expectedOrigin, observed: liveOrigin },
    );
  }
  return expected;
}

type BehaviorReference = {
  path: string;
  value: string | number | boolean;
  category: "literal" | "pattern" | "selector" | "semantic";
};

const nonBehaviorKeys = new Set([
  "description",
  "robustnessNote",
  "id",
  "kind",
  "riskClass",
  "parseAs",
  "sensitive",
  "expectedCardinality",
  "exact",
  "relation",
]);

function collectBehaviorReferences(
  value: unknown,
  path = "artifact",
  category: BehaviorReference["category"] = "semantic",
): BehaviorReference[] {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return [{ path, value, category }];
  }
  if (typeof value !== "object" || value === null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectBehaviorReferences(item, `${path}[${index}]`),
    );
  }

  const record = value as Record<string, unknown>;
  if (record.kind === "input") return [];
  return Object.entries(record).flatMap(([key, child]) => {
    if (nonBehaviorKeys.has(key)) return [];
    const childCategory: BehaviorReference["category"] =
      key === "value" && record.kind === "literal"
        ? "literal"
        : key === "pattern"
          ? "pattern"
          : key === "selector"
            ? "selector"
            : category;
    return collectBehaviorReferences(child, `${path}.${key}`, childCategory);
  });
}

function containsValueToken(candidate: string, input: string): boolean {
  if (candidate === input) return true;
  const escaped = input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`).test(
    candidate,
  );
}

function matchingReference(
  references: BehaviorReference[],
  value: string | number | boolean,
): BehaviorReference | undefined {
  const representations = sensitiveValueRepresentations(value);
  return references.find((candidate) => {
    if (candidate.value === value) return true;
    const candidateValue = String(candidate.value);
    return representations.some((representation) =>
      containsValueToken(candidateValue, representation),
    );
  });
}

export function assertArtifactInputIndependence(
  artifact: CapabilityArtifact,
  inputs: Record<string, string | number | boolean>,
  sensitiveInputNames: ReadonlySet<string> = new Set(),
): void {
  const references = [
    ...collectBehaviorReferences(
      {
        allowedOrigins: artifact.compatibility.allowedOrigins,
        appFamily: artifact.compatibility.appFamily,
        variant: artifact.compatibility.variant,
        entryRoutePattern: artifact.compatibility.entryRoutePattern,
      },
      "artifact.compatibility",
      "pattern",
    ),
    ...collectBehaviorReferences({
      requiredLandmarks: artifact.compatibility.requiredLandmarks,
      steps: artifact.steps,
      businessOutcomes: artifact.businessOutcomes.map(
        (outcome) => outcome.when,
      ),
      success: artifact.success,
    }),
    ...artifact.businessOutcomes.flatMap((outcome, index) =>
      collectBehaviorReferences(
        outcome.details,
        `artifact.businessOutcomes[${index}].details`,
        "literal",
      ),
    ),
    ...Object.entries(artifact.outputBindings).flatMap(([name, binding]) =>
      binding.kind === "scalar"
        ? collectBehaviorReferences(
            binding.source,
            `artifact.outputBindings.${name}.source`,
            "selector",
          )
        : [],
    ),
  ];

  for (const [inputName, inputValue] of Object.entries(inputs)) {
    const relevantReferences = sensitiveInputNames.has(inputName)
      ? references
      : references.filter((reference) => reference.category !== "semantic");
    const reference = matchingReference(relevantReferences, inputValue);
    if (!reference) continue;

    throw new AutomationError(
      "DISCOVERY_NON_REUSABLE_ARTIFACT",
      `Discovered artifact embeds invocation input ${inputName} in reusable behavior at ${reference.path}`,
      "invalid_artifact",
      { observed: { inputName, path: reference.path } },
    );
  }
}

export function assertArtifactOutputIndependence(
  artifact: CapabilityArtifact,
  outputs: Record<string, unknown>,
): void {
  for (const [name, binding] of Object.entries(artifact.outputBindings)) {
    if (binding.kind !== "scalar") continue;
    const output = outputs[name];
    if (
      typeof output !== "string" &&
      typeof output !== "number" &&
      typeof output !== "boolean"
    ) {
      continue;
    }
    const reference = matchingReference(
      collectBehaviorReferences(
        binding.source,
        `outputBindings.${name}.source`,
      ),
      output,
    );
    if (!reference) continue;
    throw new AutomationError(
      "DISCOVERY_NON_REUSABLE_ARTIFACT",
      `Discovered output binding ${name} embeds its observed output value at ${reference.path}`,
      "invalid_artifact",
      { observed: { outputName: name, path: reference.path } },
    );
  }
}

function buildArtifact(
  request: DiscoveryRequest,
  inputs: Record<string, string | number | boolean>,
  steps: CapabilityStep[],
  completion: Extract<AgentProposal, { kind: "complete" }>,
  runId: string,
  modelIdentifier: string,
  verifiedIdentity: VerifiedSurfaceIdentity,
): CapabilityArtifact {
  const origin = new URL(request.target.entryUrl).origin;
  const outputNames = Object.keys(request.desiredOutputs).sort();
  const bindingNames = Object.keys(completion.outputs).sort();
  if (JSON.stringify(outputNames) !== JSON.stringify(bindingNames)) {
    throw new AutomationError(
      "DISCOVERY_OUTPUT_CONTRACT_MISMATCH",
      "Model completion output bindings do not exactly match desired outputs",
    );
  }
  const artifact = CapabilityArtifactSchema.parse({
    schemaVersion: "1.0",
    capability: {
      id: "prepare-subaccount",
      name: "Prepare synthetic member sub-account",
      version: 1,
      description: request.goal,
      riskClass: "review_only",
    },
    compatibility: {
      surfaceKind: verifiedIdentity.surfaceKind,
      appFamily: verifiedIdentity.appFamily,
      ...(verifiedIdentity.variant === undefined
        ? {}
        : { variant: verifiedIdentity.variant }),
      allowedOrigins: [origin],
      entryRoutePattern: new URL(request.target.entryUrl).pathname
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/^/, "^")
        .concat("$"),
      requiredLandmarks: [{ kind: "visible", target: CONTROLS.memberId }],
    },
    inputSchema: Object.fromEntries(
      Object.entries(request.inputs).map(([name, input]) => [
        name,
        {
          type: input.type,
          required: input.required,
          ...(input.sensitive === undefined
            ? {}
            : { sensitive: input.sensitive }),
          description: input.description,
          ...(input.allowedValues === undefined
            ? {}
            : { allowedValues: input.allowedValues }),
        },
      ]),
    ),
    outputSchema: request.desiredOutputs,
    outputBindings: completion.outputs,
    steps,
    businessOutcomes: [
      {
        code: "MEMBER_NOT_FOUND",
        description: "The synthetic application returned no matching member.",
        when: { kind: "visible", target: CONTROLS.notFound },
      },
    ],
    success: completion.success,
    provenance: {
      discoveryRunId: runId,
      createdAt: new Date().toISOString(),
      modelIdentifier,
    },
  });
  assertArtifactInputIndependence(
    artifact,
    inputs,
    new Set(
      Object.entries(request.inputs)
        .filter(([, definition]) => definition.sensitive)
        .map(([name]) => name),
    ),
  );
  return artifact;
}

export async function discoverCapability(options: {
  request: unknown;
  model: ModelClient;
  surface: SurfaceSession;
  policy: AutomationPolicy;
  evidence: EvidenceWriter;
  operator?: Operator;
}): Promise<DiscoveryResult> {
  const request = DiscoveryRequestSchema.parse(options.request);
  const sensitiveInputNames = Object.entries(request.inputs)
    .filter(([, definition]) => definition.sensitive)
    .map(([name]) => name);
  const sensitiveOutputNames = Object.entries(request.desiredOutputs)
    .filter(([, definition]) => definition.sensitive)
    .map(([name]) => name);
  options.evidence.addSensitiveFields([
    ...sensitiveInputNames,
    ...sensitiveOutputNames,
  ]);
  options.evidence.addSensitiveValues(
    sensitiveInputNames.map(
      (name) => request.inputs[name]!.value as string | number | boolean,
    ),
  );
  options.surface.registerSensitiveFields(sensitiveInputNames);
  options.surface.registerSensitiveValues(
    sensitiveInputNames.map(
      (name) => request.inputs[name]!.value as string | number | boolean,
    ),
  );
  options.surface.registerSensitiveOutputs(
    sensitiveOutputNames.map((name) => ({ name })),
  );
  const policy = registerSensitiveInputRules(
    options.policy,
    sensitiveInputNames,
  );
  const inputs = requestValues(request);
  const modelMetadata = modelExecutionMetadata(options.model);
  const steps: CapabilityStep[] = [];
  const priorSteps: Array<{ id: string; kind: string; result: string }> = [];
  const startedAt = Date.now();
  const deadlineMs = startedAt + policy.maxRunMs;
  const seenProposals = new Map<string, number>();
  const coordinator = new ControlCoordinator(
    options.evidence.runId,
    options.evidence,
  );
  const bounded = <T>(
    stepId: string | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
  ) =>
    withinDeadline(deadlineMs, stepId, operation, () =>
      options.surface.abort(),
    );
  let lastObservationPath = "";
  let verifiedIdentity: VerifiedSurfaceIdentity | undefined;
  try {
    await options.evidence.event("discovery", "run_started", "automation", {
      goal: request.goal,
      target: request.target,
      inputs,
      modelIdentifier: modelMetadata.modelIdentifier,
      transport: modelMetadata.transport,
      executionKind: modelMetadata.executionKind,
      adapterImplementation: modelMetadata.adapterImplementation,
      runnerKind: modelMetadata.runnerKind,
      maxSteps: policy.maxSteps,
      maxRunMs: policy.maxRunMs,
      configuredPolicy: {
        allowedOrigins: policy.allowedOrigins,
        blockedControlPatterns: policy.blockedControlPatterns,
      },
    });
    await bounded(undefined, (signal) => options.surface.start(signal));
    for (let index = 0; index < policy.maxSteps; index += 1) {
      const stepId = steps.at(-1)?.id;
      if (options.surface.currentUrl() !== "about:blank") {
        verifiedIdentity = await bounded(stepId, () =>
          verifyDiscoverySurfaceIdentity(request, options.surface),
        );
      }
      const observation = await bounded(stepId, () =>
        options.surface.observe(`discovery-${index}`),
      );
      lastObservationPath = observation.screenshotPath;
      const remainingRunMs = remainingDeadlineMs(deadlineMs, stepId);
      const invocationId = randomUUID();
      const invocationStartedAt = new Date().toISOString();
      await options.evidence.event(
        "discovery",
        "model_transport_invoked",
        coordinator.currentOwner(),
        {
          invocationId,
          transport: modelMetadata.transport,
          executionKind: modelMetadata.executionKind,
          modelIdentifier: modelMetadata.modelIdentifier,
          adapterImplementation: modelMetadata.adapterImplementation,
          runnerKind: modelMetadata.runnerKind,
          timeoutMs: remainingRunMs,
          invocationStartedAt,
        },
      );
      const proposed = await bounded(stepId, (signal) =>
        options.model.propose({
          request,
          observation,
          priorSteps,
          remainingSteps: policy.maxSteps - index,
          timeoutMs: remainingRunMs,
          signal,
        }),
      );
      const { proposal, receipt: transportReceipt } = proposed;
      assertTransportReceiptMatchesExecution(modelMetadata, transportReceipt);
      await options.evidence.event(
        "discovery",
        "model_transport_completed",
        coordinator.currentOwner(),
        {
          invocationId,
          transport: modelMetadata.transport,
          executionKind: modelMetadata.executionKind,
          modelIdentifier: modelMetadata.modelIdentifier,
          adapterImplementation: modelMetadata.adapterImplementation,
          runnerKind: modelMetadata.runnerKind,
          invocationStartedAt,
          invocationCompletedAt: new Date().toISOString(),
          transportReceipt,
          proposalSha256: createHash("sha256")
            .update(JSON.stringify(proposal))
            .digest("hex"),
        },
      );
      remainingDeadlineMs(deadlineMs, stepId);
      const signature = JSON.stringify(proposal);
      const repetitions = (seenProposals.get(signature) ?? 0) + 1;
      seenProposals.set(signature, repetitions);
      if (repetitions > 2) {
        throw new AutomationError(
          "DISCOVERY_REPEATED_ACTION",
          "Discovery repeated the same proposal beyond its safe bound",
        );
      }
      await options.evidence.event(
        "discovery",
        "model_proposal",
        "automation",
        {
          proposal,
          observationPath: observation.screenshotPath,
          remainingSteps: policy.maxSteps - index,
        },
        proposal.kind === "act" ? proposal.action.id : undefined,
      );
      if (proposal.kind === "stuck") {
        const stepId = steps.at(-1)?.id ?? "initial-observation";
        const intervention = {
          goalOrCapability: request.goal,
          stepId,
          reason: proposal.reason,
          sanitizedState: {
            url: observation.url,
            title: observation.title,
            visibleText: observation.visibleText,
            ...(proposal.interventionHint === undefined
              ? {}
              : { interventionHint: proposal.interventionHint }),
          },
          evidencePaths: [observation.screenshotPath],
          resumeCondition: proposal.resumeCondition,
          surfaceSessionId: options.surface.id,
          surfaceMode: options.surface.mode,
        };
        if (options.operator) {
          await coordinator.handoff(
            intervention,
            options.operator,
            (condition) => options.surface.evaluateCondition(condition, inputs),
            deadlineMs,
          );
          continue;
        }
        const requestPath = await options.evidence.json(
          "intervention-request.json",
          {
            ...intervention,
            requestId: randomUUID(),
            runId: options.evidence.runId,
          },
        );
        return {
          status: "stopped",
          runId: options.evidence.runId,
          code: "DISCOVERY_STUCK",
          message: proposal.reason,
          evidencePaths: [requestPath, observation.screenshotPath],
        };
      }
      if (proposal.kind === "complete") {
        verifiedIdentity = await bounded(stepId, () =>
          verifyDiscoverySurfaceIdentity(request, options.surface),
        );
        if (
          !(await bounded(stepId, () =>
            options.surface.evaluateCondition(proposal.success, inputs),
          ))
        ) {
          throw new AutomationError(
            "DISCOVERY_FALSE_COMPLETION",
            "The model declared completion before its success condition was true",
            "hard_failure",
            { expected: proposal.success, observed: observation.url },
          );
        }
        const artifact = buildArtifact(
          request,
          inputs,
          steps,
          proposal,
          options.evidence.runId,
          modelMetadata.modelIdentifier,
          verifiedIdentity,
        );
        const outputs = await extractOutputs(
          artifact,
          options.surface,
          deadlineMs,
          stepId,
        );
        assertArtifactOutputIndependence(artifact, outputs);
        const persistedArtifact = await options.evidence.jsonWithDigest(
          "capability.v1.json",
          artifact,
        );
        await options.evidence.event("discovery", "run_completed", "none", {
          status: "success",
          artifactPath: persistedArtifact.path,
          artifactSha256: persistedArtifact.sha256,
          artifactDigestKind: "persisted-file-bytes",
          stepCount: steps.length,
        });
        coordinator.markCompleted();
        return {
          status: "success",
          runId: options.evidence.runId,
          artifact,
          artifactPath: persistedArtifact.path,
        };
      }

      if (steps.length === 0) {
        assertDiscoveryEntryAction(request, inputs, proposal.action);
      } else {
        verifiedIdentity = await bounded(proposal.action.id, () =>
          verifyDiscoverySurfaceIdentity(request, options.surface),
        );
      }

      await bounded(proposal.action.id, () =>
        options.surface.execute(
          proposal.action,
          inputs,
          policy,
          () => coordinator.currentOwner(),
          deadlineMs,
        ),
      );
      verifiedIdentity = await bounded(proposal.action.id, () =>
        verifyDiscoverySurfaceIdentity(request, options.surface),
      );
      if (steps.length === 0) {
        await options.evidence.event(
          "discovery",
          "compatibility_verified",
          coordinator.currentOwner(),
          { observedIdentity: verifiedIdentity },
          proposal.action.id,
        );
      }
      const state = await bounded(proposal.action.id, () =>
        options.surface.runtimeState(),
      );
      if (state.failureCode || state.interventionCode) {
        throw new AutomationError(
          state.failureCode ?? state.interventionCode ?? "DISCOVERY_STOPPED",
          "The application entered a state that discovery may not cross automatically",
          "hard_failure",
          { stepId: proposal.action.id, observed: state },
        );
      }
      if (
        proposal.action.checkpoint &&
        !(await bounded(proposal.action.id, () =>
          options.surface.evaluateCondition(
            proposal.action.checkpoint!,
            inputs,
          ),
        ))
      ) {
        throw new AutomationError(
          "DISCOVERY_CHECKPOINT_FAILED",
          `Discovery checkpoint failed at ${proposal.action.id}`,
          "hard_failure",
          { stepId: proposal.action.id, expected: proposal.action.checkpoint },
        );
      }
      steps.push(proposal.action);
      priorSteps.push({
        id: proposal.action.id,
        kind: proposal.action.kind,
        result: "executed_and_checked",
      });
    }
    throw new AutomationError(
      "DISCOVERY_MAX_STEPS",
      "Discovery reached its maximum step count without completion",
    );
  } catch (error) {
    const code =
      error instanceof AutomationError ? error.code : "DISCOVERY_ERROR";
    const message =
      error instanceof AutomationError
        ? (sanitizePersisted(
            error.message,
            new Set([...sensitiveInputNames, ...sensitiveOutputNames]),
            new Set(sensitiveInputNames.map((name) => String(inputs[name]))),
          ) as string)
        : "Discovery stopped because of an unexpected internal error";
    await options.evidence.event(
      "discovery",
      "run_stopped",
      coordinator.currentOwner(),
      {
        code,
        message,
        stepCount: steps.length,
        lastObservationPath,
      },
    );
    return {
      status: "stopped",
      runId: options.evidence.runId,
      code,
      message,
      evidencePaths: lastObservationPath ? [lastObservationPath] : [],
    };
  } finally {
    await settleWithinDeadline(deadlineMs, () => options.surface.close());
  }
}
