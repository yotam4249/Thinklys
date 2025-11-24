# Thinklys

A full-stack educational platform featuring real-time chat, AI-powered Q&A, and RAG-based quiz generation. Built with a microservices architecture using FastAPI, React, and modern distributed systems technologies.

## 🏗️ Architecture Overview

Thinklys follows a **microservices architecture** with three main services:

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Frontend      │      │   Backend API   │      │   RAG Server    │
│  (React/TS)     │◄────►│   (FastAPI)     │◄────►│   (Python)      │
└─────────────────┘      └─────────────────┘      └─────────────────┘
                                │                          │
                                ▼                          ▼
                         ┌──────────────┐          ┌──────────────┐
                         │  PostgreSQL  │          │  ChromaDB    │
                         │   Redis      │          │  (Vector)   │
                         │   Kafka      │          └──────────────┘
                         │   Socket.IO  │
                         └──────────────┘
```

### Service Breakdown

1. **Frontend Client** (`frontend/client/`) - React + TypeScript SPA
2. **Backend API** (`py-backend/`) - FastAPI REST API with WebSocket support
3. **RAG Server** (`rag-server/`) - Microservice for AI quiz generation

## 🚀 Tech Stack

### Backend (Primary Focus)

**Core Framework:**
- **FastAPI** - Modern, high-performance async web framework
- **Python 3.13** - Latest Python features and performance improvements
- **Uvicorn** - ASGI server with standard workers

**Database & ORM:**
- **PostgreSQL 16** - Primary relational database
- **SQLAlchemy 2.0** - Modern async ORM with type hints
- **Alembic** - Database migrations and versioning
- **AsyncPG** - High-performance async PostgreSQL driver

**Caching & Session Management:**
- **Redis 7** - Caching layer for AI responses and session data
- **aioredis** - Async Redis client

**Message Queue & Event Streaming:**
- **Apache Kafka** - Event-driven architecture for async processing
- **Kafka-Python** - Producer/Consumer implementation
- **Zookeeper** - Kafka coordination service

**Real-time Communication:**
- **Socket.IO** (Python) - WebSocket server for real-time chat
- **python-socketio** - Async Socket.IO implementation

**Authentication & Security:**
- **JWT** (PyJWT) - Access and refresh token authentication
- **bcrypt** - Password hashing
- **Passlib** - Password hashing utilities

**Cloud Services:**
- **AWS S3** (boto3) - File storage and retrieval
- **OpenAI API** - LLM integration for Q&A

**Other Backend Technologies:**
- **Pydantic** - Data validation and settings management
- **Pydantic Settings** - Environment-based configuration
- **Python Multipart** - File upload handling

### RAG Server

**Vector Database:**
- **ChromaDB** - Embedding storage and similarity search

**ML/AI:**
- **Sentence Transformers** - Text embedding generation
- **PyPDF2** - PDF document processing
- **python-docx** - Word document processing

**Event Processing:**
- **Kafka-Python** - Consumer for quiz generation requests

### Frontend

**Core:**
- **React 19** - UI library
- **TypeScript** - Type-safe JavaScript
- **Vite** - Build tool and dev server

**State Management:**
- **Redux Toolkit** - Application state management
- **React Redux** - React bindings

**UI Framework:**
- **Material-UI (MUI) 7** - Component library
- **Emotion** - CSS-in-JS styling

**Networking:**
- **Axios** - HTTP client
- **Socket.IO Client** - Real-time WebSocket client
- **React Router DOM** - Client-side routing

### Infrastructure

**Containerization:**
- **Docker** - Container runtime
- **Docker Compose** - Multi-container orchestration

**Services:**
- PostgreSQL 16
- Redis 7
- Apache Kafka + Zookeeper
- Qdrant (vector database - configured but using ChromaDB)

## 📋 Key Features

### 1. Real-time Chat System
- **Group chats** and **direct messages (DM)**
- Real-time message delivery via WebSocket
- Message history with pagination
- Chat filtering and search
- User presence and typing indicators

### 2. AI-Powered Q&A
- OpenAI GPT integration for intelligent question answering
- **Redis caching** to reduce API costs and improve response times
- Question deduplication and answer reuse

### 3. RAG-Based Quiz Generation
- **Retrieval Augmented Generation** for context-aware quiz creation
- Vector similarity search using ChromaDB
- Document processing (PDF, DOCX, TXT)
- Topic-based quiz generation with difficulty levels
- **Asynchronous processing** via Kafka message queue
- Real-time quiz delivery via WebSocket

### 4. File Management
- **AWS S3** integration for file storage
- Secure, time-limited pre-signed URLs
- Support for multiple file types
- File upload and retrieval APIs

### 5. Authentication & Authorization
- JWT-based authentication (access + refresh tokens)
- Secure password hashing with bcrypt
- Token refresh mechanism
- Protected routes and middleware

### 6. User Management
- User profiles with customizable avatars
- Profile preview and editing
- User search and discovery

## 🏛️ Backend Architecture Details

### API Structure

```
/api
├── /auth          - Authentication endpoints (login, register, refresh)
├── /chat          - Chat management (create, list, messages)
├── /files         - File upload/download endpoints
├── /quiz          - Quiz generation and management
└── /ai            - AI Q&A endpoints
```

### Database Models

- **User** - User accounts and profiles
- **Chat** - Chat rooms (group/DM) with many-to-many members
- **Message** - Chat messages with types (text, file, etc.)
- **QuizResult** - User quiz attempts and scores
- **RefreshToken** - Token rotation for security

### Service Layer

**Core Services:**
- `auth_service.py` - Authentication and authorization logic
- `chat_service.py` - Chat and message business logic
- `openai_service.py` - OpenAI API integration
- `ai_cache_service.py` - Redis caching for AI responses
- `s3_service.py` - AWS S3 file operations
- `socket_service.py` - WebSocket event handling
- `kafka_service.py` - Kafka producer/consumer management

### Event-Driven Architecture

**Kafka Topics:**
- `quiz.generate.request` - Quiz generation requests
- `quiz.generate.response` - Quiz generation responses
- `quiz.generate.completion` - Quiz completion notifications

**Flow:**
1. Client requests quiz via REST API
2. Backend publishes request to Kafka
3. RAG server consumes request, generates quiz
4. RAG server publishes response to Kafka
5. Backend consumes response, sends to client via WebSocket

### Caching Strategy

- **Redis** used for:
  - AI Q&A answer caching (question → answer mapping)
  - Session data
  - Temporary data storage

### Async/Await Patterns

- Full async/await throughout backend
- Async database operations with SQLAlchemy
- Async Redis operations
- Async Kafka producers/consumers
- Non-blocking I/O for all external services

## 🔧 Development Setup

### Prerequisites

- Python 3.13+
- Node.js 18+
- Docker & Docker Compose
- Poetry (Python package manager)
- npm/yarn

### Backend Setup

```bash
cd py-backend

