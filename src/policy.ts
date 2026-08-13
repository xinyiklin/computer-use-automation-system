import type {
  AutomationPolicy,
  CapabilityArtifact,
  CapabilityStep,
} from "./contracts.js";
import { AutomationPolicySchema } from "./contracts.js";
import { AutomationError } from "./errors.js";

export function createDefaultPolicy(origin: string): AutomationPolicy {
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
    maxRunMs: 120_000,
    allowedRiskClasses: ["safe", "reversible", "review_only"],
    blockedRiskClasses: ["irreversible", "credential", "external_navigation"],
    sensitiveInputRules: { memberId: "mask" },
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
