# Evidence index

`manifest.json` summarizes the reproducible no-key evidence set and records that the synthetic confirm endpoint received zero requests.

- `discovery-scripted/` exercises the real observe → propose → policy → act implementation with a scripted `ModelClient`. It is a test double, not genuine LLM evidence.
- `replay-success/` uses member, product, and nickname values different from discovery.
- `replay-business-outcome/` returns `MEMBER_NOT_FOUND` as a domain outcome.
- `replay-recovery/` records the bounded transient reload rule and succeeds.
- `replay-hard-failure/` records normalized permission denial plus a screenshot and surface snapshot.
- `replay-policy-block/` proves the irreversible confirmation step is blocked and the endpoint counter stays zero.
- `human-handoff-automated/` proves the coordinator and live-session seam with a scripted test operator. It does not claim that a person performed the evidence run.

Run `npm run evidence:no-key` to regenerate those folders locally. Genuine OpenAI discovery and a person-operated headed handoff require the reviewer’s runtime participation; their exact commands are in `README.md`. Until those are performed, those two acceptance checks remain explicitly unverified rather than simulated or mislabeled.

All data is synthetic. Persisted event streams redact the configured member ID, screenshots mask that field, and no key, cookie, credential, token, or raw model transcript is part of this directory.
