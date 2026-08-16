# Continuity

## Current State

- Goal: complete the interface.ai Computer-Use Automation System take-home assignment.
- Active task: `[TASK 001]`.
- Product scope: Product Brief v1 as amended by `CR001` v1 Option A, jointly approved by the user on 2026-08-13.
- Delivery Plan: v2 jointly approved with exact response `APPROVE CR001 v1 OPTION A AND DELIVERY PLAN 001 v2` on 2026-08-13; it supersedes v1.
- Implementation: approved baseline source, tests, documentation, and no-key evidence are complete.
- Discovery-transport expansion implementation: transport slice implemented locally; approved scope is the existing Responses API adapter plus explicitly selectable Codex CLI and Claude Code CLI adapters.
- Verification: fresh local and isolated clean-copy gates passed 93/93 tests on Node 24.19.0; no-key evidence regeneration passed with zero model replay decisions and zero confirmation attempts.
- Independent post-fix confirmation: eleven earlier verifier passes surfaced sixty-six findings or limitations. Executable defects were remediated with focused regressions, including scalar-output scope, popup navigation, hard-deadline cleanup, live discovery identity, concrete transport attestation, exact persisted-byte replay provenance, caller sanitization, and cleanup independence. A twelfth, final exact-tree verifier found no application defects and passed assignment sections 3.1–3.7. The exact ignored planning artifacts remain unavailable in this clone, and the person-operated action is intentionally represented as a person-reported description plus independently observed same-session resume state.
- Genuine discovery receipt: `evidence/discovery-2026-08-16T23-12-04-329Z-7439cb4f/` was produced by the explicitly selected, tool-disabled `codex-cli:gpt-5.6-luna` transport at xhigh with generic region-aware guidance, verified live identity, engine-owned value redaction, independently configured policy, and eight concrete external-process receipts from the registered built-in runner; its exact persisted-file-byte SHA-256 `6b579c4bb9e05826855f83ca91a18942af95c8f3cc466950e5d8e7322fd75a39` is linked to the model-free different-input replay `replay-2026-08-16T23-17-24-561Z-7432e8b8` with no raw sensitive member input.
- Person-operated handoff receipt: `evidence/replay-2026-08-16T23-17-36-117Z-37f35130/` links the same exact file-byte digest and records `automation → human → automation`, trusted `person-operated-cli` execution on a headed surface, one unchanged surface-session ID, the person-reported description `Clicked "Supervisor verified"`, independently verified resume state, successful review output, and no confirmation action on the current source.
- Required live evidence is present, including the exact-byte-bound discovery refresh without app-specific prompt landmarks; evidence curation and independent final verification are complete.
- Publication receipt: PR `#1` squash-merged exact reviewed head `2fa1a124075c1c0f77865162b3c24716e7999f3b` to `main` as `1803ecea046beb42cec016decc7dcd2afd7ceb80` at `2026-08-16T23:50:55Z`. Immediately before merge, GitHub returned `mergeable: true`, `draft: false`, an empty review-thread list, no workflow runs, and no commit statuses; the main-branch protection query returned `Branch not protected`. Post-merge `git pull --ff-only origin main` advanced local `main` from `97ea610992e43532e197a1884f15e46ae2f7220d` to `1803ecea046beb42cec016decc7dcd2afd7ceb80`; the reviewed and merged tree IDs both equal `411bf51691688c6a9aa50aadd967bf1e8b94a484`, and the local and remote feature refs were removed.
- No provider credentials, raw transcripts, or real data were persisted; the genuine run used only the synthetic target and sanitized evidence.
- `.agent-work/` remains local and ignored by design.
- The exact ignored Product Brief, Delivery Plan, and Alignment Review files are absent from this clone. Their approval/version record above is durable, but plan-to-implementation alignment must remain unverified unless the originals are restored.

## Implemented Baseline

