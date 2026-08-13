import type { AgentProposal } from "./contracts.js";
import { createPrepareSubaccountArtifact } from "./sample-artifact.js";

export function createScriptedDiscoveryProposals(
  entryUrl: string,
): AgentProposal[] {
  const artifact = createPrepareSubaccountArtifact(entryUrl);
  return [
    ...artifact.steps.map((action): AgentProposal => ({
      kind: "act",
      action,
      reason: action.description,
      expectedEffect: action.checkpoint
        ? "The declared checkpoint becomes true."
        : "The field or control reflects the requested reversible change.",
    })),
    {
      kind: "complete",
      reason:
        "The review screen is visible, requested values match, and confirmation has not been executed.",
      success: artifact.success,
      outputs: artifact.outputBindings,
    },
  ];
}
