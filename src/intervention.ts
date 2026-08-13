import { randomUUID } from "node:crypto";
import type { Condition, ControlOwner, RunState } from "./contracts.js";
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
}

export interface Operator {
  takeControl(request: InterventionRequest): Promise<void>;
  performManualAction(): Promise<string>;
  returnControl(): Promise<void>;
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
  ): Promise<InterventionRequest> {
    const request: InterventionRequest = {
      ...input,
      requestId: randomUUID(),
      runId: this.runId,
    };
    this.owner = "none";
    this.state = "waiting_for_human";
    const requestPath = await this.evidence.json(
      "intervention-request.json",
      request,
    );
    await this.evidence.event(
      "intervention",
      "intervention_requested",
      this.owner,
      { requestId: request.requestId, requestPath, reason: request.reason },
      request.stepId,
    );

    await operator.takeControl(request);
    this.owner = "human";
    this.state = "human_control";
    await this.evidence.event(
      "intervention",
      "control_transferred",
      this.owner,
      { from: "none", to: "human", surfaceSessionId: input.surfaceSessionId },
      request.stepId,
    );
    const action = await operator.performManualAction();
    await this.evidence.event(
      "intervention",
      "human_action_recorded",
      this.owner,
      { action },
      request.stepId,
    );
    await operator.returnControl();

    this.owner = "none";
    this.state = "resuming";
    await this.evidence.event(
      "intervention",
      "control_returned",
      this.owner,
      { from: "human", to: "none" },
      request.stepId,
    );
    const verified = await verifyResume(request.resumeCondition);
    if (!verified) {
      this.state = "failed";
      throw new AutomationError(
        "HANDOFF_RESUME_CONDITION_FAILED",
        "The live session did not satisfy the declared resume condition",
        "hard_failure",
        { stepId: request.stepId, expected: request.resumeCondition },
      );
    }
    this.owner = "automation";
    this.state = "running";
    await this.evidence.event(
      "intervention",
      "automation_resumed",
      this.owner,
      { resumeVerified: true, surfaceSessionId: input.surfaceSessionId },
      request.stepId,
    );
    return request;
  }

  public markCompleted(): void {
    this.owner = "none";
    this.state = "completed";
  }
}
