# Project Agent Guide

This repository is the interface.ai Computer-Use Automation System take-home
assignment. Product Brief `001` v1 as amended by `CR001` v1 Option A and
Delivery Plan `001` v2 are approved.
The approved baseline and no-key verification are implemented; genuine model
discovery and person-operated same-session handoff receipts are captured.
Independent final working-tree verification passed; exact-head publication
remains pending.

`AGENTS.md` is the provider-neutral project guide. Keep it concise and route to
the owning source instead of copying large source or planning documents here.

## Instruction Precedence

1. The user's current instructions.
2. Safety, privacy, data integrity, and secret handling.
3. The original assignment PDF, represented locally by immutable
   `ASSIGNMENT.md`.
4. The exact approved Product Brief, then the exact approved Delivery Plan.
5. Current project guidance and durable state in `CONTINUITY.md`.
6. Existing code and conventions once implementation exists.

Never silently weaken an assignment requirement. If a discrepancy is found,
the original PDF wins over `ASSIGNMENT.md`.

## Current Stage

- Task: `[TASK 001]`.
- Stage: approved discovery-transport expansion; implementation, required live evidence, and independent exact-tree verification are complete, while publication is pending.
- Product scope: Product Brief v1 as amended by `CR001` v1 Option A, jointly approved by the user on 2026-08-13.
- Delivery Plan: v2 jointly approved by the user on 2026-08-13; it supersedes v1.
- Alignment Review: durable state records that Delivery Plan v2 was aligned with Product Brief v1 as amended by `CR001` v1 Option A. The exact ignored review is absent, so the current verifier could not independently re-evaluate that alignment.
- Baseline implementation: executed within the prior approved scope; see the Implementation Report.
- V2 implementation: transport slice, required live evidence, and independent working-tree confirmation are complete.
- Full local and isolated clean-copy gates: passed 93/93 tests on Node 24.19.0; no-key evidence passed with zero model replay decisions and zero confirmation attempts.
- Genuine selected-backend discovery: verified in `discovery-2026-08-16T23-12-04-329Z-7439cb4f` with the contained `codex-cli:gpt-5.6-luna` transport at xhigh and eight concrete external-process receipts; its exact persisted-file-byte SHA-256 `6b579c4bb9e05826855f83ca91a18942af95c8f3cc466950e5d8e7322fd75a39` is linked to the different-input, model-free replay `replay-2026-08-16T23-17-24-561Z-7432e8b8`.
- Person-operated same-session handoff: verified in `replay-2026-08-16T23-17-36-117Z-37f35130` with a headed surface, trusted person-operated CLI mode, one unchanged surface-session ID, a person-reported action description `Clicked "Supervisor verified"`, independently verified resume state, and successful completion.
- Independent final verification: no application defects found; assignment sections 3.1–3.7 passed. Private-plan alignment remains unverified because the exact ignored planning artifacts are absent.

Do not describe the assignment as fully published until the reviewed exact head
passes PR/CI checks and is merged.

## Ownership Map

- `ASSIGNMENT.md` is the immutable, source-faithful assignment reference. Never
  regenerate, reformat, rewrite, normalize, or summarize it in place.
- The original assignment PDF is the external source of truth if a discrepancy
  is discovered.
- `.agent-work/tasks/001/product-brief.md` owns approved product scope and
  acceptance criteria. It is local and ignored by Git. The exact file is not
  present in this clone; do not reconstruct or claim to re-verify its wording.
- `.agent-work/tasks/001/delivery-plan.md` owns the approved technical design,
  phases, and verification strategy. The exact file is not present in this
  clone; `CONTINUITY.md` retains only the durable approval record.
- `.agent-work/tasks/001/alignment-review.md` records the Product Partner's
  scope-alignment review of the Delivery Plan. The exact file is not present
  in this clone, so final verification must mark private-plan alignment
  unverified rather than fabricate it.
- `CONTINUITY.md` owns compact durable state, decisions, and the next action; it
  must remain useful without ignored local artifacts.
- The initial implementation study is local, ignored, and non-authoritative.
  Read only relevant sections and never promote its technical choices over the
  approved brief or plan.
- `.agent-work/tasks/001/implementation-report.md` records execution and the
  Delivery Lead's self-verification.
- Root `README.md`, root `REPORT.md`, `/artifacts/`, and `/evidence/` are public
  assignment deliverables. They must reflect actual behavior and evidence.
- `src/` owns executable behavior; `tests/` owns automated verification.
- `docs/engineering/git-workflow.md` owns branch, commit, PR, exact-head
  review, merge, and publication conventions.

