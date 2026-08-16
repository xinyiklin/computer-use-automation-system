import type {
  AutomationPolicy,
  CapabilityArtifact,
  CapabilityStep,
} from "./contracts.js";
import { AutomationPolicySchema } from "./contracts.js";
import { AutomationError } from "./errors.js";

export function createDefaultPolicy(
  origin: string,
  options: {
    maxRunMs?: number;
    sensitiveInputNames?: Iterable<string>;
  } = {},
): AutomationPolicy {
  const sensitiveInputRules = Object.fromEntries(
    [...new Set(["memberId", ...(options.sensitiveInputNames ?? [])])].map(
      (name) => [name, "mask"],
    ),
  );
  return AutomationPolicySchema.parse({
    allowedOrigins: [origin],
    allowedRoutePatterns: [
      "^/backoffice/members/search(?:\\?.*)?$",
      "^/backoffice/members/[^/?]+(?:\\?.*)?$",
      "^/backoffice/members/[^/?]+/accounts/new(?:/review)?(?:\\?.*)?$",
      "^/backoffice/supervisor/verify(?:\\?.*)?$",
    ],
    allowedActionKinds: [
      "navigate",
      "click",
      "fill",
      "select",
      "read",
      "waitFor",
      "assert",
    ],
    maxSteps: 30,
    maxRunMs: options.maxRunMs ?? 120_000,
    allowedRiskClasses: ["safe", "reversible", "review_only"],
    blockedRiskClasses: ["irreversible", "credential", "external_navigation"],
    blockedControlPatterns: ["^confirm account creation$"],
    sensitiveInputRules,
  });
}

function routeAllowed(url: URL, policy: AutomationPolicy): boolean {
  return policy.allowedRoutePatterns.some((pattern) => {
    try {
      return new RegExp(pattern).test(`${url.pathname}${url.search}`);
    } catch {
      return false;
    }
  });
}

function controlPatternBlocked(
  values: readonly string[],
  policy: AutomationPolicy,
): boolean {
  return policy.blockedControlPatterns.some((pattern) => {
    let matcher: RegExp;
    try {
      matcher = new RegExp(pattern, "i");
    } catch {
      return true;
    }
    return values.some((value) => matcher.test(value));
  });
}

export function assertResolvedControlAllowed(
  values: readonly string[],
  policy: AutomationPolicy,
  stepId: string,
): void {
  if (!controlPatternBlocked(values, policy)) return;
  throw new AutomationError(
    "POLICY_CONTROL_BLOCKED",
    "Resolved control is independently blocked by configured policy",
    "policy",
    { stepId },
  );
}

export function assertUrlAllowed(
  rawUrl: string,
  policy: AutomationPolicy,
  stepId?: string,
): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AutomationError(
      "POLICY_INVALID_URL",
      "Navigation target is not a valid URL",
      "policy",
      { ...(stepId === undefined ? {} : { stepId }), observed: rawUrl },
    );
  }
  if (!policy.allowedOrigins.includes(url.origin)) {
    throw new AutomationError(
      "POLICY_ORIGIN_BLOCKED",
      `Origin is outside the configured allowlist: ${url.origin}`,
      "policy",
      { ...(stepId === undefined ? {} : { stepId }), observed: url.origin },
    );
  }
  if (!routeAllowed(url, policy)) {
    throw new AutomationError(
      "POLICY_ROUTE_BLOCKED",
      `Route is outside the configured allowlist: ${url.pathname}`,
      "policy",
      { ...(stepId === undefined ? {} : { stepId }), observed: url.pathname },
    );
  }
  return url;
}

export function assertStepAllowed(
  step: CapabilityStep,
  policy: AutomationPolicy,
): void {
  if (!policy.allowedActionKinds.includes(step.kind)) {
    throw new AutomationError(
      "POLICY_ACTION_BLOCKED",
      `Action kind is not allowed: ${step.kind}`,
      "policy",
      { stepId: step.id, observed: step.kind },
    );
  }
  if (
    policy.blockedRiskClasses.includes(step.riskClass) ||
    !policy.allowedRiskClasses.includes(step.riskClass)
  ) {
    throw new AutomationError(
      "POLICY_RISK_BLOCKED",
      `Risk class is blocked: ${step.riskClass}`,
      "policy",
      { stepId: step.id, observed: step.riskClass },
    );
  }

  if (
    (step.kind === "click" || step.kind === "fill" || step.kind === "select") &&
    controlPatternBlocked(
      [
        step.target.description,
        ...step.target.candidates.flatMap((candidate) => {
          switch (candidate.kind) {
            case "role":
              return [candidate.name];
            case "label":
            case "text":
              return [candidate.text];
            case "relative":
              return [candidate.anchorText];
            case "css":
              return [candidate.selector];
            case "coordinate":
              return [];
          }
        }),
      ],
      policy,
    )
  ) {
    throw new AutomationError(
      "POLICY_CONTROL_BLOCKED",
      "Control target is independently blocked by configured policy",
      "policy",
      { stepId: step.id, observed: step.target.description },
    );
  }
}

export function intersectArtifactPolicy(
  configured: AutomationPolicy,
  artifact: CapabilityArtifact,
): AutomationPolicy {
  const allowedOrigins = configured.allowedOrigins.filter((origin) =>
    artifact.compatibility.allowedOrigins.includes(origin),
  );
  if (allowedOrigins.length === 0) {
    throw new AutomationError(
      "POLICY_ARTIFACT_ORIGIN_MISMATCH",
      "Configured policy and artifact have no permitted origin in common",
      "policy",
    );
  }
  return AutomationPolicySchema.parse({
    ...configured,
    allowedOrigins,
  });
}

export function registerSensitiveInputRules(
  policy: AutomationPolicy,
  names: Iterable<string>,
): AutomationPolicy {
  return AutomationPolicySchema.parse({
    ...policy,
    sensitiveInputRules: {
      ...policy.sensitiveInputRules,
      ...Object.fromEntries([...names].map((name) => [name, "mask"])),
    },
  });
}