- Strict Node.js 24 / TypeScript package with exact locked dependencies.
- Local server-rendered synthetic credit-union surface with deterministic success, not-found, transient, permission, and supervisor fixtures.
- Strict declarative capability schema with typed I/O, ordered locator candidates, compatibility metadata, outcomes, recovery, checkpoints, and provenance.
- Model-free Playwright replay with centralized policy, normalized results, masked screenshots, and append-only sanitized JSONL evidence.
- Explicitly selectable OpenAI Responses API, Codex CLI, and Claude Code CLI discovery adapters plus a scripted no-key test double behind `ModelClient`.
- Same-session ownership coordinator and manual headed CLI handoff seam.
- Heading-aware headed discovery observations, post-action checkpoint guidance, bounded `--max-run-ms` override, and replay-safe evidence sanitization for declarative input schemas.
- Region-aware semantic observations and code-enforced portability checks reject output locators or executable artifact behavior tied to one discovery run's values.
- CLI origin authority is independently configured, known irreversible controls have a policy-owned backstop, and declared-sensitive outputs are redacted from persisted results.
- Provider-bound observations redact declared sensitive values generically and withhold screenshots whenever a desired output is sensitive or sensitive input may have reached the page; discovery resolves and parses every declared output before emitting an artifact.
- Model transports receive only the remaining discovery time budget and return sanitized runner receipts containing the process exit result, output source, and actual schema-validation result; output constants, parser types, and sensitivity metadata are contract-checked.
- External CLI evidence is accepted only from module-registered adapters and runners and records concrete process ID, executable, argument digest, stdin digest, output source, exit result, and schema-validation result; caller-supplied clients remain test doubles.
- Resolved DOM controls use the same checked element handle for interaction, ownership is re-checked after resolution, and every action receives the remaining hard wall-clock budget.
- Runtime surface kind, application family, and variant are read from the live page and matched against the artifact before business actions.
- Runtime identity is re-checked after every action and recovery, while the artifact-intersected policy remains active for click-triggered navigation throughout the session.
- Discovery verifies the live surface identity and entry origin before subsequent observation or action; every navigation request, including pre-frame popup navigation, is policy checked and additional pages are closed and rejected.
- Discovery and replay derive sensitive names and values inside the engine for direct API callers. Declared output targets and unmarked label-associated output values are redacted from semantic observations and masked in persisted screenshots; aggregate evidence is sanitized through the same field contract.
- Resolved-control policy includes `aria-labelledby` names and every associated label; dynamically declared sensitive input names flow into surface masking.
- Discovery `stuck` proposals carry a declarative resume condition and can use the same ownership coordinator and live-session operator seam as replay.
- Portability checks cover compatibility metadata, executable structural fields, business-outcome details, and output locators while avoiding false positives from stable semantic labels; scalar outputs allow only labels or bounded relative leaf hints, never arbitrary CSS containers, and every scalar binding is checked against its own live extracted output. Parse failures never include the raw UI value.
- Every nested input reference is declaration-checked; scalar output locators are also checked against invocation values, blank numeric outputs fail parsing, and sensitive primitive values redact under generic keys.
- One abort-aware hard deadline owns browser startup, observation, conditions, runtime reads, output extraction, human callbacks, surface cancellation, and bounded cleanup. Deadline expiry returns without waiting for a hung operation or cancellation hook; late browser, context, and page creation is closed. Trusted declarative output bindings remain serializable while unvalidated sensitive proposals remain redacted.
- Sensitive values are masked in controls and text nodes independently of DOM field names. Unbound sensitive discovery outputs force opaque provider state and a page-wide screenshot mask; validated replay outputs mask their resolved targets.
- Artifact validation requires entry navigation before business actions and rejects the unimplemented `near` locator relation.
- Root `README.md`, exact-heading `REPORT.md`, saved artifact, examples, and curated `/evidence/`.

## Verification Evidence

- `npm run check`: formatting, strict typecheck, 10 test files, 93 tests passed after the transport-attestation, exact-byte replay provenance, popup-policy, hard-deadline, scalar-output, engine-owned redaction, discovery-handoff, runtime-identity, same-element policy, caller-sanitization, cleanup-independence, and remaining-budget changes.
- `npm run evidence:no-key`: scripted discovery and six replay/exception/handoff results generated; confirm attempts `0`.
- Impeccable detector: no findings on `src/demo-app/pages.ts`.
- Desktop, 390px mobile, and final review screenshots inspected.
- Fresh isolated clean copy passed `npm ci`, formatting, strict typecheck, 10 test files, and 93/93 tests; its no-key evidence regeneration recorded zero model replay decisions and zero confirmation attempts.
- Secret-shaped scan found only the deliberate redaction unit-test fixture.
- `ASSIGNMENT.md` remains byte-identical at SHA-256 `524F18AB42E1C1D378ACD1F72797E90597084457A0FEBFAFC38073A2134EA955`.

## Immediate Next Actions

1. No remaining action for `[TASK 001]`; retain the evidence and publication receipts.
2. Start newly approved scope or a documented Change Request before further user-facing behavior changes.

## Scope And Invariants

- `ASSIGNMENT.md` is immutable and the original PDF wins on discrepancy.
- Replay must remain model-free and every automated action must remain policy checked.
- Final account confirmation remains blocked and unexecuted.
- Only synthetic data is permitted; no keys, cookies, credentials, or real PII may be persisted.
- Optional stretch goals, provider routing/fallback, and general multi-provider infrastructure remain outside approved scope.
- `CR001` v1 Option A is the only approved scope amendment. It permits exactly the Responses API, Codex CLI, and Claude Code CLI discovery transports under Delivery Plan v2.
