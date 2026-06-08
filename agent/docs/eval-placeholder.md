# Agent layer — evaluation plan (placeholder)

This is the Phase 5 stub for the eval harness that Phase 6 will deliver. The point of this file is to commit to *how* the agent will be measured before the numbers come in, so the comparison stays honest.

## Why eval matters

The claim we make in the top-level README is that agentic retrieval beats plain top-k RAG on Thinklys's question shape. Without a benchmark that claim is decoration. The interesting cases — multi-document questions, "summarize the document this answer came from", "list everything I have on X" — are exactly the cases where top-k retrieval truncates context and the agent's discovery loop should win. We want to be able to point at a number, not a vibe.

We also want a tripwire: if the agent loses on simple single-hop questions, we want to know that, because adding a tool-use roundtrip to every query has real latency and cost. The eval is the only thing that catches that regression.

## Setup

- **Question set.** A few dozen hand-written question/expected-answer pairs against a fixed user's uploaded documents, mixing:
  - **Single-hop factual** ("what is X according to my notes?") — baseline should win or tie on latency.
  - **Multi-document** ("what do I have on transformers across all my notes?") — agent should win on recall via repeated `search_documents`.
  - **Document-grounded summarization** ("summarize the doc that mentions transformers") — agent should win because it has `summarize_document`; baseline can only stuff retrieved chunks.
  - **Refusal / not-in-corpus** ("what do my notes say about quantum chromodynamics?") — both should refuse; we measure hallucination rate.
- **Two arms.**
  - `Top-k RAG (baseline)`: one call to `/api/agent/search` (or equivalent), top-k chunks stuffed into a single LLM call.
  - `Agent (this work)`: `npm run demo` path — Claude with the four MCP tools.
- **Judges.**
  - **LLM-as-judge correctness.** A Haiku-class model scores `(question, expected_answer, system_answer)` on a 0/1 or 0–3 scale. Cheap, repeatable, biased — we report the bias separately and spot-check by hand.
  - **Retrieval recall + MRR.** For each question, an annotated set of "must include this chunk" ids. Recall = "did we retrieve any of them"; MRR = "where did the best one land".
  - **Cost.** Sum of input + output tokens times the model's per-token rate, plus tool-call HTTP latency.
  - **Latency.** Wall-clock time per question, p50 / p95.

## Results — placeholder

| System                  | Correctness (LLM-judge) | Retrieval recall@5 | Retrieval MRR | Tokens / Q (in + out) | Latency p50 | Latency p95 |
| ----------------------- | ----------------------- | ------------------ | ------------- | --------------------- | ----------- | ----------- |
| Top-k RAG (baseline)    |                         |                    |               |                       |             |             |
| Agent (this work)       |                         |                    |               |                       |             |             |

Cells are deliberately empty. Phase 6 fills them in.

## What this file becomes

When Phase 6 lands the eval harness, this file is partly subsumed: the results table moves into a script-generated report, and this stub becomes a pointer. Until then it lives here so anyone reading the Phase 5 docs can see *what we are going to measure* and challenge the methodology before the numbers exist.
