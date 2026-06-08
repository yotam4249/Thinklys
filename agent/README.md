# Thinklys agent layer

Agentic TypeScript layer for Thinklys. Will expose user-scoped tools over uploaded documents via a custom MCP server (`@modelcontextprotocol/sdk`) and drive a Claude-based agent (`@anthropic-ai/sdk`) that answers user questions by calling those tools. An eval harness will benchmark the agent against plain top-k RAG. Details land in later phases.

## Phase status

- [x] Phase 0 — Scaffold
- [ ] Phase 1
- [ ] Phase 2
- [ ] Phase 3
- [ ] Phase 4
- [ ] Phase 5
- [ ] Phase 6

## Quickstart for now

```bash
cp .env.example .env
npm install
```
