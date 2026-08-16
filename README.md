# Computer-Use Automation System

A focused, synthetic demonstration of the interface.ai through-line:

> The model discovers. The artifact becomes a reusable capability. Deterministic replay is how an agent invokes it in production.

The project drives a visible, server-rendered credit-union back-office workflow. Discovery uses one bounded decision per observation through an explicitly selected OpenAI Responses API, Codex CLI, or Claude Code CLI transport. Successful actions become a strict JSON capability. Replay loads that artifact, performs no model calls, distinguishes domain outcomes from failures, enforces policy before every action, and stops at review before irreversible confirmation.

Only synthetic data is used. Do not point this project at a real institution or supply real member data.

## Requirements

- Node.js 24.x and npm
- Chromium installed through Playwright
- Provider-owned authentication for one explicitly selected genuine discovery
  transport: OpenAI Responses API, Codex CLI, or Claude Code CLI

```powershell
npm ci
npx playwright install chromium
npm run check
```

`npm run check` and every deterministic replay path work without an API key.

## No-key deterministic replay

Start the synthetic app in terminal A:

```powershell
npm run demo:app
```

In terminal B, replay the checked-in capability with invocation values different from the discovery example:

```powershell
npm run replay -- --artifact artifacts/prepare-subaccount.v1.json --inputs examples/replay-input-success.json
```

The result is typed JSON with `status: "success"`, a review summary, and evidence under a new `evidence/replay-.../` folder. The final confirmation route is not called.

The CLI policy independently defaults to `http://127.0.0.1:4317`; an artifact
can only narrow that configured origin. Use `--allowed-origin <origin>` or the
`AUTOMATION_ALLOWED_ORIGIN` environment variable for a different approved
synthetic deployment.

Expected business outcome:

```powershell
npm run replay -- --artifact artifacts/prepare-subaccount.v1.json --inputs examples/replay-input-not-found.json
```

This returns `status: "business_outcome"` and `code: "MEMBER_NOT_FOUND"`, not a browser exception.

Regenerate the checked-in, entirely local evidence set:

```powershell
npm run evidence:no-key
```

That command covers different-input success, missing member, transient recovery, permission denial, irreversible-action blocking, automated same-session handoff, and the scripted model seam. `evidence/discovery-scripted/` is deliberately labeled a test-double run and is not represented as genuine LLM evidence.

## Genuine discovery

Keep the synthetic app running on port 4317. In terminal B, set the key only in the process environment and run:

```powershell
$env:OPENAI_API_KEY="your-key"
npm run discover -- --transport openai --model gpt-5.6-sol --request examples/discovery-request.json --headed
```

The CLI validates the request, keeps sensitive invocation values out of the
provider prompt, opens the live surface, and runs a bounded observe → propose
→ policy → act loop. On verified completion it writes `capability.v1.json` in
the new discovery evidence folder. The key, prompts, cookies, raw model
transcript, and screenshot data URL are never persisted.

The approved CLI transports use provider-owned local authentication and never
receive sensitive values in process arguments:

```powershell
npm run discover -- --transport codex --model <codex-model> --request examples/discovery-request.json --headed
npm run discover -- --transport claude-code --model <claude-model> --request examples/discovery-request.json --headed
```

The default discovery bound is 120 seconds. For slower reasoning profiles,
use an explicit bounded override such as `--max-run-ms 300000`.

Codex runs ephemerally with user configuration, rules, shell, shell snapshots,
web search, and image-reading tools disabled; it receives an observation
screenshot only when no desired output is sensitive and the current state is
free of declared sensitive values, and it uses an xhigh reasoning profile.
Declared sensitive values are removed from provider-bound semantic state. If a
discovery request declares a sensitive output before it has a trusted binding,
the surface masks the full screenshot and every transport receives an opaque
page-state placeholder rather than potentially leaking an unknown value.
Claude Code runs without session persistence or
workspace customizations and permits its `Read` tool only for a shareable current
observation screenshot. Both child processes receive an explicit non-secret
environment allowlist, and both responses are parsed and validated by
`AgentProposalSchema` before discovery can act.

