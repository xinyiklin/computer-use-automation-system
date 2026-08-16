import { randomUUID } from "node:crypto";
import type { Condition, ControlOwner, RunState } from "./contracts.js";
import { withinDeadline } from "./deadline.js";
import { AutomationError } from "./errors.js";
import type { EvidenceWriter } from "./evidence.js";

export interface InterventionRequest {
  requestId: string;
  runId: string;
  goalOrCapability: string;
  stepId: string;
  reason: string;
  sanitizedState: Record<string, unknown>;
  evidencePaths: string[];
  resumeCondition: Condition;
  surfaceSessionId: string;
  surfaceMode: "headed" | "headless";
}

export interface Operator {
  readonly executionKind: "person-operated-cli" | "scripted-test-double";
  takeControl(request: InterventionRequest, signal: AbortSignal): Promise<void>;
  performManualAction(signal: AbortSignal): Promise<string>;
  returnControl(signal: AbortSignal): Promise<void>;
}

export class ControlCoordinator {
  private owner: ControlOwner = "automation";
  private state: RunState = "running";

  public constructor(
    private readonly runId: string,
    private readonly evidence: EvidenceWriter,
  ) {}

  public currentOwner(): ControlOwner {
    return this.owner;
  }

  public currentState(): RunState {
    return this.state;
  }

  public assertAutomationOwner(): void {
    if (this.owner !== "automation" || this.state !== "running") {
      throw new AutomationError(
        "CONTROL_NOT_OWNED_BY_AUTOMATION",
        `Automation cannot act while owner=${this.owner} state=${this.state}`,
      );
    }
  }

  public async handoff(
    input: Omit<InterventionRequest, "requestId" | "runId">,
    operator: Operator,
    verifyResume: (condition: Condition) => Promise<boolean>,
    deadlineMs: number,
  ): Promise<InterventionRequest> {
    const request: InterventionRequest = {
      ...input,
      requestId: randomUUID(),
      runId: this.runId,
    };
    const bounded = <T>(operation: (signal: AbortSignal) => Promise<T>) =>
      withinDeadline(deadlineMs, request.stepId, operation);
    try {
      this.owner = "none";
      this.state = "waiting_for_human";
      const requestPath = await bounded(() =>
        this.evidence.json("intervention-request.json", request),
      );
      await bounded(() =>
        this.evidence.event(
          "intervention",
          "intervention_requested",
          this.owner,
          { requestId: request.requestId, requestPath, reason: request.reason },
          request.stepId,
        ),
      );

      await bounded((signal) => operator.takeControl(request, signal));
      this.owner = "human";
      this.state = "human_control";
      await bounded(() =>
        this.evidence.event(
          "intervention",
          "control_transferred",
          this.owner,
          {
            from: "none",
            to: "human",
            surfaceSessionId: input.surfaceSessionId,
            surfaceMode: input.surfaceMode,
            operatorExecutionKind: operator.executionKind,
          },
          request.stepId,
        ),
      );
      const action = await bounded((signal) =>
        operator.performManualAction(signal),
      );
      await bounded(() =>
        this.evidence.event(
          "intervention",
          "human_action_recorded",
          this.owner,
          {
            action,
            operatorExecutionKind: operator.executionKind,
            acknowledgedAt: new Date().toISOString(),
          },
          request.stepId,
        ),
      );
      await bounded((signal) => operator.returnControl(signal));

      this.owner = "none";
      this.state = "resuming";
      await bounded(() =>
        this.evidence.event(
          "intervention",
          "control_returned",
          this.owner,
          { from: "human", to: "none" },
          request.stepId,
        ),
      );
      const verified = await bounded(() =>
        verifyResume(request.resumeCondition),
      );
      if (!verified) {
        throw new AutomationError(
          "HANDOFF_RESUME_CONDITION_FAILED",
          "The live session did not satisfy the declared resume condition",
          "hard_failure",
          { stepId: request.stepId, expected: request.resumeCondition },
        );
      }
      this.owner = "automation";
      this.state = "running";
      await bounded(() =>
        this.evidence.event(
          "intervention",
          "automation_resumed",
          this.owner,
          { resumeVerified: true, surfaceSessionId: input.surfaceSessionId },
          request.stepId,
        ),
      );
      return request;
    } catch (error) {
      this.owner = "none";
      this.state = "failed";
      throw error;
    }
  }

  public markCompleted(): void {
    this.owner = "none";
    this.state = "completed";
  }
}
