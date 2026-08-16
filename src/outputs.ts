import type { CapabilityArtifact } from "./contracts.js";
import { withinDeadline } from "./deadline.js";
import { AutomationError } from "./errors.js";
import type { SurfaceSession } from "./surface.js";

export function parseScalarOutput(
  value: string,
  parser: "string" | "number" | "currency" | "boolean",
  outputName: string,
): string | number | boolean {
  switch (parser) {
    case "string":
      return value;
    case "number": {
      const normalized = value.trim();
      const parsed = normalized.length === 0 ? Number.NaN : Number(normalized);
      if (!Number.isFinite(parsed)) {
        throw new AutomationError(
          "OUTPUT_PARSE_FAILED",
          `Could not parse number output ${outputName}`,
        );
      }
      return parsed;
    }
    case "currency": {
      const normalized = value.replace(/[$,]/g, "").trim();
      const parsed = normalized.length === 0 ? Number.NaN : Number(normalized);
      if (!Number.isFinite(parsed)) {
        throw new AutomationError(
          "OUTPUT_PARSE_FAILED",
          `Could not parse currency output ${outputName}`,
        );
      }
      return parsed;
    }
    case "boolean":
      if (/^(true|yes|1)$/i.test(value)) return true;
      if (/^(false|no|0)$/i.test(value)) return false;
      throw new AutomationError(
        "OUTPUT_PARSE_FAILED",
        `Could not parse boolean output ${outputName}`,
      );
  }
}

export async function extractOutputs(
  artifact: Pick<CapabilityArtifact, "outputBindings">,
  surface: SurfaceSession,
  deadlineMs: number,
  stepId?: string,
): Promise<Record<string, unknown>> {
  const outputs: Record<string, unknown> = {};
  for (const [name, binding] of Object.entries(artifact.outputBindings)) {
    outputs[name] =
      binding.kind === "literal"
        ? binding.value
        : parseScalarOutput(
            await withinDeadline(
              deadlineMs,
              stepId,
              () => surface.readControl(binding.source, "output"),
              () => surface.abort(),
            ),
            binding.parseAs,
            name,
          );
  }
  return outputs;
}
