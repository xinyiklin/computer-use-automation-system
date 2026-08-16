import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { DiscoveryRequest, Observation } from "../../src/contracts.js";
import {
  assertTransportReceiptMatchesExecution,
  canShareDiscoveryScreenshot,
  ClaudeCodeCliModelClient,
  CodexCliModelClient,
  createDiscoveryModelClient,
  discoveryProviderContext,
  discoveryTransportEnvironment,
  modelExecutionMetadata,
  type CommandInvocation,
  type DiscoveryModelInput,
  type ModelClient,
} from "../../src/model-client.js";
import { createScriptedDiscoveryProposals } from "../../src/scripted-discovery.js";

const entryUrl = "http://127.0.0.1:4317/backoffice/members/search";
const sensitiveMemberId = "M-SECRET-001";

const request: DiscoveryRequest = {
  goal: "Prepare a synthetic sub-account and stop at review.",
  target: {
    entryUrl,
    appFamily: "synthetic-credit-union",
    variant: "base",
  },
  inputs: {
    memberId: {
      type: "string",
      value: sensitiveMemberId,
      required: true,
      sensitive: true,
      description: "Synthetic member identifier.",
    },
  },
  desiredOutputs: {
    reviewHeading: {
      type: "string",
      description: "Review heading.",
    },
  },
};

const observation: Observation = {
  url: entryUrl,
  title: "Member search",
  semanticTree:
    'region=main h1[role=heading] name="Member search" value="" disabled=false',
  visibleText: "Member search",
  controls: [],
  screenshotDataUrl: "data:image/png;base64,synthetic",
  screenshotPath: "/tmp/synthetic-observation.png",
  stepCount: 0,
};

function proposal() {
  const value = createScriptedDiscoveryProposals(entryUrl)[0];
  if (!value) throw new Error("Expected a scripted proposal fixture");
  return value;
}

function input() {
  return {
    request,
    observation,
    priorSteps: [],
    remainingSteps: 30,
    timeoutMs: 12_345,
    signal: new AbortController().signal,
  };
}