# Install dependencies
poetry install

# Set up environment variables
cp .env.example .env.dev
# Edit .env.dev with your configuration

# Start infrastructure services
docker-compose up -d

# Run database migrations
poetry run alembic upgrade head

# Start development server
poetry run python -m app.main
# Or use: poetry run dev
```

### RAG Server Setup

```bash
cd rag-server

# Install dependencies
poetry install

# Set up environment variables
# Configure Kafka broker addresses

# Start RAG server
poetry run python -m rag.main
# Or use: poetry run dev
```

### Frontend Setup

```bash
cd frontend/client

# Install dependencies
npm install

# Start development server
npm run dev
```

### Docker Services

The `docker-compose.yml` includes:
- PostgreSQL (port 55432)
- Redis (port 6379)
- Kafka + Zookeeper (ports 9092, 9093)
- PgAdmin (port 5050)

## 📁 Project Structure

```
Thinklys/
├── py-backend/              # FastAPI backend service
│   ├── app/
│   │   ├── api/            # API routes and DTOs
│   │   ├── core/           # Configuration, DB, Redis
│   │   ├── middleware/     # Auth middleware
│   │   ├── models/         # SQLAlchemy models
│   │   ├── services/       # Business logic services
│   │   └── utils/          # Utility functions
│   ├── alembic/            # Database migrations
│   └── docker-compose.yml  # Infrastructure services
│
├── rag-server/              # RAG microservice
│   ├── rag/
│   │   ├── consumers/      # Kafka consumers
│   │   ├── services/       # Quiz generation, embeddings
│   │   └── core/           # Configuration, Kafka client
│   └── chroma_db/          # Vector database storage
│
└── frontend/
    └── client/             # React frontend
        ├── src/
        │   ├── components/ # React components
        │   ├── pages/      # Page components
        │   ├── services/   # API clients
        │   ├── store/      # Redux store
        │   └── types/      # TypeScript types
        └── public/         # Static assets
