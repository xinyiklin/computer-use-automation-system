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
import { AutomationError, failureResult } from "./errors.js";
import type { EvidenceWriter } from "./evidence.js";
import { ControlCoordinator, type Operator } from "./intervention.js";
import { intersectArtifactPolicy } from "./policy.js";
import type { SurfaceSession } from "./surface.js";

export interface ReplayOptions {
  artifact: unknown;
  inputs: Record<string, unknown>;
  policy: AutomationPolicy;
  surface: SurfaceSession;
  evidence: EvidenceWriter;
  operator?: Operator;
}

function scalar(value: string, parser: string): string | number | boolean {
  switch (parser) {
    case "string":
      return value;
    case "number": {
      const parsed = Number(value);
      if (!Number.isFinite(parsed))
        throw new AutomationError(
          "OUTPUT_PARSE_FAILED",
          `Could not parse number output: ${value}`,
        );
      return parsed;
    }
    case "currency": {
      const parsed = Number(value.replace(/[$,]/g, ""));
      if (!Number.isFinite(parsed))
        throw new AutomationError(
          "OUTPUT_PARSE_FAILED",
          `Could not parse currency output: ${value}`,
        );
      return parsed;
    }
    case "boolean":
      if (/^(true|yes|1)$/i.test(value)) return true;
      if (/^(false|no|0)$/i.test(value)) return false;
      throw new AutomationError(
        "OUTPUT_PARSE_FAILED",
        `Could not parse boolean output: ${value}`,
      );
    default:
      throw new AutomationError(
        "OUTPUT_PARSER_UNSUPPORTED",
        `Unsupported scalar parser: ${parser}`,
        "invalid_artifact",
      );
  }
}

async function extractOutputs(
  artifact: CapabilityArtifact,
  surface: SurfaceSession,
): Promise<Record<string, unknown>> {
  const outputs: Record<string, unknown> = {};
  for (const [name, binding] of Object.entries(artifact.outputBindings)) {
    outputs[name] =
      binding.kind === "literal"
        ? binding.value
        : scalar(await surface.readControl(binding.source), binding.parseAs);
  }
  return outputs;
}

async function checkCompatibility(
  artifact: CapabilityArtifact,
  surface: SurfaceSession,
  inputs: Record<string, string | number | boolean>,
): Promise<void> {
  const url = new URL(surface.currentUrl());
  if (!artifact.compatibility.allowedOrigins.includes(url.origin)) {
    throw new AutomationError(
      "SURFACE_INCOMPATIBLE",
      "Surface origin does not match the artifact compatibility contract",
      "hard_failure",
      { expected: artifact.compatibility.allowedOrigins, observed: url.origin },
    );
  }
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
      await new Promise((resolve) => setTimeout(resolve, retry.delayMs));
    }
    coordinator.assertAutomationOwner();
    if (retry.strategy === "reload") {
      await surface.reload(policy, () => coordinator.currentOwner(), step.id);
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
  let inputs: Record<string, string | number | boolean>;
  try {
    inputs = validateInvocationInputs(artifact.inputSchema, options.inputs);
  } catch (error) {
    return failureResult(
      options.evidence.runId,
      capabilityId,
      new AutomationError(
        "INVALID_INVOCATION_INPUTS",
        error instanceof Error ? error.message : "Input validation failed",
        "invalid_artifact",
      ),
    );
  }
  let policy: AutomationPolicy;
  try {
    policy = intersectArtifactPolicy(options.policy, artifact);
  } catch (error) {
    return failureResult(options.evidence.runId, capabilityId, error);
  }
  const coordinator = new ControlCoordinator(
    options.evidence.runId,
    options.evidence,
  );
  const startedAt = Date.now();
  let currentStep: CapabilityStep | undefined;
  try {
    await options.evidence.initialize();
    await options.evidence.event(
      "replay",
      "run_started",
      coordinator.currentOwner(),
      { capabilityId, inputs, modelDecisionCalls: 0 },
    );
    await options.surface.start();
    for (const [index, step] of artifact.steps.entries()) {
      currentStep = step;
      if (
        index >= policy.maxSteps ||
        Date.now() - startedAt > policy.maxRunMs
      ) {
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
      await options.surface.execute(step, inputs, policy, () =>
        coordinator.currentOwner(),
      );

      if (index === 0) {
        await checkCompatibility(artifact, options.surface, inputs);
        await options.evidence.event(
          "replay",
          "compatibility_verified",
          coordinator.currentOwner(),
          {
            appFamily: artifact.compatibility.appFamily,
            variant: artifact.compatibility.variant ?? "base",
          },
          step.id,
        );
      }

      const businessOutcome = await evaluateBusinessOutcome(
        artifact,
        options.surface,
        inputs,
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

      let state = await options.surface.runtimeState();
      if (state.recoverableCode) {
        await recover(
          step,
          state.recoverableCode,
          options.surface,
          options.evidence,
          coordinator,
          policy,
        );
        state = await options.surface.runtimeState();
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
        const observation = await options.surface.observe("intervention");
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
          },
          options.operator,
          (condition) => options.surface.evaluateCondition(condition, inputs),
        );
      }

      if (
        step.checkpoint &&
        !(await options.surface.evaluateCondition(step.checkpoint, inputs))
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

    if (!(await options.surface.evaluateCondition(artifact.success, inputs))) {
      throw new AutomationError(
        "SUCCESS_CONDITION_FAILED",
        "Final capability success condition was not satisfied",
        "hard_failure",
        { expected: artifact.success, observed: options.surface.currentUrl() },
      );
    }
    const finalObservation = await options.surface.observe("success");
    const outputs = await extractOutputs(artifact, options.surface);
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
    });
    await options.evidence.json("result.json", result);
    return result;
  } catch (error) {
    let evidencePaths =
      error instanceof AutomationError
        ? (error.context.evidencePaths ?? [])
        : [];
    try {
      const observation = await options.surface.observe("failure");
      evidencePaths = [...evidencePaths, observation.screenshotPath];
    } catch {
      // The surface may have failed before a page existed; structured logs remain.
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
    await options.surface.close().catch(() => undefined);
  }
}