describe("CLI discovery transports", () => {
  it("withholds provider screenshots when any desired output is sensitive", () => {
    const rawSensitiveOutput = "UNLABELED-PRIVATE-RESULT-42";
    const sensitiveOutputInput = {
      ...input(),
      observation: {
        ...observation,
        url: `${entryUrl}/${rawSensitiveOutput}`,
        title: rawSensitiveOutput,
        semanticTree: `region=main h1[role=heading] name="${rawSensitiveOutput}" value="" disabled=false`,
        visibleText: rawSensitiveOutput,
      },
      request: {
        ...request,
        desiredOutputs: {
          secretResult: {
            type: "string" as const,
            sensitive: true,
            description: "Sensitive result without trusted page markup.",
          },
        },
      },
    };
    expect(canShareDiscoveryScreenshot(sensitiveOutputInput)).toBe(false);
    const context = JSON.stringify(
      discoveryProviderContext(sensitiveOutputInput),
    );
    expect(context).not.toContain(rawSensitiveOutput);
    expect(context).toContain("WITHHELD_UNBOUND_SENSITIVE_OUTPUT");
  });

  it("uses stdin for Codex prompts and constrains the process", async () => {
    let invocation: CommandInvocation | undefined;
    let codexSchema: string | undefined;
    const client = new CodexCliModelClient("gpt-test", {
      command: "codex-test",
      run: async (received) => {
        invocation = received;
        const outputIndex = received.args.indexOf("--output-last-message");
        const outputPath = received.args[outputIndex + 1];
        if (!outputPath) throw new Error("Missing Codex output path");
        const schemaIndex = received.args.indexOf("--output-schema");
        const schemaPath = received.args[schemaIndex + 1];
        if (!schemaPath) throw new Error("Missing Codex schema path");
        codexSchema = await readFile(schemaPath, "utf8");
        await writeFile(
          outputPath,
          JSON.stringify({
            ...proposal(),
            success: { kind: "url_matches", pattern: "^/unused$" },
            outputs: null,
            interventionHint: null,
          }),
          "utf8",
        );
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    const modelInput = input();
    const completed = await client.propose(modelInput);
    expect(completed).toMatchObject({
      proposal: proposal(),
      receipt: {
        kind: "cli-process",
        exitCode: 0,
        outputSource: "schema-output-file",
        schemaValidated: true,
      },
    });
    expect(invocation?.command).toBe("codex-test");
    expect(invocation?.args).toEqual(
      expect.arrayContaining([
        "exec",
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--disable",
        "shell_tool",
        "--sandbox",
        "read-only",
        "--config",
        'approval_policy="never"',
        "--config",
        'model_reasoning_effort="xhigh"',
        "--config",
        'web_search="disabled"',
        "--image",
        observation.screenshotPath,
        "--model",
        "gpt-test",
      ]),
    );
    expect(invocation?.stdin).not.toContain(sensitiveMemberId);
    expect(invocation?.stdin).toContain('"sensitive":true');
    expect(invocation?.stdin).toContain("region=main");
    expect(invocation?.stdin).toContain("Never guess a future page heading");
    expect(invocation?.stdin).toContain(
      "Keep completion success conditions minimal",
    );
    expect(invocation?.stdin).toContain("Scalar output bindings");
    expect(invocation?.stdin).toContain("different invocation inputs");
    expect(invocation?.stdin).not.toContain("Member details");
    expect(invocation?.stdin).not.toContain("Prepare new sub-account");
    expect(invocation?.args).not.toContain(sensitiveMemberId);
    expect(invocation?.workingDirectory).toMatch(/cuas-discovery-/);
    expect(invocation?.timeoutMs).toBe(12_345);
    expect(invocation?.signal).toBe(modelInput.signal);
    expect(completed.receipt).toMatchObject({
      executable: "codex-test",
      argumentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      stdinSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(codexSchema).toContain('"type":"object"');
    expect(codexSchema).not.toContain('"oneOf"');
    expect(codexSchema).not.toContain('"propertyNames"');
    expect(codexSchema).toContain('"anyOf"');
  });

  it("gives CLI transports the full remaining discovery budget by default", async () => {
    const remainingRunMs = 180_000;
    let invocation: CommandInvocation | undefined;
    const client = new CodexCliModelClient("gpt-test", {
      command: "codex-test",
      run: async (received) => {
        invocation = received;
        const outputIndex = received.args.indexOf("--output-last-message");
        const outputPath = received.args[outputIndex + 1];
        if (!outputPath) throw new Error("Missing Codex output path");
        await writeFile(outputPath, JSON.stringify(proposal()), "utf8");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    await client.propose({ ...input(), timeoutMs: remainingRunMs });

    expect(invocation?.timeoutMs).toBe(remainingRunMs);
  });

  it("honors an explicit CLI timeout override", async () => {
    const explicitTimeoutMs = 30_000;
    let invocation: CommandInvocation | undefined;
    const client = new CodexCliModelClient("gpt-test", {
      command: "codex-test",
      timeoutMs: explicitTimeoutMs,
      run: async (received) => {
        invocation = received;
        const outputIndex = received.args.indexOf("--output-last-message");
        const outputPath = received.args[outputIndex + 1];
        if (!outputPath) throw new Error("Missing Codex output path");
        await writeFile(outputPath, JSON.stringify(proposal()), "utf8");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });

    await client.propose({ ...input(), timeoutMs: 180_000 });

    expect(invocation?.timeoutMs).toBe(explicitTimeoutMs);
  });

  it("parses Claude Code structured output while allowing only screenshot reads", async () => {
    let invocation: CommandInvocation | undefined;
    const client = new ClaudeCodeCliModelClient("claude-test", {
      command: "claude-test",
      run: async (received) => {
        invocation = received;
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            type: "result",
            structured_output: proposal(),
          }),
          stderr: "",
        };
      },
    });

    await expect(client.propose(input())).resolves.toMatchObject({
      proposal: proposal(),
      receipt: {
        kind: "cli-process",
        exitCode: 0,
        outputSource: "stdout",
        schemaValidated: true,
      },
    });
    expect(invocation?.command).toBe("claude-test");
    expect(invocation?.args).toEqual(
      expect.arrayContaining([
        "--print",
        "--no-session-persistence",
        "--output-format",
        "json",
        "--safe-mode",
        "--permission-mode",
        "dontAsk",
        "--tools",
        "Read",
        "--allowed-tools",
        `Read(${observation.screenshotPath})`,
        "--model",
        "claude-test",
      ]),
    );
    const allowedToolsIndex = invocation?.args.indexOf("--allowed-tools") ?? -1;
    expect(invocation?.args[allowedToolsIndex + 1]).toBe(
      `Read(${observation.screenshotPath})`,
    );
    expect(invocation?.stdin).toContain(observation.screenshotPath);
    expect(invocation?.args).not.toContain(sensitiveMemberId);
  });

  it("redacts provider observations and withholds screenshots after sensitive input", async () => {
    const encodedSensitiveValue = "A/B";
    const contaminatedObservation: Observation = {
      ...observation,
      url: `${entryUrl}/${encodeURIComponent(encodedSensitiveValue)}`,
      semanticTree: `region=main input[role=textbox] name="Customer reference" value="${encodedSensitiveValue}" disabled=false`,
      visibleText: `Customer reference ${encodedSensitiveValue}`,
      controls: [
        {
          region: "main",
          tag: "input",
          role: "textbox",
          label: "Customer reference",
          value: encodedSensitiveValue,
          disabled: false,
        },
      ],
    };
    const contaminatedInput: DiscoveryModelInput = {
      request: {
        ...request,
        goal: `Look up ${encodedSensitiveValue} and stop at review.`,
        inputs: {
          ...request.inputs,
          memberId: {
            type: "string",
            value: encodedSensitiveValue,
            required: true,
            sensitive: true,
            description: "Synthetic member identifier.",
          },
        },
      },
      observation: contaminatedObservation,
      priorSteps: [{ id: "fill-reference", kind: "fill", result: "ok" }],
      remainingSteps: 29,
      timeoutMs: 4_321,
    };
    const context = discoveryProviderContext(contaminatedInput);
    expect(JSON.stringify(context)).not.toContain(encodedSensitiveValue);
    expect(JSON.stringify(context)).not.toContain(
      encodeURIComponent(encodedSensitiveValue),
    );
    expect(JSON.stringify(context)).toContain('"sensitive":true');
    expect(canShareDiscoveryScreenshot(contaminatedInput)).toBe(false);

    let codexInvocation: CommandInvocation | undefined;
    const codex = new CodexCliModelClient("gpt-test", {
      command: "codex-test",
      run: async (received) => {
        codexInvocation = received;
        const outputIndex = received.args.indexOf("--output-last-message");
        const outputPath = received.args[outputIndex + 1];
        if (!outputPath) throw new Error("Missing Codex output path");
        await writeFile(outputPath, JSON.stringify(proposal()), "utf8");
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    await expect(
      codex.propose({
        ...contaminatedInput,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      proposal: proposal(),
      receipt: { kind: "cli-process", exitCode: 0, schemaValidated: true },
    });
    expect(codexInvocation?.args).not.toContain("--image");
    expect(codexInvocation?.stdin).not.toContain(encodedSensitiveValue);
    expect(codexInvocation?.stdin).not.toContain(
      encodeURIComponent(encodedSensitiveValue),
    );
    expect(codexInvocation?.timeoutMs).toBe(4_321);
    expect(codexInvocation?.stdin).not.toContain(
      contaminatedObservation.screenshotPath,
    );

    let claudeInvocation: CommandInvocation | undefined;
    const claude = new ClaudeCodeCliModelClient("claude-test", {
      command: "claude-test",
      run: async (received) => {
        claudeInvocation = received;
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            type: "result",
            structured_output: proposal(),
          }),
          stderr: "",
        };
      },
    });
    await expect(
      claude.propose({
        ...contaminatedInput,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      proposal: proposal(),
      receipt: { kind: "cli-process", exitCode: 0, schemaValidated: true },
    });
    expect(claudeInvocation?.args).not.toContain("--allowed-tools");
    expect(claudeInvocation?.args).toContain("");
    expect(claudeInvocation?.stdin).not.toContain(encodedSensitiveValue);
    expect(claudeInvocation?.stdin).not.toContain(
      encodeURIComponent(encodedSensitiveValue),
    );
    expect(claudeInvocation?.timeoutMs).toBe(4_321);
    expect(claudeInvocation?.stdin).not.toContain(
      contaminatedObservation.screenshotPath,
    );
  });

  it("does not expose provider stderr or prompt values in transport errors", async () => {
    const client = new ClaudeCodeCliModelClient(undefined, {
      command: "claude-test",
      run: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: `provider failure for ${sensitiveMemberId}`,
      }),
    });

    const error = await client
      .propose(input())
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "The selected discovery transport exited without a proposal",
    );
    expect((error as Error).message).not.toContain(sensitiveMemberId);
  });

  it("passes only non-secret runtime variables to CLI transports", () => {
    expect(
      discoveryTransportEnvironment({
        HOME: "/tmp/home",
        PATH: "/usr/bin",
        OPENAI_API_KEY: "secret-openai-key",
        ANTHROPIC_API_KEY: "secret-anthropic-key",
        AWS_SECRET_ACCESS_KEY: "secret-aws-key",
      }),
    ).toEqual({ HOME: "/tmp/home", PATH: "/usr/bin" });
  });

  it("selects only the approved discovery transports", () => {
    expect(createDiscoveryModelClient("codex", "gpt-test")).toBeInstanceOf(
      CodexCliModelClient,
    );
    expect(
      createDiscoveryModelClient("claude-code", "claude-test"),
    ).toBeInstanceOf(ClaudeCodeCliModelClient);
  });

  it("derives external execution from registered adapters instead of caller labels", () => {
    const impostor: ModelClient = {
      transport: "codex-cli",
      executionKind: "external",
      modelIdentifier: "caller-claimed-model",
      propose: async () => ({
        proposal: proposal(),
        receipt: {
          kind: "cli-process",
          exitCode: 0,
          outputSource: "stdout",
          schemaValidated: true,
          executable: "fake",
          argumentSha256: "0".repeat(64),
          stdinSha256: "0".repeat(64),
        },
      }),
    };
    expect(modelExecutionMetadata(impostor)).toMatchObject({
      executionKind: "test-double",
      adapterImplementation: "unregistered-model-client",
      runnerKind: "injected",
    });

    const registered = createDiscoveryModelClient("codex", "gpt-test");
    const metadata = modelExecutionMetadata(registered);
    expect(metadata).toMatchObject({
      executionKind: "external",
      adapterImplementation: "codex-cli-schema-file-v1",
      runnerKind: "builtin-process",
    });
    expect(() =>
      assertTransportReceiptMatchesExecution(metadata, {
        kind: "cli-process",
        exitCode: 0,
        outputSource: "stdout",
        schemaValidated: true,
        executable: "codex",
        argumentSha256: "0".repeat(64),
        stdinSha256: "0".repeat(64),
      }),
    ).toThrow(/lacks concrete process attestation/);
  });
});
