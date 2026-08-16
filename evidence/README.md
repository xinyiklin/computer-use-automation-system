# Evidence index

`manifest.json` summarizes the reproducible no-key evidence set and records that the synthetic confirm endpoint received zero requests.

- `discovery-scripted/` exercises the real observe → propose → policy → act implementation with a scripted `ModelClient`. It is a test double, not genuine provider evidence.
- `replay-success/` uses member, product, and nickname values different from discovery.
- `replay-business-outcome/` returns `MEMBER_NOT_FOUND` as a domain outcome.
- `replay-recovery/` records the bounded transient reload rule and succeeds.
- `replay-hard-failure/` records normalized permission denial plus a screenshot and surface snapshot.
- `replay-policy-block/` proves the irreversible confirmation step is blocked and the endpoint counter stays zero.
- `human-handoff-automated/` proves the coordinator and live-session seam with a scripted test operator. It does not claim that a person performed the evidence run.

Run `npm run evidence:no-key` to regenerate those folders locally. Genuine
discovery is recorded separately in
`discovery-2026-08-16T23-12-04-329Z-7439cb4f/` using the explicitly selected
`codex-cli:gpt-5.6-luna` transport at xhigh. Its exact persisted-file-byte
SHA-256 `6b579c4bb9e05826855f83ca91a18942af95c8f3cc466950e5d8e7322fd75a39`
is recorded at discovery completion and linked to the model-free
different-input replay `replay-2026-08-16T23-17-24-561Z-7432e8b8/`. A
person-operated headed handoff is recorded in
`replay-2026-08-16T23-17-36-117Z-37f35130/`; it records trusted
`person-operated-cli` execution on a headed surface, the person-reported
action description `Clicked "Supervisor verified"`, the same exact file-byte
digest, and one preserved live surface session across human control and
independently verified automation resume. It does not claim independent click
telemetry.

All data is synthetic. Persisted event streams redact the configured member ID, screenshots mask that field, and no key, cookie, credential, token, or raw model transcript is part of this directory.
