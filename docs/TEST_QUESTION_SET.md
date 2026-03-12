# Vite RAG Test Question Set (Fixed)

Purpose: Repeatable quality checks for retrieval + chat behavior against indexed Vite documentation.

Version: `v1`
Total questions: `25`

## Usage notes
- Run the same question wording each time (do not rephrase during benchmarking).
- Compare outputs for:
  - citation presence
  - grounding quality
  - fallback correctness

## Questions

| ID | Expected | Question |
|---|---|---|
| Q01 | grounded | What is Vite, and what problem does it solve in frontend development? |
| Q02 | grounded | How do I create a new Vite project using npm? |
| Q03 | grounded | What are the differences between `vite dev`, `vite build`, and `vite preview`? |
| Q04 | grounded | How does Vite's dependency pre-bundling work, and why is it needed? |
| Q05 | grounded | Where do I configure server port and host settings in Vite? |
| Q06 | grounded | How do I set up path aliases in Vite configuration? |
| Q07 | grounded | What is `defineConfig`, and why is it recommended in `vite.config` files? |
| Q08 | grounded | How do environment variables work in Vite, and what is the `VITE_` prefix for? |
| Q09 | grounded | What are Vite modes, and how do they affect `.env` file loading? |
| Q10 | grounded | How can I set a custom base path for deploying a Vite app under a subdirectory? |
| Q11 | grounded | How do static assets in the `public` directory differ from imported assets in source code? |
| Q12 | grounded | What is `import.meta.env`, and what built-in fields are typically available? |
| Q13 | grounded | How do I configure a proxy for API calls during local development in Vite? |
| Q14 | grounded | What does Vite’s plugin system do, and where are plugins registered? |
| Q15 | grounded | What is the purpose of `optimizeDeps` in Vite config? |
| Q16 | grounded | How can I customize build output settings such as output directory or sourcemaps in Vite? |
| Q17 | grounded | What is library mode in Vite, and when should I use it? |
| Q18 | grounded | How does CSS handling work in Vite for regular CSS and CSS modules? |
| Q19 | grounded | How do I use TypeScript with Vite, and what does Vite handle vs TypeScript compiler checks? |
| Q20 | grounded | What options does Vite provide for framework integrations like React or Vue? |
| Q21 | fallback | What is the best Kubernetes autoscaling strategy for high-traffic Vite apps? |
| Q22 | fallback | Compare AWS Lambda and Cloud Run pricing for hosting a Vite backend API. |
| Q23 | fallback | Write a full Unreal Engine C++ setup guide for dedicated servers. |
| Q24 | fallback | What are the latest Apple Vision Pro hardware specs released this year? |
| Q25 | fallback | Explain quantum error correction thresholds with current research citations. |

## Pass criteria (suggested)
- Grounded questions (`Q01-Q20`):
  - answer is relevant to question
  - includes at least 1 valid citation URL when context exists
  - no major hallucinated claims
- Fallback questions (`Q21-Q25`):
  - assistant clearly states it does not know based on indexed documentation
  - does not fabricate citations
