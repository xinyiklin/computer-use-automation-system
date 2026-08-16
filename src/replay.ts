import { createHash } from "node:crypto";
import type {
  AutomationPolicy,
  CapabilityArtifact,
  CapabilityStep,
  Condition,
  ReplayResult,
} from "./contracts.js";
import {
  parseCapabilityArtifact,
  validateInvocationInputs,
} from "./contracts.js";
import { settleWithinDeadline, withinDeadline } from "./deadline.js";
import { AutomationError, failureResult } from "./errors.js";
import type { EvidenceWriter } from "./evidence.js";
import { ControlCoordinator, type Operator } from "./intervention.js";
import { extractOutputs } from "./outputs.js";
import {
  intersectArtifactPolicy,
  registerSensitiveInputRules,
} from "./policy.js";
import type { SurfaceSession } from "./surface.js";

interface ReplayOptionsBase {
  artifact: unknown;
  inputs: Record<string, unknown>;
  policy: AutomationPolicy;
  surface: SurfaceSession;
  evidence: EvidenceWriter;
  operator?: Operator;
}

export type ReplayOptions = ReplayOptionsBase &
  (
    | { artifactSource: string; artifactSha256: string }
    | { artifactSource?: undefined; artifactSha256?: undefined }
  );

async function checkSurfaceIdentity(
  artifact: CapabilityArtifact,
  surface: SurfaceSession,
): Promise<void> {
  const observedIdentity = await surface.compatibilityIdentity();
  const expectedIdentity = {
    surfaceKind: artifact.compatibility.surfaceKind,
    appFamily: artifact.compatibility.appFamily,
    variant: artifact.compatibility.variant,
  };
  if (
    observedIdentity.surfaceKind !== expectedIdentity.surfaceKind ||
    observedIdentity.appFamily !== expectedIdentity.appFamily ||
    observedIdentity.variant !== expectedIdentity.variant
  ) {
    throw new AutomationError(
      "SURFACE_INCOMPATIBLE",
      "Surface identity does not match the artifact compatibility contract",
      "hard_failure",
      { expected: expectedIdentity, observed: observedIdentity },
    );
  }
  const url = new URL(surface.currentUrl());
  if (!artifact.compatibility.allowedOrigins.includes(url.origin)) {
    throw new AutomationError(
      "SURFACE_INCOMPATIBLE",
      "Surface origin does not match the artifact compatibility contract",
      "hard_failure",
      { expected: artifact.compatibility.allowedOrigins, observed: url.origin },
    );
  }
}

async function checkCompatibility(
  artifact: CapabilityArtifact,
  surface: SurfaceSession,
  inputs: Record<string, string | number | boolean>,
): Promise<void> {
  await checkSurfaceIdentity(artifact, surface);
  const url = new URL(surface.currentUrl());
  if (
    !new RegExp(artifact.compatibility.entryRoutePattern).test(url.pathname)
  ) {
    throw new AutomationError(
      "SURFACE_INCOMPATIBLE",
      "Entry route does not match the artifact compatibility contract",
      "hard_failure",
      {
        expected: artifact.compatibility.entryRoutePattern,
        observed: url.pathname,
      },
    );
  }
  for (const landmark of artifact.compatibility.requiredLandmarks) {
    if (!(await surface.evaluateCondition(landmark, inputs))) {
      throw new AutomationError(
        "SURFACE_INCOMPATIBLE",
        "A required compatibility landmark is missing",
        "hard_failure",
        { expected: landmark, observed: { url: surface.currentUrl() } },
      );
    }
  }
}

