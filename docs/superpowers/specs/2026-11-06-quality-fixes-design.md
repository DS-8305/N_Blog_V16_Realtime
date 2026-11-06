# V16 quality fixes

The user approved fixing the four demonstrated V15 review findings and wants the result ready for a new repository. Keep the original remote unchanged and deliver a clean source archive named N_Blog_V16_Realtime.

Use the existing TypeScript/Python architecture. Preserve CDP 9225/9230, draft-only behavior, input recovery, content review, and configured related-post links. Do not introduce generation APIs or change account profiles.

## Approach

Fix the existing validators and acquisition contract, with regression tests. Rewriting the editor would add unrelated risk; documentation-only changes would leave the demonstrated failures open.

- Bind every acquired asset to its exact slot plan and referenced source URL. Changing capture URL, source, selector, frame, or required labels must invalidate that asset even after another slot refreshes the manifest. Valid unchanged slots remain reusable.
- Require research no older than 72 hours and at least one current fact supported by a dated source in that window. Facts may explicitly be background. Missing dates, future publication dates, accessed dates, and unrelated unused current facts cannot satisfy currentness. Date-only publications are interpreted as a Seoul calendar-day interval; do not invent a publication time. Preserve old dates as background.
- Enforce seven distinct title candidates, 35–50 characters (35–45 recommended), a digit, no !/… in any candidate, and exactly ten tags. Require seven distinct valid template IDs aligned with the candidates; semantic fit remains content review. Existing selected-title Jaccard threshold stays 60%.
- Put manuscript/count/freshness defaults in config/editorial-rules.json; consume title settings from config/title-templates.json. Align active instructions, example config, job initialization and help. Historical validation/design records are explicitly historical.

## Deliverable

Clean source ZIP with setup and a new-repository guide, no .git, account configuration, profiles, jobs, dependencies, or test runtime output. Tests/typecheck/build must run; report browser execution limits honestly.

## User-directed layout addition

The user subsequently requested alternating images and ordinary body sentences under each quote heading. Render quote → image[0] → paragraphs[0] → image[1] → paragraphs[1] → image[2] → paragraphs[2]. Require exactly one paragraphs entry per image; each entry is authored as one sentence and may retain mobile line breaks. This is normal body text, not a native photo caption. The preview and editor event stream must use the same order. Keep the overall 10–12 image and 4–6 section defaults.
