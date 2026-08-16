import { z } from "zod";

export const RiskClassSchema = z.enum([
  "safe",
  "reversible",
  "review_only",
  "irreversible",
  "credential",
  "external_navigation",
]);
export type RiskClass = z.infer<typeof RiskClassSchema>;

export const ValueSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("input"), name: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("literal"),
      value: z.union([z.string(), z.number(), z.boolean()]),
    })
    .strict(),
]);
export type ValueSource = z.infer<typeof ValueSourceSchema>;

export const LocatorSpecSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("role"),
      role: z.string().min(1),
      name: z.string().min(1),
      exact: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("label"),
      text: z.string().min(1),
      exact: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("text"),
      text: z.string().min(1),
      exact: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("relative"),
      anchorText: z.string().min(1),
      relation: z.enum(["following", "within"]),
      elementHint: z.string().optional(),
    })
    .strict(),
  z.object({ kind: z.literal("css"), selector: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("coordinate"),
      x: z.number().nonnegative(),
      y: z.number().nonnegative(),
      viewport: z.object({
        width: z.number().positive(),
        height: z.number().positive(),
      }),
    })
    .strict(),
]);
export type LocatorSpec = z.infer<typeof LocatorSpecSchema>;

export const FrameLocatorSpecSchema = z
  .object({
    kind: z.enum(["name", "url", "css"]),
    value: z.string().min(1),
  })
  .strict();

export const ControlRefSchema = z
  .object({
    description: z.string().min(1),
    robustnessNote: z.string().min(1),
    framePath: z.array(FrameLocatorSpecSchema).optional(),
    candidates: z.array(LocatorSpecSchema).min(1),
    expectedCardinality: z.literal(1),
  })
  .strict();
export type ControlRef = z.infer<typeof ControlRefSchema>;

export type Condition =
  | { kind: "visible"; target: ControlRef }
  | { kind: "hidden"; target: ControlRef }
  | { kind: "url_matches"; pattern: string }
  | { kind: "text_matches"; target: ControlRef; pattern: string }
  | { kind: "value_equals"; target: ControlRef; value: ValueSource }
  | { kind: "all"; conditions: Condition[] }
  | { kind: "any"; conditions: Condition[] }
  | { kind: "not"; condition: Condition };

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("visible"), target: ControlRefSchema }).strict(),
    z.object({ kind: z.literal("hidden"), target: ControlRefSchema }).strict(),
    z
      .object({ kind: z.literal("url_matches"), pattern: z.string().min(1) })
      .strict(),
    z
      .object({
        kind: z.literal("text_matches"),
        target: ControlRefSchema,
        pattern: z.string().min(1),
      })
      .strict(),
    z
      .object({
        kind: z.literal("value_equals"),
        target: ControlRefSchema,
        value: ValueSourceSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("all"),
        conditions: z.array(ConditionSchema).min(1),
      })
      .strict(),
    z
      .object({
        kind: z.literal("any"),
        conditions: z.array(ConditionSchema).min(1),
      })
      .strict(),
    z.object({ kind: z.literal("not"), condition: ConditionSchema }).strict(),
  ]),
);

export const RetryPolicySchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(3),
    conditionCodes: z.array(z.string().min(1)).min(1),
    strategy: z.enum(["reload", "wait"]),
    delayMs: z.number().int().min(0).max(2_000),
  })
  .strict();

const StepBaseSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  riskClass: RiskClassSchema,
  checkpoint: ConditionSchema.optional(),
  retryPolicy: RetryPolicySchema.optional(),
});

export const CapabilityStepSchema = z.discriminatedUnion("kind", [
  StepBaseSchema.extend({
    kind: z.literal("navigate"),
    url: ValueSourceSchema,
  }).strict(),
  StepBaseSchema.extend({
    kind: z.literal("click"),
    target: ControlRefSchema,
  }).strict(),
  StepBaseSchema.extend({
    kind: z.literal("fill"),
    target: ControlRefSchema,
    value: ValueSourceSchema,
  }).strict(),
  StepBaseSchema.extend({
    kind: z.literal("select"),
    target: ControlRefSchema,
    value: ValueSourceSchema,
  }).strict(),
  StepBaseSchema.extend({
    kind: z.literal("read"),
    target: ControlRefSchema,
    output: z.string().min(1),
    parseAs: z.enum(["string", "number", "currency", "boolean"]),
  }).strict(),
  StepBaseSchema.extend({
    kind: z.literal("waitFor"),
    condition: ConditionSchema,
  }).strict(),
  StepBaseSchema.extend({
    kind: z.literal("assert"),
    condition: ConditionSchema,
  }).strict(),
]);
export type CapabilityStep = z.infer<typeof CapabilityStepSchema>;

