# rag/consumers/quiz_consumer.py
import logging
from typing import Dict, Any, Optional
from rag.core.kafka_client import KafkaClient
from rag.core.config import settings
from rag.services.vector_store import VectorStore
from rag.services.embedding_service import EmbeddingService
from rag.services.file_processor import FileProcessor
from rag.services.quiz_generator import QuizGenerator
from rag.services.text_chunker import TextChunker

logger = logging.getLogger(__name__)

# Try to import LangChain components (optional)
try:
    from rag.services.langchain_vector_store import LangChainVectorStore
    from rag.services.langchain_quiz_generator import LangChainQuizGenerator
    LANGCHAIN_AVAILABLE = True
except ImportError as e:
    logger.warning(f"LangChain not available: {e}. Falling back to pattern-based generator.")
    LANGCHAIN_AVAILABLE = False


class QuizConsumer:
    """Consumer for quiz generation requests from Kafka."""
    
    def __init__(self):
        self.kafka_client = KafkaClient()
        self.vector_store = VectorStore()
        self.embedding_service = EmbeddingService()
        self.file_processor = FileProcessor()
        self.text_chunker = TextChunker()
        
        # Choose generator based on config
        openai_key = settings.OPENAI_API_KEY.get_secret_value() if settings.OPENAI_API_KEY else ""
        has_openai_key = bool(openai_key and openai_key.strip())
        
        logger.info(f"Generator selection:")
        logger.info(f"  USE_LANGCHAIN_GENERATOR: {settings.USE_LANGCHAIN_GENERATOR}")
        logger.info(f"  LANGCHAIN_AVAILABLE: {LANGCHAIN_AVAILABLE}")
        logger.info(f"  OPENAI_API_KEY set: {has_openai_key}")
        
        self.use_langchain = (
            settings.USE_LANGCHAIN_GENERATOR 
            and LANGCHAIN_AVAILABLE 
            and has_openai_key
        )
        
        if self.use_langchain:
            try:
                logger.info("🚀 Initializing LangChain RAG quiz generator...")
                langchain_vector_store = LangChainVectorStore(self.vector_store, self.embedding_service)
                self.quiz_generator = LangChainQuizGenerator(langchain_vector_store)
                logger.info("✅ LangChain RAG generator initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize LangChain generator: {e}. Falling back to pattern-based.", exc_info=True)
                self.use_langchain = False
                self.quiz_generator = QuizGenerator(self.vector_store, self.embedding_service)
        else:
            reason = []
            if not settings.USE_LANGCHAIN_GENERATOR:
                reason.append("USE_LANGCHAIN_GENERATOR=false")
            if not LANGCHAIN_AVAILABLE:
                reason.append("LangChain not available")
            if not has_openai_key:
                reason.append("OPENAI_API_KEY not set")
            logger.info(f"Using pattern-based quiz generator (no LLM) - Reason: {', '.join(reason)}")
            self.quiz_generator = QuizGenerator(self.vector_store, self.embedding_service)
    
    def process_quiz_request(self, message: Dict[str, Any]):
        """Process a quiz generation request."""
        try:
            print("─" * 80)
            print(f"[RAG-CONSUMER] 🔔 PROCESSING MESSAGE IN RAG SERVER")
            print("─" * 80)
            logger.info(f"Received message: {message}")
            
            # Check if this is a ping message
            message_type = message.get("type", "")
            print(f"[RAG-CONSUMER]   Message type: {message_type}")
            
            if message_type == "ping":
                request_id = message.get("requestId", "unknown")
                ping_message = message.get("message", "")
                timestamp = message.get("timestamp", "")
                
                print("=" * 80)
                print("=" * 80)
                print(f"[RAG-CONSUMER] ✅✅✅✅✅ PING RECEIVED FROM PY-BACKEND! ✅✅✅✅✅")
                print("=" * 80)
                print("=" * 80)
                print(f"[RAG-CONSUMER]   RequestId: {request_id}")
                print(f"[RAG-CONSUMER]   Message: {ping_message}")
                print(f"[RAG-CONSUMER]   Timestamp: {timestamp}")
                print("=" * 80)
                print(f"[RAG-CONSUMER] ✅✅✅ COMPLETE PING FLOW SUCCESSFUL! ✅✅✅")
                print(f"[RAG-CONSUMER]   py-backend → Kafka → rag-server")
                print(f"[RAG-CONSUMER]   Connection between services is working!")
                print("=" * 80)
                print("=" * 80)
                logger.info(f"✅ Received ping from py-backend: requestId={request_id}, message={ping_message}, timestamp={timestamp}")
                return
            
            # Extract request data for quiz generation
            request_id = message.get("requestId")
            topic = message.get("topic", "").strip()
            level = message.get("level", "intermediate").strip()
            file_keys = message.get("files", [])  # List of S3 keys
            file_types = message.get("fileTypes", [])  # List of MIME types
            
            if not topic:
                logger.error("Missing topic in quiz request")
                self._send_error_response(request_id, "Missing topic")
                return
            
            if not request_id:
                logger.error("Missing requestId in quiz request")
                return
            
            logger.info(f"Processing quiz request: topic={topic}, level={level}, files={len(file_keys)}")
            
            # Process files if provided
            context_documents = []
            if file_keys and file_types:
                try:
                    # Download and process files from S3
                    raw_texts = self.file_processor.process_files_from_s3(file_keys, file_types)
                    
                    # Clean and chunk texts with overlap
                    logger.info(f"Cleaning and chunking {len(raw_texts)} raw text segments")
                    chunked_texts = self.text_chunker.chunk_texts(raw_texts)
                    context_documents = chunked_texts
                    
                    logger.info(f"Created {len(chunked_texts)} chunks from {len(raw_texts)} raw segments")
                    
                    # Store documents in vector database
                    if chunked_texts:
                        # Generate embeddings for chunked documents
                        embeddings = self.embedding_service.embed_texts(chunked_texts)
                        
                        # Ensure embeddings are lists of floats (not tensors)
                        cleaned_embeddings = []
                        for emb in embeddings:
                            if isinstance(emb, list):
                                cleaned_embeddings.append([float(x) for x in emb])
                            elif hasattr(emb, 'tolist'):
                                cleaned_embeddings.append([float(x) for x in emb.tolist()])
                            elif hasattr(emb, 'cpu'):
                                # PyTorch tensor - move to CPU and convert
                                cleaned_embeddings.append([float(x) for x in emb.cpu().numpy().tolist()])
                            else:
                                import numpy as np
                                cleaned_embeddings.append([float(x) for x in np.array(emb).tolist()])
                        
                        # Create metadata - track which file each chunk came from
                        # Map chunks back to original files (approximate)
                        metadatas = []
                        chunks_per_file = len(chunked_texts) // len(file_keys) if file_keys else 0
                        for i, chunk in enumerate(chunked_texts):
                            # Determine which file this chunk likely came from
                            file_index = min(i // max(chunks_per_file, 1), len(file_keys) - 1) if file_keys else 0
                            file_key = file_keys[file_index] if file_keys else "unknown"
                            
                            metadatas.append({
                                "topic": topic,
                                "level": level,
                                "source": file_key,
                                "chunk_index": i
                            })
                        
                        # Create unique IDs (include requestId, file info, and timestamp to avoid duplicates)
                        import time
                        import uuid
                        timestamp = int(time.time() * 1000)  # milliseconds
                        unique_suffix = str(uuid.uuid4())[:8]  # Short unique ID
                        ids = [f"{request_id}_{i}_{timestamp}_{unique_suffix}" for i in range(len(chunked_texts))]
                        
                        # Add to vector store
                        self.vector_store.add_documents(
                            documents=chunked_texts,
                            embeddings=cleaned_embeddings,
                            metadatas=metadatas,
                            ids=ids
                        )
                        
                        logger.info(f"Stored {len(chunked_texts)} document chunks in vector store (from {len(raw_texts)} raw segments)")
                except Exception as e:
                    logger.error(f"Error processing files: {e}", exc_info=True)
                    # Continue without files
            
            # Generate quiz using RAG
            try:
                if self.use_langchain:
                    logger.info(f"[LangChain RAG] Generating quiz with LLM: topic={topic}, level={level}")
                else:
                    logger.info(f"[Pattern-based] Generating quiz without LLM: topic={topic}, level={level}")
                
                quiz = self.quiz_generator.generate_quiz(topic, level, context_documents)
                
                # Send response back via Kafka
                response = {
                    "requestId": request_id,
                    "success": True,
                    "quiz": quiz
                }
                
                self.kafka_client.publish(
                    settings.KAFKA_TOPIC_QUIZ_RESPONSE,
                    response,
                    key=request_id
                )
                
                logger.info(f"Quiz generated and sent: requestId={request_id}")
                
                # Send completion notification to py-backend
                completion_message = {
                    "requestId": request_id,
                    "type": "quiz_completed",
                    "status": "success",
                    "message": "Quiz generation completed successfully"
                }
                
                self.kafka_client.publish(
                    settings.KAFKA_TOPIC_QUIZ_COMPLETION,
                    completion_message,
                    key=request_id
                )
                
                logger.info(f"Completion notification sent: requestId={request_id}")
            except Exception as e:
                logger.error(f"Error generating quiz: {e}", exc_info=True)
                self._send_error_response(request_id, f"Error generating quiz: {str(e)}")
                
                # Send completion notification with error status
                completion_message = {
                    "requestId": request_id,
                    "type": "quiz_completed",
                    "status": "error",
                    "message": f"Quiz generation failed: {str(e)}"
                }
                
                try:
                    self.kafka_client.publish(
                        settings.KAFKA_TOPIC_QUIZ_COMPLETION,
                        completion_message,
                        key=request_id
                    )
                    logger.info(f"Error completion notification sent: requestId={request_id}")
                except Exception as completion_err:
                    logger.error(f"Error sending completion notification: {completion_err}", exc_info=True)
        
        except Exception as e:
            logger.error(f"Error processing quiz request: {e}", exc_info=True)
            request_id = message.get("requestId")
            if request_id:
                self._send_error_response(request_id, f"Server error: {str(e)}")
    
    def _send_error_response(self, request_id: str, error_message: str):
        """Send an error response back via Kafka."""
        try:
            response = {
                "requestId": request_id,
                "success": False,
                "error": error_message
            }
            
            self.kafka_client.publish(
                settings.KAFKA_TOPIC_QUIZ_RESPONSE,
                response,
                key=request_id
            )
            
            logger.info(f"Error response sent: requestId={request_id}")
        except Exception as e:
            logger.error(f"Error sending error response: {e}", exc_info=True)
    
    def start(self):
        """Start consuming quiz generation requests."""
        print(f"[RAG-CONSUMER] 🚀 Starting quiz consumer...")
        print(f"[RAG-CONSUMER]   Topics: {settings.KAFKA_TOPIC_QUIZ_REQUEST}")
        print(f"[RAG-CONSUMER]   Group ID: {settings.KAFKA_GROUP_ID}")
        logger.info("Starting quiz consumer...")
        
        topics = [settings.KAFKA_TOPIC_QUIZ_REQUEST]
        
        self.kafka_client.start_consumer(
            topics=topics,
            message_handler=self.process_quiz_request,
            group_id=settings.KAFKA_GROUP_ID
        )

