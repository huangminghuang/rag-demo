# Metadata Enrichment Issue Tracker

## Parent PRD

- PRD issue: [#3](https://github.com/huangminghuang/rag-demo/issues/3)
- PRD document: [PRD.md](PRD.md)

## Issue Breakdown

1. [#4](https://github.com/huangminghuang/rag-demo/issues/4) `Add enrichment config and policy-gated chunk eligibility`
   - Type: AFK
   - Blocked by: None
   - Covers user stories: 6, 7, 8, 9, 14, 15, 23, 24

2. [#5](https://github.com/huangminghuang/rag-demo/issues/5) `Add validated enrichment contract for prose chunks`
   - Type: AFK
   - Blocked by: #4
   - Covers user stories: 1, 2, 5, 10, 11, 12, 13, 24

3. [#6](https://github.com/huangminghuang/rag-demo/issues/6) `Embed enriched prose chunks with stable embedding input`
   - Type: AFK
   - Blocked by: #5
   - Covers user stories: 1, 2, 5, 16, 17, 18, 19, 20, 25

4. [#7](https://github.com/huangminghuang/rag-demo/issues/7) `Extend enrichment to table chunks`
   - Type: AFK
   - Blocked by: #6
   - Covers user stories: 3, 8, 10, 11, 13, 16, 24

5. [#8](https://github.com/huangminghuang/rag-demo/issues/8) `Extend enrichment to code chunks`
   - Type: AFK
   - Blocked by: #6
   - Covers user stories: 4, 10, 11, 13, 16, 24

6. [#9](https://github.com/huangminghuang/rag-demo/issues/9) `Add bounded-parallel enrichment execution profile`
   - Type: AFK
   - Blocked by: #5
   - Covers user stories: 14, 15, 20, 24

7. [#10](https://github.com/huangminghuang/rag-demo/issues/10) `Add operator-facing backfill and debug workflow for enrichment rollout`
   - Type: AFK
   - Blocked by: #7, #8, #9
   - Covers user stories: 18, 19, 20, 21, 22

## Suggested Delivery Order

- #4
- #5
- #6
- #7
- #8
- #9
- #10

## Notes

- This tracker reflects the approved vertical-slice breakdown from the parent PRD.
- The public retrieval API remains unchanged during the initial rollout.
- `list` and `blockquote` chunk enrichment remain follow-on scope after these issues.