export const InputDefinitionSchema = z
  .object({
    type: z.enum(["string", "number", "boolean", "currency"]),
    required: z.boolean(),
    sensitive: z.boolean().optional(),
    description: z.string().min(1),
    allowedValues: z
      .array(z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
  })
  .strict();
export type InputDefinition = z.infer<typeof InputDefinitionSchema>;

export const OutputDefinitionSchema = z
  .object({
    type: z.enum(["string", "number", "boolean", "currency"]),
    sensitive: z.boolean().optional(),
    constant: z.union([z.string(), z.number(), z.boolean()]).optional(),
    description: z.string().min(1),
  })
  .strict()
  .superRefine((definition, context) => {
    if (definition.constant === undefined) return;
    const valid =
      (definition.type === "string" &&
        typeof definition.constant === "string") ||
      ((definition.type === "number" || definition.type === "currency") &&
        typeof definition.constant === "number") ||
      (definition.type === "boolean" &&
        typeof definition.constant === "boolean");
    if (!valid) {
      context.addIssue({
        code: "custom",
        message: `Output constant must match declared type ${definition.type}`,
        path: ["constant"],
      });
    }
  });

const ScalarOutputLocatorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("label"),
      text: z.string().min(1),
      exact: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("relative"),
      anchorText: z.string().min(1),
      relation: z.enum(["following", "within"]),
      elementHint: z.enum([
        "input",
        "select",
        "textarea",
        "output",
        "td",
        "th",
        "dd",
        "span",
        "strong",
        "code",
      ]),
    })
    .strict(),
]);

const ScalarOutputControlRefSchema = z
  .object({
    description: z.string().min(1),
    robustnessNote: z.string().min(1),
    framePath: z.array(FrameLocatorSpecSchema).optional(),
    candidates: z.array(ScalarOutputLocatorSchema).min(1),
    expectedCardinality: z.literal(1),
  })
  .strict();

export const OutputBindingSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("literal"),
      value: z.union([z.string(), z.number(), z.boolean()]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("scalar"),
      source: ScalarOutputControlRefSchema,
      parseAs: z.enum(["string", "number", "currency", "boolean"]),
      sensitive: z.boolean().optional(),
    })
    .strict(),
]);
export type OutputBinding = z.infer<typeof OutputBindingSchema>;

export const BusinessOutcomeRuleSchema = z
  .object({
    code: z.string().min(1),
    description: z.string().min(1),
    when: ConditionSchema,
    details: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
  })
  .strict();

type InputReference = {
  name: string;
  path: Array<string | number>;
};

function collectInputReferences(
  value: unknown,
  path: Array<string | number> = [],
): InputReference[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectInputReferences(item, [...path, index]),
    );
  }
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  if (record.kind === "input" && typeof record.name === "string") {
    return [{ name: record.name, path }];
  }
  return Object.entries(record).flatMap(([key, child]) =>
    collectInputReferences(child, [...path, key]),
  );
}

