import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type {
  AgentProposal,
  DiscoveryRequest,
  Observation,
} from "./contracts.js";
import { AgentProposalSchema } from "./contracts.js";

export interface ModelClient {
  readonly modelIdentifier: string;
  propose(input: {
    request: DiscoveryRequest;
    observation: Observation;
    priorSteps: Array<{ id: string; kind: string; result: string }>;
    remainingSteps: number;
  }): Promise<AgentProposal>;
}

function discoveryInstructions(): string {
  return [
    "You are discovering one reusable UI capability on a synthetic credit-union app.",
    "Return exactly one structured proposal. Do not provide hidden reasoning or prose outside the schema.",
    "Use only navigate, click, fill, select, read, waitFor, or assert actions.",
    "Reference invocation data with {kind:'input', name:'...'}; never copy sensitive values into an action literal.",
    "Prefer exact accessible roles and labels, with CSS only as a fallback. Every target must explain locator robustness and require cardinality 1.",
    "Risk classes: safe for reads/navigation, reversible for fields, review_only for reaching review. Never propose irreversible, credential, or external navigation.",
    "The goal is complete only at the review screen before final confirmation. Never click Confirm account creation.",
    "On completion, provide declarative success conditions and output bindings that match the requested output names.",
    "If the safe next action is unclear, return stuck.",
  ].join("\n");
}

export class OpenAIModelClient implements ModelClient {
  private readonly client: OpenAI;

  public constructor(
    public readonly modelIdentifier = "gpt-5.6-sol",
    apiKey = process.env.OPENAI_API_KEY,
  ) {
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is required for genuine discovery; replay does not use it.",
      );
    }
    this.client = new OpenAI({ apiKey });
  }

  public async propose(input: {
    request: DiscoveryRequest;
    observation: Observation;
    priorSteps: Array<{ id: string; kind: string; result: string }>;
    remainingSteps: number;
  }): Promise<AgentProposal> {
    const response = await this.client.responses.parse({
      model: this.modelIdentifier,
      reasoning: { effort: "medium" },
      input: [
        {
          role: "system",
          content: discoveryInstructions(),
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                goal: input.request.goal,
                target: input.request.target,
                inputContract: Object.fromEntries(
                  Object.entries(input.request.inputs).map(([name, value]) => [
                    name,
                    {
                      type: value.type,
                      required: value.required,
                      sensitive: value.sensitive ?? false,
                      allowedValues: value.allowedValues,
                      description: value.description,
                    },
                  ]),
                ),
                desiredOutputs: input.request.desiredOutputs,
                currentState: {
                  url: input.observation.url,
                  title: input.observation.title,
                  semanticTree: input.observation.semanticTree,
                  visibleText: input.observation.visibleText,
                },
                priorSteps: input.priorSteps,
                remainingSteps: input.remainingSteps,
              }),
            },
            {
              type: "input_image",
              image_url: input.observation.screenshotDataUrl,
              detail: "high",
            },
          ],
        },
      ],
      text: {
        format: zodTextFormat(AgentProposalSchema, "agent_proposal"),
      },
    });
    if (!response.output_parsed) {
      throw new Error("The discovery model returned no structured proposal");
    }
    return AgentProposalSchema.parse(response.output_parsed);
  }
}

export class ScriptedModelClient implements ModelClient {
  public readonly modelIdentifier = "scripted-model-test-double";
  public calls = 0;

  public constructor(private readonly proposals: readonly AgentProposal[]) {}

  public async propose(): Promise<AgentProposal> {
    const proposal = this.proposals[this.calls];
    this.calls += 1;
    if (!proposal) throw new Error("Scripted model has no remaining proposal");
    return AgentProposalSchema.parse(proposal);
  }
}