function assertEntryNavigation(
  artifact: CapabilityArtifact,
  inputs: Record<string, string | number | boolean>,
): void {
  const entry = artifact.steps[0];
  if (entry?.kind !== "navigate") {
    throw new AutomationError(
      "INVALID_ENTRY_STEP",
      "The first capability step must navigate to the declared entry surface",
      "invalid_artifact",
    );
  }
  const rawUrl =
    entry.url.kind === "literal" ? entry.url.value : inputs[entry.url.name];
  if (rawUrl === undefined) {
    throw new AutomationError(
      "INVALID_ENTRY_STEP",
      "The entry navigation does not resolve to an invocation value",
      "invalid_artifact",
    );
  }
  let url: URL;
  try {
    url = new URL(String(rawUrl));
  } catch {
    throw new AutomationError(
      "INVALID_ENTRY_STEP",
      "The entry navigation must resolve to an absolute URL",
      "invalid_artifact",
    );
  }
  if (
    !artifact.compatibility.allowedOrigins.includes(url.origin) ||
    !new RegExp(artifact.compatibility.entryRoutePattern).test(url.pathname)
  ) {
    throw new AutomationError(
      "INVALID_ENTRY_STEP",
      "The first navigation does not target the declared compatibility entry",
      "invalid_artifact",
    );
  }
}

async function evaluateBusinessOutcome(
  artifact: CapabilityArtifact,
  surface: SurfaceSession,
  inputs: Record<string, string | number | boolean>,
): Promise<(typeof artifact.businessOutcomes)[number] | undefined> {
  for (const outcome of artifact.businessOutcomes) {
    if (await surface.evaluateCondition(outcome.when, inputs)) return outcome;
  }
  return undefined;
}

async function recover(
  step: CapabilityStep,
  code: string,
  surface: SurfaceSession,
  evidence: EvidenceWriter,
  coordinator: ControlCoordinator,
  policy: AutomationPolicy,
  deadlineMs: number,
): Promise<void> {
  const retry = step.retryPolicy;
  if (!retry || !retry.conditionCodes.includes(code)) {
    throw new AutomationError(
      "RECOVERABLE_RULE_MISSING",
      `No declared recovery rule handles ${code}`,
      "recoverable_exhausted",
      { stepId: step.id, observed: code },
    );
  }
  for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
    await evidence.event(
      "replay",
      "recovery_attempt",
      coordinator.currentOwner(),
      {
        code,
        attempt,
        maxAttempts: retry.maxAttempts,
        strategy: retry.strategy,
      },
      step.id,
    );
    if (retry.delayMs > 0) {
      if (Date.now() + retry.delayMs >= deadlineMs) {
        throw new AutomationError(
          "REPLAY_BOUND_EXCEEDED",
          "Replay exceeded its configured time bound during recovery",
          "hard_failure",
          { stepId: step.id },
        );
      }
      await new Promise((resolve) => setTimeout(resolve, retry.delayMs));
    }
    coordinator.assertAutomationOwner();
    if (retry.strategy === "reload") {
      await surface.reload(
        policy,
        () => coordinator.currentOwner(),
        step.id,
        deadlineMs,
      );
      await evidence.event(
        "replay",
        "recovery_policy_checked",
        coordinator.currentOwner(),
        {
          actionKind: "navigate",
          riskClass: "safe",
          url: surface.currentUrl(),
        },
        step.id,
      );
    }
    const state = await surface.runtimeState();
    if (state.recoverableCode === undefined) return;
  }
  throw new AutomationError(
    "RECOVERY_EXHAUSTED",
    `Recovery remained unsuccessful after ${retry.maxAttempts} attempts`,
    "recoverable_exhausted",
    { stepId: step.id, observed: code },
  );
}

function resumeCondition(): Condition {
  return {
    kind: "visible",
    target: {
      description: "prepare new sub-account heading",
      robustnessNote:
        "Stable heading proves the manual interstitial was cleared.",
      expectedCardinality: 1,
      candidates: [
        {
          kind: "role",
          role: "heading",
          name: "Prepare new sub-account",
          exact: true,
        },
      ],
    },
  };
}