Verified genuine receipt: `evidence/discovery-2026-08-16T23-12-04-329Z-7439cb4f/`
was produced with `codex-cli:gpt-5.6-luna` at the local xhigh setting. Its
artifact was replayed model-free with different member, product, and nickname
inputs as `replay-2026-08-16T23-17-24-561Z-7432e8b8`. Discovery verifies the
live surface identity after entry, and its event stream records each external
transport invocation and completion with an invocation ID, bounded timeout,
registered adapter and runner, concrete process ID and executable, argument
and stdin digests, CLI exit/output-source receipt, actual schema-validation
result, and proposal digest. Discovery completion and both replays link the
same exact persisted-file-byte SHA-256,
`6b579c4bb9e05826855f83ca91a18942af95c8f3cc466950e5d8e7322fd75a39`.

Replay that newly discovered artifact while the app is still running:

```powershell
npm run replay -- --artifact evidence/<discovery-run>/capability.v1.json --inputs examples/replay-input-success.json
```

Only discovery constructs a model client. Replay has no OpenAI, CLI transport,
or `ModelClient` dependency, which a static boundary test enforces.

## Same-session human handoff

Use the headed handoff fixture:

```powershell
npm run replay:handoff -- --artifact artifacts/prepare-subaccount.v1.json --inputs examples/replay-input-handoff.json --max-run-ms 900000
```

When supervisor verification appears, automation changes ownership to `none`, then `human`. Complete the one synthetic manual action in the existing Chromium window and press Enter in the CLI. Only after explicit return does replay re-check the declared resume heading and restore automation ownership. Events include the unchanged surface-session identifier and no sensitive field values.

The person-operated receipt is
`evidence/replay-2026-08-16T23-17-36-117Z-37f35130/`. It records the trusted
person-operated CLI mode, headed surface, human control interval, unchanged
surface-session ID, the person-reported action description
`Clicked "Supervisor verified"`, independently observed resume state,
successful review output, the exact discovered-file-byte digest, zero model
decisions, and no confirmation action. The receipt does not claim independent
click telemetry.

## Result and artifact contracts

`src/contracts.ts` is the executable specification. The v1 artifact declares:

- typed inputs and outputs;
- ordered, declarative steps with no executable code;
- ordered locator candidates, exact cardinality, and robustness notes;
- compatibility origin, entry route, app family, variant, and landmarks;
- business outcomes, bounded recovery, checkpoints, and final success conditions;
- discovery provenance without transcripts or secrets.

Scalar output bindings are limited to stable labels or bounded relative leaf hints; arbitrary CSS containers are not valid scalar sources. Literal outputs require an explicit matching constant in the output contract. Field-aware artifact construction rejects raw, URL-encoded, numeric, or boolean invocation values in executable structural fields and output locators without confusing stable semantic labels for invocation data. Discovery resolves and parses every declared output, rejects broad or structured values, and rejects each scalar locator if it embeds its own live extracted value before saving the artifact.

The engine, not the CLI caller, derives declared-sensitive input names and values for evidence redaction and surface masking. Screenshot masking follows the values as well as field names, so a differently named DOM control or text node cannot expose a filled value. Sensitive output bindings are registered before replay observation. An unbound sensitive discovery output forces opaque semantic state and a page-wide screenshot mask; a replay output with a validated binding masks its resolved target. Every artifact must begin with entry navigation that resolves to the declared compatibility origin and route before any business action.

Configured policy independently blocks the confirmation control by stable
operator language even if an artifact mislabels its risk or hides the control
behind generic locator metadata: policy checks and interaction use the same
resolved DOM element, includes externally referenced accessible names, and ownership is re-checked immediately before acting. The artifact-intersected origin policy remains active for navigation initiated by clicks, and live application identity is re-checked after every action.
Sensitive output declarations must agree
between schema and binding, and both are registered with the evidence writer,
so callers receive declared outputs while persisted result files redact them.

Replay returns one of three top-level shapes: success, business outcome, or failure. Failure categories distinguish exhausted recovery, hard runtime failure, policy block, and invalid artifact.

## Useful commands

```powershell
npm run format:check
npm run typecheck
npm run test:unit
npm run test:integration
npm run check
```

Evidence is public-review material. `.env`, browser profiles, local caches, build output, and active `.agent-work/` workflow artifacts are ignored.
