# rag/services/vector_store.py
import chromadb
from chromadb.config import Settings as ChromaSettings
from typing import List, Optional
import logging
from rag.core.config import settings

logger = logging.getLogger(__name__)


class VectorStore:
    """Vector store using ChromaDB for document embeddings."""
    
    def __init__(self):
        self.client: Optional[chromadb.ClientAPI] = None
        self.collection: Optional[chromadb.Collection] = None
        self._initialize()
    
    def _initialize(self):
        """Initialize ChromaDB client and collection."""
        try:
            self.client = chromadb.PersistentClient(
                path=settings.CHROMA_PERSIST_DIR,
                settings=ChromaSettings(
                    anonymized_telemetry=False,
                    allow_reset=True
                )
            )
            
            # Get or create collection for quiz documents
            # ChromaDB uses HNSW (Hierarchical Navigable Small World) index by default
            # HNSW is optimized for fast approximate nearest neighbor search
            # Distance metrics: "cosine" (default, good for normalized embeddings), "l2" (Euclidean), "ip" (inner product)
            distance_metric = getattr(settings, 'CHROMA_DISTANCE_METRIC', 'cosine')
            
            # Collection metadata
            # ChromaDB automatically uses HNSW as the index type - no explicit configuration needed
            # The distance metric can be specified in metadata for new collections
            collection_metadata = {
                "description": "Documents for quiz generation",
            }
            
            # Set distance metric in metadata (ChromaDB uses this for HNSW distance calculation)
            # Note: For existing collections, the distance metric is already set and cannot be changed
            if distance_metric != "cosine":
                collection_metadata["hnsw:space"] = distance_metric
            
            # Create collection - ChromaDB will use HNSW index automatically
            self.collection = self.client.get_or_create_collection(
                name="quiz_documents",
                metadata=collection_metadata
            )
            
            # Log confirmation that HNSW is being used
            # ChromaDB uses HNSW by default for all collections
            logger.info(f"✅ Collection configured with HNSW index (default) and {distance_metric} distance metric")
            
            logger.info(f"Vector store initialized at {settings.CHROMA_PERSIST_DIR}")
        except Exception as e:
            logger.error(f"Failed to initialize vector store: {e}", exc_info=True)
            raise
    
    def add_documents(
        self,
        documents: List[str],
        embeddings: List[List[float]],
        metadatas: Optional[List[dict]] = None,
        ids: Optional[List[str]] = None
    ):
        """Add documents with embeddings to the vector store."""
        if not self.collection:
            raise RuntimeError("Vector store not initialized")
        
        try:
            self.collection.add(
                embeddings=embeddings,
                documents=documents,
                metadatas=metadatas or [{}] * len(documents),
                ids=ids or [f"doc_{i}" for i in range(len(documents))]
            )
            logger.info(f"Added {len(documents)} documents to vector store")
        except Exception as e:
            logger.error(f"Error adding documents: {e}", exc_info=True)
            raise
    
    def query(
        self,
        query_embeddings: List[List[float]],
        n_results: int = 5,
        where: Optional[dict] = None
    ) -> dict:
        """Query the vector store for similar documents."""
        if not self.collection:
            raise RuntimeError("Vector store not initialized")
        
        try:
            results = self.collection.query(
                query_embeddings=query_embeddings,
                n_results=n_results,
                where=where
            )
            return results
        except Exception as e:
            logger.error(f"Error querying vector store: {e}", exc_info=True)
            raise
    
    def delete_collection(self):
        """Delete the collection (for testing/reset)."""
        if self.client and self.collection:
            self.client.delete_collection(name="quiz_documents")
            logger.info("Collection deleted")
    
    def get_collection_info(self) -> dict:
        """Get information about the collection."""
        if not self.collection:
            return {"count": 0}
        
        count = self.collection.count()
        return {"count": count}

