# Project Agent Guide

This repository is the interface.ai Computer-Use Automation System take-home
assignment. Product Brief `001` v1 and Delivery Plan `001` v1 are approved.
The approved baseline and no-key verification are implemented; genuine model
discovery and a person-operated handoff remain external evidence prerequisites.

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
- Stage: approved discovery-transport expansion; v2 implementation not started.
- Product scope: Product Brief v1 as amended by `CR001` v1 Option A, jointly approved by the user on 2026-08-13.
- Delivery Plan: v2 jointly approved by the user on 2026-08-13; it supersedes v1.
- Alignment Review: Delivery Plan v2 is aligned with Product Brief v1 as amended by `CR001` v1 Option A.
- Baseline implementation: executed within the prior approved scope; see the Implementation Report.
- V2 implementation: not started.
- Automated and clean-copy no-key gates: passed 23/23 tests.
- Genuine selected-backend discovery: unverified; no provider was called while drafting or approving v2.
- Person-operated same-session handoff: unverified pending user participation.

Do not describe the assignment as fully complete until genuine discovery and
person-operated handoff evidence exist and the Verification Report is updated.

## Ownership Map

- `ASSIGNMENT.md` is the immutable, source-faithful assignment reference. Never
  regenerate, reformat, rewrite, normalize, or summarize it in place.
- The original assignment PDF is the external source of truth if a discrepancy
  is discovered.
- `.agent-work/tasks/001/product-brief.md` owns approved product scope and
  acceptance criteria. It is local and ignored by Git.
- `.agent-work/tasks/001/delivery-plan.md` owns the approved technical design,
  phases, and verification strategy.
- `.agent-work/tasks/001/alignment-review.md` records the Product Partner's
  scope-alignment review of the Delivery Plan.
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
