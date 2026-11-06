# V16 Quality Fixes Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all four demonstrated review findings and package a new-repository source tree.
**Architecture:** Retain the CLI/editor. Add per-asset acquisition identity and explicit research roles; centralize rules used by configuration and validation.
**Tech Stack:** TypeScript, Node.js 22.12+, Python 3.10+, Vitest, Playwright.
**Spec:** docs/superpowers/specs/2026-11-06-quality-fixes-design.md

## Global Constraints

Draft-only, ports 9225/9230, no remote writes, no account files in the archive. Body 1000–1600; sections 4–6; images 10–12, at least 2 per section; seven candidates; ten tags; current-source window 72 hours.

## Review Focus

- Partial recollection must not relabel an old capture as a new plan.
- Background facts and undated/future sources must not satisfy the current-fact requirement.
- Midnight in Seoul and date-only sources must not be interpreted as UTC midnight.
- Changing policy must not weaken title-overlap or immutable-job protections.
- No-config initialization and built CLI counts must agree with actual slots.

### Task 1: Asset provenance
Files: src/images/{assets,acquire}.ts, src/domain/types.ts, tests/images.test.ts, tests/helpers.ts.
- [x] Add failing regressions for capture-plan changes after another slot refresh.
- [x] Persist and verify per-asset acquisition fingerprints; allow unchanged slots to reuse their bytes.
- [x] Run images tests and the full suite; commit.

### Task 2: Research freshness
Files: src/domain/{types,validation}.ts, src/editorial/post.ts, config/editorial-rules.json, tests/research.test.ts, tests/helpers.ts.
- [x] Add failing tests for old-only, stale, future, date-only Seoul, background, and unused-current-fact inputs.
- [x] Add temporalRole current/background and reference-aware 72-hour checks.
- [x] Run focused and full tests; commit.

### Task 3: Editorial rules and defaults
Files: src/{config,cli/main}.ts, src/editorial/post.ts, config/*.json, tests/{editorial,core,cli}.test.ts, tests/helpers.ts.
- [x] Add failing title/tag/default/actual-slot-count tests.
- [x] Enforce shared rules; add template ID metadata and recommended-title-length warning.
- [x] Update old fixtures to the new contract without weakening unrelated assertions; run full tests/typecheck/build; commit.

### Task 4: Consistent documentation and delivery
Files: README.md, AGENTS.md, prompts/realtime-post.md, docs/{validation,review-notes,new-repository,v16-validation}.md, package*.json.
- [x] Align active instructions, examples and package identity; label historical records.
- [x] Run full tests, Python tests, typecheck, build, CLI checks and browser tests.
- [x] Obtain a fresh final code review and fix important issues with regressions.
- [x] Commit and create a clean source ZIP, inspect its entries, and save the deliverable.

### Task 5: User-requested alternating layout (execute before Task 4 delivery)
Files: src/editorial/{bundle,post}.ts, tests/{helpers,editorial,policy}.ts, active instructions.
- [x] Add failing preview/event-order and paragraph/image-count regressions.
- [x] Alternate image and corresponding ordinary body sentence; reject missing/extra paragraph entries.
- [x] Run full suite/typecheck/build and include the new layout in documentation and final review.