## Product-Delivery Workflow

Use the installed `product-delivery` workflow:

1. Product Partner defines why and what in a versioned Product Brief.
2. The user explicitly approves that exact Product Brief version.
3. Delivery Lead inspects the repository and drafts a versioned Delivery Plan.
4. Product Partner performs an Alignment Review.
5. The user explicitly approves that exact Delivery Plan version.
6. Delivery Lead executes, self-verifies, and records an Implementation Report.
7. A fresh Verifier independently checks the result unless the user explicitly
   waives that review, and a Verification Report records the evidence.

Product Brief approval never approves technical implementation. Delivery Plan
approval is required before implementation. Do not self-approve either
artifact. Create Decision Logs and Change Requests only when their documented
triggers occur, never as empty placeholders.

A user-facing behavior change, weakened acceptance criterion, material scope
expansion, destructive migration risk, or new security/privacy implication
after approval requires a Change Request and a newly approved artifact version.

One fresh Verifier is the default, not the ceiling. If the user asks for more
reviewers, give a firm risk-based recommendation first, then honor the request.
Expect a second reviewer for the policy boundary, the human-handoff session
contract, capability-artifact serialization, and any evidence claimed as
genuine — those are the places a single reviewer is most likely to accept an
unproven pass.

Task artifact retention: `.agent-work/` stays local and Git-ignored, and
`CONTINUITY.md` is tracked, so every continuity entry must stand on its own
without the ignored artifacts. Confirmed deliberately — this repository is an
assignment submission, and internal planning artifacts are not part of it.
Revisit only if the user wants the task folders committed.

## Hard Invariants

- `ASSIGNMENT.md` is immutable and assignment requirements may not be silently
  weakened.
- Discovery must eventually include at least one genuine LLM-driven run against
  a live UI.
- Deterministic replay must not use an LLM for decisions.
- Every automated navigation and UI action must pass through a code-enforced
  policy boundary.
- Capability artifacts must be typed, versioned, parameterized, reviewable,
  serializable, and free of arbitrary executable code.
- Expected business outcomes must remain distinct from recoverable automation
  conditions and hard failures.
- Human handoff must preserve the same live browser session.
- Automation must not act while a human owns control.
- Only synthetic data may be used.
- Secrets, tokens, credentials, cookies, private keys, and real PII may not be
  persisted in source, artifacts, logs, screenshots, traces, or evidence.
- Risky and irreversible actions require conservative policy treatment. The
  approved baseline stops at review and does not confirm account creation.
- No optional stretch goal, database, queue, cloud architecture, desktop
  implementation, polished operator dashboard, or multi-provider system may be
  added before all baseline requirements pass.
- Before adding dependencies, verify current compatible stable versions from
  official sources instead of relying on model memory.

## Verification Expectations

Run `npm run check` for formatting, strict typecheck, and all automated tests.
Run `npm run evidence:no-key` to regenerate the curated synthetic evidence.
Verification must map every numbered acceptance criterion to observable
evidence and report checks as passed, failed, unverified, or skipped; missing
evidence is never a pass.

Browser verification will be required for changes involving the local target
application flow, observation construction, locator resolution, UI action
execution, checkpoints, business outcomes, deterministic replay, human
handoff, screenshots, traces, or submission evidence.

## Privacy And Evidence

- Keep configuration secrets in untracked environment files; provide safe
  examples without values when implementation begins.
- Use synthetic identities and account data only.
- Redact sensitive values before persistence, including provider and browser
  errors.
- Do not persist browser-session state, cookies, tokens, raw credentials, or
  unrestricted page data.
- Final `/evidence/` must be genuine, sanitized, generated by checked-in code,
  and must not be ignored once it exists.

## Scope Discipline

Prefer a thin but real end-to-end vertical slice covering every must-have.
Do not add speculative generality or optional stretch work. Heterogeneous
surface and multi-tenant reuse requirements need credible design treatment;
they do not authorize baseline desktop or multi-tenant infrastructure.

Keep implementation scope literal. An improvement you notice but the approved
plan does not require gets presented to the user and waits for approval, even
in a file you are already editing.

Comment only for non-obvious rationale, constraints, or safety — the policy
boundary, redaction rules, and replay determinism are the kind that earn one.
Do not narrate self-explanatory code.

Once a dependency change is authorized, verify the current stable release from
npm or the maintainer's release notes, prefer the latest compatible stable
version, update `package-lock.json`, and explain any deliberate pin. This
extends the Hard Invariant above with the mechanics.
