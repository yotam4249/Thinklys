# rag/services/langchain_vector_store.py
"""
LangChain adapter for ChromaDB vector store.
Uses existing VectorStore instead of creating new ChromaDB instance to avoid conflicts.
"""
import logging
from typing import List, Optional
from langchain_core.documents import Document
from rag.services.vector_store import VectorStore
from rag.services.embedding_service import EmbeddingService

logger = logging.getLogger(__name__)


class LangChainVectorStore:
    """LangChain-compatible wrapper for our ChromaDB vector store."""
    
    def __init__(self, vector_store: VectorStore, embedding_service: EmbeddingService):
        self.vector_store = vector_store
        self.embedding_service = embedding_service
        logger.info("LangChain vector store adapter initialized (using existing VectorStore)")
    
    def as_retriever(self, k: int = 5, search_kwargs: Optional[dict] = None):
        """Get LangChain retriever that uses our existing VectorStore."""
        return CustomRetriever(
            vector_store=self.vector_store,
            embedding_service=self.embedding_service,
            k=k
        )
    
    def add_documents(self, documents: List[str], metadatas: Optional[List[dict]] = None):
        """Add documents to the vector store (already handled by quiz_consumer)."""
        # Documents are already added by quiz_consumer via vector_store.add_documents
        # This method exists for compatibility but doesn't need to do anything
        logger.info(f"Documents already added to vector store (via quiz_consumer)")


class CustomRetriever:
    """Custom retriever that uses our existing VectorStore and implements LangChain retriever interface."""
    
    def __init__(self, vector_store: VectorStore, embedding_service: EmbeddingService, k: int = 5):
        self.vector_store = vector_store
        self.embedding_service = embedding_service
        self.k = k
    
    def get_relevant_documents(self, query: str) -> List[Document]:
        """Retrieve relevant documents using our VectorStore."""
        try:
            # Generate embedding for query
            query_embedding = self.embedding_service.embed_text(query)
            
            # Ensure it's a list of floats
            if not isinstance(query_embedding, list):
                import numpy as np
                if hasattr(query_embedding, 'tolist'):
                    query_embedding = query_embedding.tolist()
                else:
                    query_embedding = np.array(query_embedding).tolist()
            
            query_embedding = [float(x) for x in query_embedding]
            
            # Query vector store
            results = self.vector_store.query(
                query_embeddings=[query_embedding],
                n_results=self.k
            )
            
            # Convert to LangChain Document format
            documents = []
            if results.get("documents"):
                doc_texts = results["documents"][0] if results["documents"] else []
                doc_metadatas = results.get("metadatas", [[]])[0] if results.get("metadatas") else []
                
                for i, text in enumerate(doc_texts):
                    metadata = doc_metadatas[i] if i < len(doc_metadatas) else {}
                    documents.append(Document(page_content=text, metadata=metadata))
            
            return documents
        except Exception as e:
            logger.error(f"Error retrieving documents: {e}", exc_info=True)
            return []