```

## 🔐 Environment Variables

### Backend (.env.dev)

```env
APP_NAME=Thinklys API
APP_ENV=development
PORT=8000
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:55432/appdb
REDIS_URL=redis://localhost:6379

# JWT
ACCESS_TOKEN_SECRET=your-secret
REFRESH_TOKEN_SECRET=your-secret
ACCESS_TOKEN_EXPIRE=15
REFRESH_TOKEN_EXPIRE=30

# AWS S3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
S3_BUCKET=your-bucket

# Kafka
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=py-backend

# OpenAI
OPENAI_API_KEY=your-key

# CORS
CORS_ALLOWED_ORIGINS=["http://localhost:5173"]
```

## 🧪 Key Backend Patterns & Practices

### 1. Async/Await Throughout
- All database operations use async SQLAlchemy
- Async Redis operations
- Non-blocking I/O for external APIs

### 2. Dependency Injection
- FastAPI's dependency injection for database sessions
- Service layer abstraction

### 3. Error Handling
- Global exception handlers with CORS support
- Structured error responses
- Database integrity error handling

### 4. Type Safety
- Pydantic models for request/response validation
- SQLAlchemy 2.0 with type hints
- Type-safe DTOs

### 5. Database Migrations
- Alembic for version-controlled schema changes
- Migration scripts for all model changes

### 6. Security Best Practices
- JWT token rotation
- Password hashing with bcrypt
- CORS configuration
- Secret management with Pydantic Settings

## 🚦 API Examples

### Authentication
```bash
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
```

### Chat
```bash
GET  /api/chat              # List user's chats
POST /api/chat              # Create new chat
GET  /api/chat/{id}/messages # Get chat messages
POST /api/chat/{id}/messages # Send message
```

### Quiz Generation
```bash
POST /api/quiz/generate     # Request quiz generation
GET  /api/quiz/{id}         # Get quiz details
POST /api/quiz/{id}/submit  # Submit quiz answers
```

### AI Q&A
```bash
POST /api/ai/qa            # Ask question (cached)
```

## 📊 Performance Optimizations

1. **Database Indexing** - Strategic indexes on foreign keys and query patterns
2. **Redis Caching** - AI responses cached to reduce API calls
3. **Async Processing** - Kafka for long-running quiz generation
4. **Connection Pooling** - Database and Redis connection pools
5. **Lazy Loading** - SQLAlchemy relationships optimized with selectin loading

## 🔄 Data Flow Examples

### Quiz Generation Flow
```
Client → FastAPI → Kafka (request) → RAG Server
                                    ↓
Client ← WebSocket ← FastAPI ← Kafka (response) ← RAG Server
```

### Chat Message Flow
```
Client → FastAPI → PostgreSQL
                ↓
Client ← WebSocket ← FastAPI (broadcast to chat members)
```

### AI Q&A Flow
```
Client → FastAPI → Redis (cache check)
                ↓ (cache miss)
                OpenAI API
                ↓
                Redis (cache store)
                ↓
Client ← FastAPI
```

## 🛠️ Technologies & Tools Summary

**Backend:**
- FastAPI, SQLAlchemy 2.0, PostgreSQL, Redis
- Kafka, Socket.IO, JWT, bcrypt
- AWS S3, OpenAI API
- Alembic, Pydantic, Poetry

**RAG/ML:**
- ChromaDB, Sentence Transformers
- Kafka consumers, Document processing

**Frontend:**
- React 19, TypeScript, Vite
- Redux Toolkit, Material-UI
- Socket.IO Client, Axios

**Infrastructure:**
- Docker, Docker Compose
- PostgreSQL, Redis, Kafka, Zookeeper


## 👤 Author

**Yotam Mizrahi**
- GitHub: [@yotam4249](https://github.com/yotam4249)

---

*Built with modern Python async/await patterns, microservices architecture, and event-driven design principles.*

