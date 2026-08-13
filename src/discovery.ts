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
import { AutomationError } from "./errors.js";
import type { EvidenceWriter } from "./evidence.js";
import type { ModelClient } from "./model-client.js";
import { CONTROLS } from "./sample-artifact.js";
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

function buildArtifact(
  request: DiscoveryRequest,
  steps: CapabilityStep[],
  completion: Extract<AgentProposal, { kind: "complete" }>,
  runId: string,
  modelIdentifier: string,
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
  return CapabilityArtifactSchema.parse({
    schemaVersion: "1.0",
    capability: {
      id: "prepare-subaccount",
      name: "Prepare synthetic member sub-account",
      version: 1,
      description: request.goal,
      riskClass: "review_only",
    },
    compatibility: {
      surfaceKind: "web",
      appFamily: request.target.appFamily,
      ...(request.target.variant === undefined
        ? {}
        : { variant: request.target.variant }),
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
}

export async function discoverCapability(options: {
  request: unknown;
  model: ModelClient;
  surface: SurfaceSession;
  policy: AutomationPolicy;
  evidence: EvidenceWriter;
}): Promise<DiscoveryResult> {
  const request = DiscoveryRequestSchema.parse(options.request);
  const inputs = requestValues(request);
  const steps: CapabilityStep[] = [];
  const priorSteps: Array<{ id: string; kind: string; result: string }> = [];
  const startedAt = Date.now();
  const seenProposals = new Map<string, number>();
  let lastObservationPath = "";
  try {
    await options.evidence.event("discovery", "run_started", "automation", {
      goal: request.goal,
      target: request.target,
      inputs,
      modelIdentifier: options.model.modelIdentifier,
      maxSteps: options.policy.maxSteps,
      maxRunMs: options.policy.maxRunMs,
    });
    await options.surface.start();
    for (let index = 0; index < options.policy.maxSteps; index += 1) {
      if (Date.now() - startedAt > options.policy.maxRunMs) {
        throw new AutomationError(
          "DISCOVERY_TIMEOUT",
          "Discovery exceeded its configured time bound",
        );
      }
      const observation = await options.surface.observe(`discovery-${index}`);
      lastObservationPath = observation.screenshotPath;
      const proposal = await options.model.propose({
        request,
        observation,
        priorSteps,
        remainingSteps: options.policy.maxSteps - index,
      });
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
          remainingSteps: options.policy.maxSteps - index,
        },
        proposal.kind === "act" ? proposal.action.id : undefined,
      );
      if (proposal.kind === "stuck") {
        const requestPath = await options.evidence.json(
          "intervention-request.json",
          {
            runId: options.evidence.runId,
            goalOrCapability: request.goal,
            currentStep: steps.at(-1)?.id ?? "initial-observation",
            reason: proposal.reason,
            interventionHint: proposal.interventionHint,
            sanitizedState: {
              url: observation.url,
              title: observation.title,
              visibleText: observation.visibleText,
            },
            evidencePaths: [observation.screenshotPath],
            surfaceSessionId: options.surface.id,
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
        if (
          !(await options.surface.evaluateCondition(proposal.success, inputs))
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
          steps,
          proposal,
          options.evidence.runId,
          options.model.modelIdentifier,
        );
        const artifactPath = await options.evidence.json(
          "capability.v1.json",
          artifact,
        );
        await options.evidence.event("discovery", "run_completed", "none", {
          status: "success",
          artifactPath,
          stepCount: steps.length,
        });
        return {
          status: "success",
          runId: options.evidence.runId,
          artifact,
          artifactPath,
        };
      }

      await options.surface.execute(
        proposal.action,
        inputs,
        options.policy,
        () => "automation",
      );
      const state = await options.surface.runtimeState();
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
        !(await options.surface.evaluateCondition(
          proposal.action.checkpoint,
          inputs,
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
      error instanceof Error ? error.message : "Unknown discovery error";
    await options.evidence.event("discovery", "run_stopped", "none", {
      code,
      message,
      stepCount: steps.length,
      lastObservationPath,
    });
    return {
      status: "stopped",
      runId: options.evidence.runId,
      code,
      message,
      evidencePaths: lastObservationPath ? [lastObservationPath] : [],
    };
  } finally {
    await options.surface.close().catch(() => undefined);
  }
}
