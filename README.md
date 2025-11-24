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
