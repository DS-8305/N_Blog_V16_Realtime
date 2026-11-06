# Image review workflow implementation plan

> **For agentic workers:** Use test-driven implementation and independently review the integrated change. Tasks use checkboxes below.

**Goal:** Block private or unverified personal blog/Instagram image sources and replace bulk first-result selection with small, reviewable candidate rounds and verified local import.

**Architecture:** A shared source policy gates search downloads, direct URLs, redirects and captures. Google on9230 produces a job-local candidate pool and contact sheet; a reviewer explicitly selects a candidate and records its source and origin before local bytes become a fingerprint-bound asset. Existing immutable saved jobs and Naver9225 behavior remain unchanged.

**Tech stack:** Existing TypeScript, Python, Sharp, Vitest and unittest; no new dependency.

**Spec:** The user's November6 instruction to prohibit ordinary personal blog/Instagram extraction and first apply element search → small collection → actual-image review → deduplicate → assign → search missing scenes.

## Constraints and rulings

- Work in the installed checkout on `codex/image-review-workflow`; preserve earlier user-directed AGENTS/prompt changes, local profiles, runtime artifacts and saved draft. Do not publish, push or alter the completed post.
- Known personal/community/wiki hosts and their image CDNs are blocked. Direct official social-account exceptions require configured, recorded verification; no wildcard or ad-hoc per-command bypass. News reprints still require origin review: private or unknown origins cannot be approved.
- Default small round:5 candidates/query,35 active seconds/query, at most3 distinct pending queries/call. Keep9230 sequential and visible; manual challenge timing/detachment remain intact.
- A successful raw download is a pending candidate, never an automatically selected manuscript image. Exact pixel duplicates are shared across searches; visual hashes group resize variants for review.
- A selected local original must retain bytes/hash/dimensions/source provenance and bind to the current acquisition fingerprint. Changed/corrupt/blocked candidates cannot import. No network re-download of a valid collected original.
- Existing explicit direct plans remain supported under the same source policy. Saved receipt retrieval remains possible and completed jobs are immutable.

## Review focus

Unverified social redirects; publisher pages embedding personal-source images; stale candidate files and selection records; partial rounds and query changes; resized duplicates and narrow long collages.

## Tasks

- [x] **1. Source policy:** Add shared JSON policy, TS/Python URL checks, pre-download and redirect guards; tests for personal platforms/CDNs, deceptive host suffixes, verified exact official prefixes and normal media. Capture path must use the same guard.
- [x] **2. Candidate image analysis:** Add normalization, exact pixel hash, visual hash/distance, size/aspect flags; tests from real synthetic image bytes for resized duplicates, different scenes, orientation and decode failure.
- [x] **3. Review-first workflow:** Add candidate storage, bounded search rounds, contact sheet, list/select commands and validated cached import. Remove first-eligible automatic selection from search-backed plans; preserve successful fingerprint-bound reuse and direct plans. Tests prove review required, no hidden fetch on import, corruption/source/duplicate rejection and next-round behavior.
- [x] **4. Integration and guidance:** Update CLI help, plan schema, AGENTS/prompt/README; convert existing Unix-only fake collector test to a portable fixture. Build/typecheck/Node and Python tests; fresh integrated review and fix substantive findings.

Each task starts with a failing behavior test, then minimal implementation, then its focused green checks. Final checks: `npm test`, `npm run typecheck`, `npm run build`, project Python unittest discovery. Editor code is not changed.

## Progress

Plan written before implementation. Prior baseline:137 Node tests passed,9 browser tests skipped,1 existing Unix `.sh` fixture fails on Windows; address that fixture with its integration task rather than suppressing it.

Integrated review found and reproduced source-variant loss, capture fetch/redirect/cache-origin bypass, and RGB/RGBA cross-mode duplicates. Regression fixes are implemented; final checks pending.

Final verification (2026-11-07 Asia/Seoul): Node222 passed, browser15 passed separately, Python19 passed; typecheck/build/diff-check passed. Existing immutable saved receipt retrieval also passed without browser input. Code remains local on codex/image-review-workflow; no publication or remote write.
