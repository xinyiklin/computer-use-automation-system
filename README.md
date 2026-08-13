# Computer-Use Automation System

A focused, synthetic demonstration of the interface.ai through-line:

> The model discovers. The artifact becomes a reusable capability. Deterministic replay is how an agent invokes it in production.

The project drives a visible, server-rendered credit-union back-office workflow. Discovery uses one bounded OpenAI model decision per observation. Successful actions become a strict JSON capability. Replay loads that artifact, performs no model calls, distinguishes domain outcomes from failures, enforces policy before every action, and stops at review before irreversible confirmation.

Only synthetic data is used. Do not point this project at a real institution or supply real member data.

## Requirements

- Node.js 24.x and npm
- Chromium installed through Playwright
- `OPENAI_API_KEY` with access to `gpt-5.6-sol` only for genuine discovery

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
npm run discover -- --request examples/discovery-request.json --headed
```

The CLI validates the request, redacts the sensitive invocation value before persistence, opens the live surface, and runs a bounded observe → propose → policy → act loop. On verified completion it writes `capability.v1.json` in the new discovery evidence folder. The key, prompts, cookies, raw model transcript, and screenshot data URL are never persisted.

Replay that newly discovered artifact while the app is still running:

```powershell
npm run replay -- --artifact evidence/<discovery-run>/capability.v1.json --inputs examples/replay-input-success.json
```

Discovery is the only command that constructs the OpenAI adapter. Replay has no OpenAI import or `ModelClient` dependency, which a static boundary test enforces.

## Same-session human handoff

Use the headed handoff fixture:

```powershell
npm run replay:handoff -- --artifact artifacts/prepare-subaccount.v1.json --inputs examples/replay-input-handoff.json
```

When supervisor verification appears, automation changes ownership to `none`, then `human`. Complete the one synthetic manual action in the existing Chromium window and press Enter in the CLI. Only after explicit return does replay re-check the declared resume heading and restore automation ownership. Events include the unchanged surface-session identifier and no sensitive field values.

## Result and artifact contracts

`src/contracts.ts` is the executable specification. The v1 artifact declares:

- typed inputs and outputs;
- ordered, declarative steps with no executable code;
- ordered locator candidates, exact cardinality, and robustness notes;
- compatibility origin, entry route, app family, variant, and landmarks;
- business outcomes, bounded recovery, checkpoints, and final success conditions;
- discovery provenance without transcripts or secrets.

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