export const CapabilityArtifactSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    capability: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        version: z.number().int().positive(),
        description: z.string().min(1),
        riskClass: RiskClassSchema,
      })
      .strict(),
    compatibility: z
      .object({
        surfaceKind: z.literal("web"),
        appFamily: z.string().min(1),
        variant: z.string().optional(),
        allowedOrigins: z.array(z.string().min(1)).min(1),
        entryRoutePattern: z.string().min(1),
        requiredLandmarks: z.array(ConditionSchema).min(1),
      })
      .strict(),
    inputSchema: z.record(z.string(), InputDefinitionSchema),
    outputSchema: z.record(z.string(), OutputDefinitionSchema),
    outputBindings: z.record(z.string(), OutputBindingSchema),
    steps: z.array(CapabilityStepSchema).min(1),
    businessOutcomes: z.array(BusinessOutcomeRuleSchema),
    success: ConditionSchema,
    provenance: z
      .object({
        discoveryRunId: z.string().min(1),
        createdAt: z.string().datetime(),
        modelIdentifier: z.string().min(1),
      })
      .strict(),
  })
  .strict()
  .superRefine((artifact, context) => {
    if (artifact.steps[0]?.kind !== "navigate") {
      context.addIssue({
        code: "custom",
        message:
          "The first capability step must navigate to the declared entry surface before business actions",
        path: ["steps", 0],
      });
    }
    const ids = new Set<string>();
    for (const [index, step] of artifact.steps.entries()) {
      if (ids.has(step.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate step id: ${step.id}`,
          path: ["steps", index, "id"],
        });
      }
      ids.add(step.id);
    }
    for (const reference of collectInputReferences(artifact)) {
      if (!(reference.name in artifact.inputSchema)) {
        context.addIssue({
          code: "custom",
          message: `Unknown input reference: ${reference.name}`,
          path: reference.path,
        });
      }
    }
    for (const name of Object.keys(artifact.outputSchema)) {
      if (!(name in artifact.outputBindings)) {
        context.addIssue({
          code: "custom",
          message: `Missing output binding: ${name}`,
          path: ["outputBindings", name],
        });
      }
    }
    for (const [name, binding] of Object.entries(artifact.outputBindings)) {
      const definition = artifact.outputSchema[name];
      if (!definition) {
        context.addIssue({
          code: "custom",
          message: `Unknown output binding: ${name}`,
          path: ["outputBindings", name],
        });
        continue;
      }
      if (binding.kind === "literal") {
        if (definition.sensitive) {
          context.addIssue({
            code: "custom",
            message: `Sensitive output cannot use a public literal constant: ${name}`,
            path: ["outputBindings", name],
          });
        }
        if (definition.constant === undefined) {
          context.addIssue({
            code: "custom",
            message: `Literal output binding requires an explicit constant output definition: ${name}`,
            path: ["outputBindings", name],
          });
        } else if (binding.value !== definition.constant) {
          context.addIssue({
            code: "custom",
            message: `Literal output binding does not match the declared constant: ${name}`,
            path: ["outputBindings", name],
          });
        }
      } else {
        if (binding.parseAs !== definition.type) {
          context.addIssue({
            code: "custom",
            message: `Output binding parser must match declared type ${definition.type}: ${name}`,
            path: ["outputBindings", name, "parseAs"],
          });
        }
        if (definition.constant !== undefined) {
          context.addIssue({
            code: "custom",
            message: `Constant output definition requires a matching literal binding: ${name}`,
            path: ["outputBindings", name],
          });
        }
        if (Boolean(binding.sensitive) !== Boolean(definition.sensitive)) {
          context.addIssue({
            code: "custom",
            message: `Output binding sensitivity must match its output definition: ${name}`,
            path: ["outputBindings", name, "sensitive"],
          });
        }
      }
    }
  });
export type CapabilityArtifact = z.infer<typeof CapabilityArtifactSchema>;

export const DiscoveryRequestSchema = z
  .object({
    goal: z.string().min(1),
    target: z
      .object({
        entryUrl: z.url(),
        appFamily: z.string().min(1),
        variant: z.string().optional(),
      })
      .strict(),
    inputs: z.record(
      z.string(),
      z
        .object({
          type: z.enum(["string", "number", "boolean", "currency"]),
          value: z.unknown(),
          required: z.boolean(),
          sensitive: z.boolean().optional(),
          allowedValues: z
            .array(z.union([z.string(), z.number(), z.boolean()]))
            .optional(),
          description: z.string().min(1),
        })
        .strict(),
    ),
    desiredOutputs: z.record(z.string(), OutputDefinitionSchema),
  })
  .strict();
export type DiscoveryRequest = z.infer<typeof DiscoveryRequestSchema>;

export const AgentProposalSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("act"),
      action: CapabilityStepSchema,
      reason: z.string().min(1),
      expectedEffect: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("complete"),
      reason: z.string().min(1),
      success: ConditionSchema,
      outputs: z.record(z.string(), OutputBindingSchema),
    })
    .strict(),
  z
    .object({
      kind: z.literal("stuck"),
      reason: z.string().min(1),
      interventionHint: z.string().optional(),
      resumeCondition: ConditionSchema,
    })
    .strict(),
]);
export type AgentProposal = z.infer<typeof AgentProposalSchema>;

export const AutomationPolicySchema = z
  .object({
    allowedOrigins: z.array(z.string().min(1)).min(1),
    allowedRoutePatterns: z.array(z.string().min(1)).min(1),
    allowedActionKinds: z.array(
      z.enum([
        "navigate",
        "click",
        "fill",
        "select",
        "read",
        "waitFor",
        "assert",
      ]),
    ),
    maxSteps: z.number().int().positive().max(100),
    maxRunMs: z.number().int().positive(),
    allowedRiskClasses: z.array(RiskClassSchema),
    blockedRiskClasses: z.array(RiskClassSchema),
    blockedControlPatterns: z.array(z.string().min(1)),
    sensitiveInputRules: z.record(z.string(), z.enum(["redact", "mask"])),
  })
  .strict();
export type AutomationPolicy = z.infer<typeof AutomationPolicySchema>;

export const ControlOwnerSchema = z.enum(["automation", "human", "none"]);
export type ControlOwner = z.infer<typeof ControlOwnerSchema>;

export const RunStateSchema = z.enum([
  "running",
  "waiting_for_human",
  "human_control",
  "resuming",
  "completed",
  "failed",
]);
export type RunState = z.infer<typeof RunStateSchema>;

export const RunEventSchema = z
  .object({
    timestamp: z.string().datetime(),
    runId: z.string().min(1),
    phase: z.enum(["discovery", "replay", "intervention"]),
    eventType: z.string().min(1),
    stepId: z.string().optional(),
    controlOwner: ControlOwnerSchema,
    data: z.record(z.string(), z.unknown()),
  })
  .strict();
export type RunEvent = z.infer<typeof RunEventSchema>;

export interface Observation {
  url: string;
  title: string;
  semanticTree: string;
  visibleText: string;
  controls: Array<{
    region: "main" | "navigation" | "header" | "footer" | "document";
    tag: string;
    role: string | null;
    label: string;
    value: string;
    disabled: boolean;
  }>;
  screenshotDataUrl: string;
  screenshotPath: string;
  stepCount: number;
  priorActionResult?: string;
}

export type ReplayResult =
  | {
      status: "success";
      runId: string;
      capabilityId: string;
      outputs: Record<string, unknown>;
    }
  | {
      status: "business_outcome";
      runId: string;
      capabilityId: string;
      code: string;
      details?: Record<string, unknown>;
    }
  | {
      status: "failure";
      runId: string;
      capabilityId: string;
      error: {
        category:
          | "recoverable_exhausted"
          | "hard_failure"
          | "policy"
          | "invalid_artifact";
        code: string;
        message: string;
        stepId?: string;
        expected?: unknown;
        observed?: unknown;
        evidencePaths: string[];
      };
    };

export function parseCapabilityArtifact(value: unknown): CapabilityArtifact {
  return CapabilityArtifactSchema.parse(value);
}

export function validateInvocationInputs(
  schema: Record<string, InputDefinition>,
  values: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const validated: Record<string, string | number | boolean> = {};
  for (const [name, definition] of Object.entries(schema)) {
    const value = values[name];
    if (value === undefined || value === null || value === "") {
      if (definition.required)
        throw new Error(`Missing required input: ${name}`);
      continue;
    }
    const expectedType =
      definition.type === "currency" ? "number" : definition.type;
    if (typeof value !== expectedType) {
      throw new Error(`Input ${name} must be ${definition.type}`);
    }
    const validatedValue = value as string | number | boolean;
    if (
      definition.allowedValues &&
      !definition.allowedValues.includes(validatedValue)
    ) {
      throw new Error(
        `Input ${name} must be one of: ${definition.allowedValues.join(", ")}`,
      );
    }
    validated[name] = validatedValue;
  }
  return validated;
}