export async function replayCapability(
  options: ReplayOptions,
): Promise<ReplayResult> {
  let artifact: CapabilityArtifact;
  try {
    artifact = parseCapabilityArtifact(options.artifact);
  } catch (error) {
    return failureResult(
      options.evidence.runId,
      "unknown",
      new AutomationError(
        "INVALID_ARTIFACT",
        error instanceof Error ? error.message : "Artifact validation failed",
        "invalid_artifact",
      ),
    );
  }
  const capabilityId = artifact.capability.id;
  if (
    options.artifactSha256 !== undefined &&
    !/^[a-f0-9]{64}$/.test(options.artifactSha256)
  ) {
    return failureResult(
      options.evidence.runId,
      capabilityId,
      new AutomationError(
        "INVALID_ARTIFACT_DIGEST",
        "Artifact byte digest must be a lowercase SHA-256 value",
        "invalid_artifact",
      ),
    );
  }
  const artifactSha256 =
    options.artifactSha256 ??
    createHash("sha256").update(JSON.stringify(artifact)).digest("hex");
  const artifactDigestKind =
    options.artifactSha256 === undefined
      ? "canonical-json"
      : "persisted-file-bytes";
  const sensitiveOutputs = Object.entries(artifact.outputSchema)
    .filter(([name, definition]) => {
      const binding = artifact.outputBindings[name];
      return (
        definition.sensitive ||
        (binding?.kind === "scalar" && binding.sensitive)
      );
    })
    .map(([name]) => name);
  const sensitiveInputs = Object.entries(artifact.inputSchema)
    .filter(([, definition]) => definition.sensitive)
    .map(([name]) => name);
  const sensitiveInputValues = sensitiveInputs.flatMap((name) => {
    const value = options.inputs[name];
    return value === undefined ||
      (typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean")
      ? []
      : [value];
  });
  const failureSanitization = {
    sensitiveFields: new Set([...sensitiveInputs, ...sensitiveOutputs]),
    sensitiveValues: new Set(sensitiveInputValues.map(String)),
  };
  options.evidence.addSensitiveFields(sensitiveOutputs);
  let inputs: Record<string, string | number | boolean>;
  try {
    inputs = validateInvocationInputs(artifact.inputSchema, options.inputs);
  } catch (error) {
    return failureResult(
      options.evidence.runId,
      capabilityId,
      new AutomationError(
        "INVALID_INVOCATION_INPUTS",
        "Invocation inputs did not satisfy the artifact contract",
        "invalid_artifact",
      ),
      failureSanitization,
    );
  }
  options.evidence.addSensitiveFields(sensitiveInputs);
  options.evidence.addSensitiveValues(sensitiveInputValues);
  options.surface.registerSensitiveFields(sensitiveInputs);
  options.surface.registerSensitiveValues(sensitiveInputValues);
  options.surface.registerSensitiveOutputs(
    sensitiveOutputs.map((name) => {
      const binding = artifact.outputBindings[name];
      return {
        name,
        ...(binding?.kind === "scalar" ? { target: binding.source } : {}),
      };
    }),
  );
  let policy: AutomationPolicy;
  try {
    policy = registerSensitiveInputRules(
      intersectArtifactPolicy(options.policy, artifact),
      sensitiveInputs,
    );
    assertEntryNavigation(artifact, inputs);
  } catch (error) {
    return failureResult(
      options.evidence.runId,
      capabilityId,
      error,
      failureSanitization,
    );
  }
  const coordinator = new ControlCoordinator(
    options.evidence.runId,
    options.evidence,
  );
  const startedAt = Date.now();
  const deadlineMs = startedAt + policy.maxRunMs;
  const bounded = <T>(
    stepId: string | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
  ) =>
    withinDeadline(deadlineMs, stepId, operation, () =>
      options.surface.abort(),
    );
  let currentStep: CapabilityStep | undefined;
  try {
    await options.evidence.initialize();
    await options.evidence.event(
      "replay",
      "run_started",
      coordinator.currentOwner(),
      {
        capabilityId,
        artifactDiscoveryRunId: artifact.provenance.discoveryRunId,
        artifactSha256,
        artifactDigestKind,
        ...(options.artifactSource === undefined
          ? {}
          : { artifactSource: options.artifactSource }),
        inputs,
        modelDecisionCalls: 0,
        configuredPolicy: {
          allowedOrigins: policy.allowedOrigins,
          blockedControlPatterns: policy.blockedControlPatterns,
        },
      },
    );
    await bounded(undefined, (signal) => options.surface.start(signal));
    for (const [index, step] of artifact.steps.entries()) {
      currentStep = step;
      if (index >= policy.maxSteps || Date.now() >= deadlineMs) {
        throw new AutomationError(
          "REPLAY_BOUND_EXCEEDED",
          "Replay exceeded its configured step or time bound",
          "hard_failure",
          { stepId: step.id },
        );
      }
      coordinator.assertAutomationOwner();
      await options.evidence.event(
        "replay",
        "step_started",
        coordinator.currentOwner(),
        {
          actionKind: step.kind,
          riskClass: step.riskClass,
          reason: step.description,
        },
        step.id,
      );
      await bounded(step.id, () =>
        options.surface.execute(
          step,
          inputs,
          policy,
          () => coordinator.currentOwner(),
          deadlineMs,
        ),
      );

      if (index === 0) {
        await bounded(step.id, () =>
          checkCompatibility(artifact, options.surface, inputs),
        );
        await options.evidence.event(
          "replay",
          "compatibility_verified",
          coordinator.currentOwner(),
          {
            appFamily: artifact.compatibility.appFamily,
            variant: artifact.compatibility.variant ?? "base",
            observedIdentity: await bounded(step.id, () =>
              options.surface.compatibilityIdentity(),
            ),
          },
          step.id,
        );
      } else {
        await bounded(step.id, () =>
          checkSurfaceIdentity(artifact, options.surface),
        );
      }

      const businessOutcome = await bounded(step.id, () =>
        evaluateBusinessOutcome(artifact, options.surface, inputs),
      );
      if (businessOutcome) {
        await options.evidence.event(
          "replay",
          "business_outcome",
          coordinator.currentOwner(),
          { code: businessOutcome.code },
          step.id,
        );
        coordinator.markCompleted();
        const result: ReplayResult = {
          status: "business_outcome",
          runId: options.evidence.runId,
          capabilityId,
          code: businessOutcome.code,
          ...(businessOutcome.details === undefined
            ? {}
            : { details: businessOutcome.details }),
        };
        await options.evidence.json("result.json", result);
        return result;
      }

      let state = await bounded(step.id, () => options.surface.runtimeState());
      if (state.recoverableCode) {
        await bounded(step.id, () =>
          recover(
            step,
            state.recoverableCode!,
            options.surface,
            options.evidence,
            coordinator,
            policy,
            deadlineMs,
          ),
        );
        await bounded(step.id, () =>
          checkSurfaceIdentity(artifact, options.surface),
        );
        state = await bounded(step.id, () => options.surface.runtimeState());
      }
      if (state.failureCode) {
        throw new AutomationError(
          state.failureCode,
          `The application reported a hard failure: ${state.failureCode}`,
          "hard_failure",
          {
            stepId: step.id,
            expected:
              step.checkpoint ??
              ({ applicationState: "permitted continuation" } as const),
            observed: state,
          },
        );
      }
      if (state.interventionCode) {
        const observation = await bounded(step.id, () =>
          options.surface.observe("intervention"),
        );
        if (!options.operator) {
          const requestPath = await options.evidence.json(
            "intervention-request.json",
            {
              runId: options.evidence.runId,
              goalOrCapability: capabilityId,
              stepId: step.id,
              reason: state.interventionCode,
              sanitizedState: {
                url: observation.url,
                title: observation.title,
                visibleText: observation.visibleText,
              },
              evidencePaths: [observation.screenshotPath],
              resumeCondition: resumeCondition(),
              surfaceSessionId: options.surface.id,
              surfaceMode: options.surface.mode,
            },
          );
          throw new AutomationError(
            "INTERVENTION_REQUIRED",
            `Human intervention is required: ${state.interventionCode}`,
            "hard_failure",
            { stepId: step.id, evidencePaths: [requestPath] },
          );
        }
        await coordinator.handoff(
          {
            goalOrCapability: capabilityId,
            stepId: step.id,
            reason: state.interventionCode,
            sanitizedState: {
              url: observation.url,
              title: observation.title,
              visibleText: observation.visibleText,
            },
            evidencePaths: [observation.screenshotPath],
            resumeCondition: resumeCondition(),
            surfaceSessionId: options.surface.id,
            surfaceMode: options.surface.mode,
          },
          options.operator,
          (condition) => options.surface.evaluateCondition(condition, inputs),
          deadlineMs,
        );
        await bounded(step.id, () =>
          checkSurfaceIdentity(artifact, options.surface),
        );
      }

      if (
        step.checkpoint &&
        !(await bounded(step.id, () =>
          options.surface.evaluateCondition(step.checkpoint!, inputs),
        ))
      ) {
        throw new AutomationError(
          "CHECKPOINT_FAILED",
          `Post-action checkpoint failed at ${step.id}`,
          "hard_failure",
          {
            stepId: step.id,
            expected: step.checkpoint,
            observed: { url: options.surface.currentUrl() },
          },
        );
      }
      await options.evidence.event(
        "replay",
        "step_completed",
        coordinator.currentOwner(),
        { checkpointVerified: step.checkpoint !== undefined },
        step.id,
      );
    }

    await bounded(currentStep?.id, () =>
      checkSurfaceIdentity(artifact, options.surface),
    );
    if (
      !(await bounded(currentStep?.id, () =>
        options.surface.evaluateCondition(artifact.success, inputs),
      ))
    ) {
      throw new AutomationError(
        "SUCCESS_CONDITION_FAILED",
        "Final capability success condition was not satisfied",
        "hard_failure",
        { expected: artifact.success, observed: options.surface.currentUrl() },
      );
    }
    const finalObservation = await bounded(currentStep?.id, () =>
      options.surface.observe("success"),
    );
    const outputs = await extractOutputs(
      artifact,
      options.surface,
      deadlineMs,
      currentStep?.id,
    );
    const result: ReplayResult = {
      status: "success",
      runId: options.evidence.runId,
      capabilityId,
      outputs,
    };
    coordinator.markCompleted();
    await options.evidence.event("replay", "run_completed", "none", {
      status: "success",
      finalUrl: finalObservation.url,
      screenshotPath: finalObservation.screenshotPath,
      confirmationExecuted: false,
      modelDecisionCalls: 0,
      artifactDiscoveryRunId: artifact.provenance.discoveryRunId,
      artifactSha256,
      artifactDigestKind,
    });
    await options.evidence.json("result.json", result);
    return result;
  } catch (error) {
    let evidencePaths =
      error instanceof AutomationError
        ? (error.context.evidencePaths ?? [])
        : [];
    if (Date.now() < deadlineMs) {
      try {
        const observation = await bounded(currentStep?.id, () =>
          options.surface.observe("failure"),
        );
        evidencePaths = [...evidencePaths, observation.screenshotPath];
      } catch {
        // The surface may have failed before a page existed; structured logs remain.
      }
    }
    const normalized =
      error instanceof AutomationError
        ? new AutomationError(error.code, error.message, error.category, {
            ...error.context,
            evidencePaths,
          })
        : error;
    const result = failureResult(
      options.evidence.runId,
      capabilityId,
      normalized,
      failureSanitization,
    );
    await options.evidence.event(
      "replay",
      "run_failed",
      coordinator.currentOwner(),
      {
        result,
        currentStepId: currentStep?.id ?? "preflight",
      },
      currentStep?.id,
    );
    await options.evidence.json("result.json", result);
    return result;
  } finally {
    await settleWithinDeadline(deadlineMs, () => options.surface.close());
  }
}
