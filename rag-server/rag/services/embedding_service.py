# rag/services/embedding_service.py
from sentence_transformers import SentenceTransformer
from typing import List, Optional
import logging
from rag.core.config import settings

logger = logging.getLogger(__name__)


class EmbeddingService:
    """Service for generating embeddings using sentence-transformers."""
    
    def __init__(self):
        self.model: Optional[SentenceTransformer] = None
        self._load_model()
    
    def _load_model(self):
        """Load the embedding model."""
        try:
            model_name = settings.EMBEDDING_MODEL
            logger.info(f"Loading embedding model: {model_name}")
            self.model = SentenceTransformer(model_name)
            logger.info("Embedding model loaded successfully")
        except Exception as e:
            logger.error(f"Failed to load embedding model: {e}", exc_info=True)
            raise
    
    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for a list of texts."""
        if not self.model:
            raise RuntimeError("Embedding model not loaded")
        
        try:
            # Generate embeddings - always convert to numpy first
            embeddings = self.model.encode(texts, convert_to_numpy=True, show_progress_bar=False)
            
            # Convert to list of lists of floats
            import numpy as np
            if isinstance(embeddings, np.ndarray):
                # Single text or batch - ensure 2D
                if len(embeddings.shape) == 1:
                    embeddings = embeddings.reshape(1, -1)
                return [[float(x) for x in row] for row in embeddings]
            elif isinstance(embeddings, list):
                # Already a list - convert each element
                result = []
                for emb in embeddings:
                    if isinstance(emb, (list, tuple)):
                        result.append([float(x) for x in emb])
                    elif hasattr(emb, 'tolist'):
                        result.append([float(x) for x in emb.tolist()])
                    elif hasattr(emb, 'cpu'):
                        # PyTorch tensor
                        result.append([float(x) for x in emb.cpu().numpy().tolist()])
                    else:
                        result.append([float(x) for x in np.array(emb).tolist()])
                return result
            else:
                # Fallback: convert to numpy then to list
                emb_array = np.array(embeddings)
                if len(emb_array.shape) == 1:
                    emb_array = emb_array.reshape(1, -1)
                return [[float(x) for x in row] for row in emb_array]
        except Exception as e:
            logger.error(f"Error generating embeddings: {e}", exc_info=True)
            raise
    
    def embed_text(self, text: str) -> List[float]:
        """Generate embedding for a single text."""
        result = self.embed_texts([text])
        return result[0] if result else []

