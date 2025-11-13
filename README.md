# Thinkly — Learn Smarter. Together.

> **Thinkly** is a collaborative AI-driven learning platform that brings students, teams, and curious minds together inside real-time chat groups powered by intelligent AI assistance.

---

## 🌍 Overview

**Thinkly** redefines the group learning experience.  
It combines **real-time collaboration** with **AI-powered insights** — allowing users to discuss topics, ask questions, and receive contextual explanations or quizzes directly inside chat rooms.

Each group has an **AI Agent Panel** that:
- Understands the topic.  
- Generates relevant quizzes, summaries, hints, and feedback.  

---

## ⚙️ Tech Stack

| Layer | Technologies |
|-------|---------------|
| **Frontend** | React + Redux Toolkit + TypeScript |
| **Backend** | Node.js + Express + TypeScript |
| **Database** | MongoDB (Mongoose ODM) |
| **Real-time** | Socket.IO (bi-directional chat updates) |
| **AI Integration** | OpenAI GPT-based Agent |
| **Caching** | Redis (hot chat data) |
| **Message Queue** | KafkaJS (asynchronous message pipeline) |
| **Storage** | AWS S3 (profile images, shared files) |
| **Auth** | JWT (Access & Refresh Tokens) |

---

## 💡 Core Features

- 🧑‍🤝‍🧑 **Collaborative Learning Chats** — Study together in topic-based group chats.  
- 🤖 **AI Agent Panel** — The built-in assistant provides explanations, hints, and creates quizzes dynamically.  
- ⚡ **Real-Time Interaction** — Built on WebSocket (Socket.IO)  .
- 🧠 **Kafka Message Queue** — Ensures scalable and reliable message processing.
- 🧳 **Redis Caching** — Fast retrieval of popular groups and prompts to the AI Agent.
- ☁️ **AWS S3 Integration** — Secure storage for avatars and shared media.  
- 🔐 **Secure Authentication** — With JWT + Refresh Tokens + HTTPS.  

---

## 🧩 System Architecture

                        ┌───────────────────────┐
                        │       Frontend        │
                        │ React + Redux Toolkit │
                        └──────────┬────────────┘
                                   │
                    WebSocket / REST API (HTTPS)
                                   │
         ┌─────────────────────────┴─────────────────────────┐
         │                     Backend                      │
         │ Node.js + Express + TypeScript + Socket.IO        │
         ├─────────────────────────┬─────────────────────────┤
         │                         │                         │
    MongoDB (Data)          Redis (Cache)            Kafka (Queue)
         │                         │                         │
         └────────────── AWS S3 (Media Storage) ─────────────┘
