# Thinklys

A distributed backend system featuring AI-powered Q&A and RAG-based quiz generation. Built with FastAPI microservices architecture, designed for horizontal scaling across multiple server instances.

## 🏗️ Architecture

**Multi-Server Microservices Architecture:**

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Backend API   │      │   Backend API   │      │   RAG Server    │
│   (Instance 1)  │      │   (Instance N)  │      │   (Scalable)    │
│   FastAPI       │      │   FastAPI       │      │   Python        │
└────────┬────────┘      └────────┬────────┘      └────────┬────────┘
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         ▼                        ▼                        ▼
    ┌──────────┐          ┌──────────┐          ┌──────────┐
    │PostgreSQL│          │  Redis   │          │  Kafka   │
    │  (Shared)│          │ (Shared) │          │(Distributed)│
    └──────────┘          └──────────┘          └──────────┘
                                  │
                                  ▼
                          ┌──────────┐
                          │ ChromaDB  │
                          │ (Vector)  │
                          └──────────┘
```

### Services

1. **Backend API** (`py-backend/`) - FastAPI REST API with WebSocket support
   - Stateless design for horizontal scaling
   - JWT authentication, async database operations
   - Kafka producer/consumer for event-driven communication
   - Redis caching for AI responses

2. **RAG Server** (`rag-server/`) - AI microservice for quiz generation
   - Kafka consumer for async processing
   - Vector embeddings with Sentence Transformers
   - ChromaDB for similarity search
   - Document processing (PDF, DOCX, TXT)

## 🚀 Tech Stack

### Backend API (py-backend)

**Core:**
- **FastAPI** - Async web framework
- **Python 3.13** - Latest Python features
- **SQLAlchemy 2.0** - Async ORM with PostgreSQL
- **Alembic** - Database migrations

**Distributed Systems:**
- **Apache Kafka** - Event-driven messaging between services
- **Redis 7** - Centralized caching and session store
- **Socket.IO** - Real-time WebSocket with Redis adapter for multi-instance support

**AI/ML Integration:**
- **OpenAI API** - LLM integration for Q&A
- **Redis Caching** - AI response caching to reduce API costs

**Infrastructure:**
- **PostgreSQL 16** - Primary database with connection pooling
- **AWS S3** (boto3) - File storage
- **JWT** - Stateless authentication

### RAG Server (rag-server)

**AI/ML:**
- **Sentence Transformers** - Text embedding generation
- **ChromaDB** - Vector database for semantic search
- **Kafka-Python** - Consumer for async quiz generation requests

**Document Processing:**
- **PyPDF2** - PDF parsing
- **python-docx** - Word document processing

## 🧠 AI/ML Features

### 1. RAG-Based Quiz Generation
- **Retrieval Augmented Generation** pipeline
- Vector embeddings for semantic similarity search
- Document ingestion and chunking
- Topic-based quiz generation with difficulty levels
- Asynchronous processing via Kafka

### 2. AI-Powered Q&A
- OpenAI GPT integration
- Redis caching layer for cost optimization
- Question deduplication and answer reuse

### 3. Vector Search
- ChromaDB for embedding storage
- Semantic similarity search across document corpus
- Context-aware quiz question generation

## Agent layer (agentic retrieval via MCP)

### What this is

This is **not** a new LLM. It is an agent layer built around Claude (via `@anthropic-ai/sdk`) that uses Claude's **tool use** API to actively query the user's uploaded documents through a custom **MCP server** (`@modelcontextprotocol/sdk`). MCP — the Model Context Protocol — is the open spec for "how a model talks to local tools over JSON-RPC"; we run our server over stdio. The four tools (`search_documents`, `list_documents`, `get_document_section`, `summarize_document`) wrap the existing rag-server vector store under user-scoped HTTP endpoints. The point is to flip Thinklys from passive RAG (one retrieve, then stuff context, then answer) into **agentic retrieval**: the model decides what to look up, in what order, and when it has enough to answer.

### Architecture

```
                  +-------------------------------+
  user question ->|  TS agent (Claude tool-use)   |
                  |  agent/src/agent/loop.ts      |
                  +---------------+---------------+
                                  | stdio (JSON-RPC, MCP)
                                  v
                  +-------------------------------+
                  |  Custom MCP server            |
                  |  agent/src/mcp/server.ts      |
                  |  Tools:                       |
                  |   * search_documents          |
                  |   * list_documents            |
                  |   * get_document_section      |
                  |   * summarize_document        |
                  +---------------+---------------+
                                  | HTTPS + JWT (Bearer)
                                  v
                  +-------------------------------+
                  |  py-backend  /api/agent/*     |
                  |  app/api/routes/agent_routes  |
                  |  JWT auth, user-scoped        |
                  +---------------+---------------+
                                  | HTTP + X-Internal-Secret (localhost)
                                  v
                  +-------------------------------+
                  |  rag-server  /internal/agent/*|
                  |  rag/api.py                   |
                  |  -> ChromaDB query w/         |
                  |     where={user_id: ...}      |
                  |  -> Sentence-Transformers     |
                  +-------------------------------+
```

### Demo

The canonical demo question is designed to force at least two tool calls — first discovery, then grounded summarization — so the trace shows the agentic loop rather than a one-shot lookup.

```text
# example output -- fill in after running `npm run demo`

Question: What do my notes say about transformers, and summarize the document it came from?

-> [step 1] search_documents({ query: "transformers", top_k: 5 })
       -> 5 chunks (top score 0.83) from demo/notes-on-transformers.pdf
-> [step 2] summarize_document({ document_id: "demo/notes-on-transformers.pdf", max_chunks: 50 })
       -> 12 chunks, ~9.2 KB concatenated_text
-----
"Your notes describe transformers as ... [grounded answer with citations] ..."

steps=2  tools=[search_documents, summarize_document]  termination=end_turn  tokens_in=...  tokens_out=...
```

Every live run also writes a structured JSON trace to `agent/runs/<UTC-ISO>.json` (gitignored) with the question, mode, model, final text, termination reason, step count, every tool call (input, output, error, latency), and token usage.

### Design decisions

- **Four intent-shaped tools, not a generic `run_chroma_query`.** Narrow tool surfaces are easier for Claude to use correctly, eliminate vector-query / SQL-shaped injection surface, and let us validate every argument with a zod schema (`agent/src/tools/*.ts`).
- **User scoping is enforced server-side, not in the model contract.** The TS layer holds exactly one JWT (`THINKLYS_JWT`); no tool takes a `user_id` argument. py-backend pulls `user_id` from `get_current_user` and forwards it; the model cannot escape its own scope.
- **rag-server stays the only owner of embeddings and ChromaDB.** py-backend never imports the vector store — it talks to rag-server over a localhost HTTP channel gated by `X-Internal-Secret`. This keeps the embedding model loaded in exactly one place.
- **MCP over stdio.** Stdio is the standard local transport that the MCP Inspector and most MCP clients (Claude Desktop, IDE plugins) speak natively, so the same server we wire into our agent is also testable by hand.
- **Tool errors come back as `{ isError: true, content: [...] }`.** Our MCP handler in `agent/src/mcp/registerTools.ts` never throws across the JSON-RPC boundary; the agent loop converts that to a `tool_result` with `is_error: true` so Claude can self-correct (retry with different args, fall back to another tool) instead of crashing the run.
- **The loop appends the assistant's full content array before the tool-result user message.** This is a hard requirement of Claude's API: every `tool_use_id` must be matched by a `tool_result` in the next user turn, otherwise the API rejects the continuation (`agent/src/agent/loop.ts` line ~178).
- **`console.error` only inside the MCP server process.** Stdout is the JSON-RPC channel; one stray `console.log` corrupts framing and breaks every connected client. This is called out explicitly in `agent/src/mcp/server.ts` and `agent/src/mcp/README.md`.

### What I would do next

- **Stream the loop** with `client.messages.stream` so tokens render as they are produced and the UX matches plain chat latency.
- **Hybrid retrieval** inside `search_documents` (BM25 fused with dense embeddings) — Chroma-only similarity loses on rare-keyword queries.
- **Self-correcting agent**: when a `search_documents` call comes back empty or low-score, have Claude rewrite the query and retry before answering "I don't know".
- **Cheap-judge verifier**: before returning the final answer, run a Haiku-class model over `(answer, retrieved_chunks)` to flag unsupported claims.
- **Wire the agent into the React UI** behind a feature flag and an A/B switch against the existing top-k RAG path.
- **Indirect prompt injection hardening**: wrap document text in tool output with delimiters and instruct the model to treat tool output as untrusted data, not instructions — relevant because we feed user-uploaded PDFs straight into the context window.

A long-form version of these decisions lives in [`agent/docs/design-decisions.md`](agent/docs/design-decisions.md). The user-scoping threat model is in [`agent/docs/security-model.md`](agent/docs/security-model.md). The eval plan (Phase 6) is stubbed in [`agent/docs/eval-placeholder.md`](agent/docs/eval-placeholder.md).

## 🔄 Multi-Server Architecture & Synchronization

### Horizontal Scaling Design

**Stateless Backend Instances:**
- JWT-based authentication (no server-side sessions)
- Stateless REST endpoints - any instance handles any request
- Shared PostgreSQL with connection pooling
- Health check endpoints (`/health`) for load balancer

**Shared State Synchronization:**
- **Redis** - Centralized cache accessible by all backend instances
  - AI response caching synchronized across servers
  - Cross-instance WebSocket message broadcasting via Redis pub/sub
- **PostgreSQL** - Single source of truth with transaction consistency
- **Kafka** - Distributed message queue
  - Consumer groups for load balancing across backend instances
  - RAG server scales independently with multiple consumer instances

**Event-Driven Communication:**
- Backend instances publish quiz requests to Kafka
- RAG server consumers process requests asynchronously
- Responses published back to Kafka
- Backend consumers deliver results via WebSocket

**Scalability:**
- **Horizontal scaling** - Add backend instances behind load balancer
- **Independent scaling** - Scale backend and RAG server separately
- **Kafka consumer groups** - Automatic load distribution
- **Connection pooling** - Efficient resource management

## 📋 Backend Services

**Core Services:**
- `auth_service.py` - JWT authentication
- `openai_service.py` - OpenAI API integration
- `ai_cache_service.py` - Redis caching for AI responses
- `kafka_service.py` - Kafka producer/consumer management
- `chat_service.py` - Chat business logic
- `s3_service.py` - AWS S3 operations
- `socket_service.py` - WebSocket with Redis adapter

**RAG Services:**
- `quiz_generator.py` - RAG-based quiz generation
- `embedding_service.py` - Text embedding generation
- `vector_store.py` - ChromaDB operations
- `file_processor.py` - Document parsing

## 🔄 Data Flow

### Quiz Generation (Multi-Server)
```
Client → Backend Instance 1 → Kafka (request topic)
                                    ↓
                          RAG Server Consumer
                                    ↓
                          ChromaDB Vector Search
                                    ↓
                          Quiz Generation
                                    ↓
Client ← Backend Instance N ← Kafka (response topic)
```

### AI Q&A (Cached)
```
Client → Backend Instance → Redis (cache check)
                              ↓ (miss)
                              OpenAI API
                              ↓
                              Redis (store)
                              ↓
Client ← Backend Instance
```

## 🛠️ Setup

### Backend API
```bash
cd py-backend
poetry install
docker-compose up -d  # PostgreSQL, Redis, Kafka
poetry run alembic upgrade head
poetry run python -m app.main
```

### RAG Server
```bash
cd rag-server
poetry install
# Configure Kafka broker addresses
poetry run python -m rag.main
```

### Multi-Instance Deployment
- Deploy multiple backend instances behind load balancer
- Configure shared Redis and PostgreSQL
- Set Kafka broker addresses for all instances
- Enable Redis adapter for Socket.IO cross-instance messaging

## 📁 Project Structure

```
py-backend/
├── app/
│   ├── api/routes/      # REST endpoints
│   ├── services/        # Business logic (AI, Kafka, Redis)
│   ├── models/          # SQLAlchemy models
│   ├── core/            # DB, Redis, config
│   └── middleware/      # Auth middleware
└── alembic/             # Migrations

rag-server/
├── rag/
│   ├── consumers/       # Kafka consumers
│   ├── services/        # Quiz generation, embeddings
│   └── core/            # Kafka client, config
└── chroma_db/           # Vector database
```

## 🔐 Key Technologies

**Backend:**
- FastAPI, SQLAlchemy 2.0, PostgreSQL, Redis
- Apache Kafka, Socket.IO, JWT
- OpenAI API, AWS S3

**AI/ML:**
- Sentence Transformers, ChromaDB
- RAG pipeline, Vector embeddings
- Document processing

**Infrastructure:**
- Docker, Docker Compose
- Multi-server deployment ready
- Horizontal scaling architecture

## 👤 Author

**Yotam Mizrahi**
- GitHub: [@yotam4249](https://github.com/yotam4249)

---

*Distributed backend system with AI/ML capabilities, designed for horizontal scaling and multi-server deployment.*
