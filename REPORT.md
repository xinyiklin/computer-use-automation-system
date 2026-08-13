## Architecture

The system is one strict TypeScript package with two processes during a demo: a minimal Express target and an automation CLI. The synthetic target deliberately resembles a legacy back-office web app: server-rendered pages, tables, full-page navigation, stable operator language, and no test IDs. It offers deterministic fixtures for success, missing member, one transient load, permission denial, and a supervisor interstitial. There is no database, login system, queue, service mesh, or operator dashboard.

Two seams carry the design. `ModelClient` proposes one discovery action from a compact semantic observation plus screenshot. `SurfaceSession` observes, locates, acts, reads, checks conditions, and preserves a live session. Discovery alone imports the OpenAI adapter. Replay accepts only a validated artifact, values, policy, surface, evidence writer, and optional operator; a test asserts that it has no OpenAI or model-client import.

The order is intentional: policy validates, the surface acts, runtime state is classified, then the replay engine evaluates the checkpoint. That ordering lets “member not found” remain a business result and a transient page enter bounded recovery instead of being flattened into “heading missing.” Evidence is append-only JSONL plus sanitized surface snapshots and masked screenshots. The target is local because it gives repeatable exceptional states without third-party terms, rate limits, credentials, or drift.

## Artifact schema

The v1 JSON artifact is an agent-invocable contract rather than a model transcript. It has an explicit schema and capability version; identity, description, and maximum risk; compatibility metadata; typed input and output definitions; ordered steps; business-outcome rules; output bindings; a final success condition; and narrow discovery provenance.

Steps form a closed declarative union: navigate, click, fill, select, read, wait, and assert. Values are literals or named invocation inputs. Conditions are visible, hidden, URL, text, value, and explicit boolean composition. No JavaScript, shell, function, loop, or arbitrary branch can be serialized. Zod rejects unknown keys, unknown discriminants, duplicate step IDs, missing output bindings, and references to undeclared inputs.

Each control stores human language, a robustness explanation, exact expected cardinality, and candidates attempted in recorded order. Accessible role or label comes first; visible text, relative landmark, CSS, and coordinate descriptions remain available for less semantic surfaces. Zero matches stop. Multiple matches stop. The engine never selects the first of several ambiguous controls. Typed output bindings read review values through the same controls and built-in scalar parsers. Sensitive metadata drives redaction rather than changing the business shape returned to the in-process caller.

## Determinism & error handling

Replay validates artifact and inputs, intersects artifact origins with configured policy, navigates to the entry point, and checks route and required landmarks before typing. It executes the stored sequence with fixed locator order and exact cardinality. Every material action has an optional postcondition, and success requires the review URL, heading, confirm control visibility, and exact supplied product and nickname. Visibility of the confirm control proves the review state; policy and step risk prevent it from being pressed. The demo server independently counts confirmation requests, and evidence generation asserts zero.

The public result separates success with typed outputs, expected business outcome, and normalized failure. Failure categories distinguish recovery exhaustion, hard application or surface failure, policy, and invalid artifact. The missing-member detector runs before the search checkpoint. The delayed-member fixture exposes `TRANSIENT_LOAD_TIMEOUT`; its artifact rule permits at most two model-free reload attempts. Permission denial stops with its code, step, expected or observed context, JSONL events, and a masked screenshot. Raw Playwright stacks are not the caller contract.

Discovery is separately bounded by step count, wall time, repeated proposal count, schema validation, policy, and verified completion. A model cannot declare success unless its declarative condition is true. The checked-in scripted run tests this same seam without claiming to be genuine; a separately key-gated run supplies the required real-model evidence.

## Heterogeneity & multi-tenant

The artifact records business intent and abstract controls; `SurfaceSession` implements perception and action. A legacy web adapter can map role, label, text, relative, CSS, frame path, or recorded coordinates to DOM, accessibility, OCR, or visual targeting without changing typed inputs, outcomes, or success conditions. A desktop adapter would map the same control vocabulary to UI Automation or accessibility nodes and screen coordinates. The current baseline executes web controls only and fails clearly for a recorded frame path rather than pretending desktop or hostile-frame support exists.

Compatibility metadata is fail-closed: surface kind, app family, optional variant, allowed origins, entry route, and required landmarks must match before business actions. At scale, one reviewed base capability would belong to a vendor-family/version range. Tenant variants could supply narrow, reviewable control-candidate or route overrides that only specialize the base; they could not broaden risk or origin policy. Preflight landmarks and post-action checkpoints act as drift sensors. A missing or ambiguous landmark, unsupported version, changed outcome, or failed checkpoint stops replay and routes review instead of guessing. Successful tenant-specific discoveries would become proposed versioned overrides, not silent mutations of the shared artifact.

## Escalation & handoff

Runtime intervention is modeled as ownership, not a fresh browser launch. The coordinator moves `automation → none/waiting → human → none/resuming → automation`. All automated action entry points re-check ownership immediately before acting. The intervention file carries the capability or goal, current step, stop reason, sanitized visible state, evidence paths, resume condition, and surface-session identifier.

The minimal operator surface is a headed browser plus CLI prompt. For the supervisor fixture, the person acts in the already-open page and explicitly returns control. The coordinator records a sanitized human-action description, re-evaluates the declared “Prepare new sub-account” resume heading in that same session, and resumes only if it is true. Tests also use a scripted operator at the same seam and verify event ordering and one unchanged session ID. Human actions are evidence, never inserted into deterministic capability steps.

## Safety

Configured policy allowlists exact local origins, narrow route patterns, action kinds, step and time bounds, and permitted risk classes. Artifact permissions can only narrow those settings. Initial navigation, model-proposed actions, replay actions, and document navigation triggered by clicks pass through policy. The `/confirm` route is absent from the route allowlist, and its step is classified irreversible; either boundary blocks it before a request.

Only deterministic synthetic fixtures are used. API keys remain process environment values. Browser cookies, credentials, prompts, hidden reasoning, and raw transcripts are not written. The evidence writer redacts secret-shaped keys, declared sensitive fields, sensitive values embedded inside longer strings, and long account-like numbers before any JSON or text write. Screenshots mask the member field. Evidence names actor, reason, step, ownership, result, and repository-relative diagnostic paths without persisting the image data URL.

This is a demonstration boundary, not production security. A real deployment still needs authenticated operators, credential brokering, tenant authorization, encrypted retention, immutable audit storage, model and artifact approval governance, and adversarial testing.

## Cuts

The implementation stops at the required thin vertical slice. It does not create an account, contact a bank, store real financial data, expose a capability catalog API, auto-repair replay with a model, support multiple providers, implement desktop execution, maintain a tenant registry, stream a browser, or build production authentication and infrastructure. It also avoids optional assignment stretch goals.

With more time, the first additions would be independent artifact approval and signing, a real authenticated operator channel, accessibility/OCR desktop adapters behind `SurfaceSession`, a vendor-family compatibility registry with narrow tenant overrides, and stability telemetry across repeated approved replays. Those come after—not inside—the reviewed v1 capability and policy boundary.
