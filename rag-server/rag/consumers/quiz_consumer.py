# rag/consumers/quiz_consumer.py
import logging
from typing import Dict, Any
from rag.core.kafka_client import KafkaClient
from rag.core.config import settings
from rag.services.vector_store import VectorStore
from rag.services.embedding_service import EmbeddingService
from rag.services.file_processor import FileProcessor
from rag.services.quiz_generator import QuizGenerator

logger = logging.getLogger(__name__)


class QuizConsumer:
    """Consumer for quiz generation requests from Kafka."""
    
    def __init__(self):
        self.kafka_client = KafkaClient()
        self.vector_store = VectorStore()
        self.embedding_service = EmbeddingService()
        self.file_processor = FileProcessor()
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
                    texts = self.file_processor.process_files_from_s3(file_keys, file_types)
                    context_documents = texts
                    
                    # Store documents in vector database
                    if texts:
                        # Generate embeddings for documents
                        embeddings = self.embedding_service.embed_texts(texts)
                        
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
                        
                        # Create metadata
                        metadatas = [
                            {
                                "topic": topic,
                                "level": level,
                                "source": file_key
                            }
                            for file_key in file_keys
                            for _ in range(len(texts) // len(file_keys) + 1)
                        ][:len(texts)]
                        
                        # Create IDs
                        ids = [f"{topic}_{i}" for i in range(len(texts))]
                        
                        # Add to vector store
                        self.vector_store.add_documents(
                            documents=texts,
                            embeddings=cleaned_embeddings,
                            metadatas=metadatas[:len(texts)],
                            ids=ids
                        )
                        
                        logger.info(f"Stored {len(texts)} document chunks in vector store")
                except Exception as e:
                    logger.error(f"Error processing files: {e}", exc_info=True)
                    # Continue without files
            
            # Generate quiz using RAG
            try:
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

