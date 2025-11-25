# rag/services/text_chunker.py
"""
Text chunking service with cleaning and overlap support.
Optimized for all-MiniLM-L6-v2 model (recommended chunk size: ~256 tokens ≈ 1000 chars).
"""
import re
import logging
from typing import List
from rag.core.config import settings

logger = logging.getLogger(__name__)


class TextChunker:
    """Service for cleaning and chunking text documents with overlap."""
    
    def __init__(self, chunk_size: int = None, chunk_overlap: int = None):
        """
        Initialize text chunker.
        
        Args:
            chunk_size: Target chunk size in characters (default: from config or 1000)
            chunk_overlap: Overlap size in characters (default: 20% of chunk_size)
        """
        # all-MiniLM-L6-v2 works best with ~256 tokens ≈ 1000 characters
        self.chunk_size = chunk_size or getattr(settings, 'TEXT_CHUNK_SIZE', 1000)
        # Default overlap: 20% of chunk size (ensures important sentences aren't split)
        self.chunk_overlap = chunk_overlap or getattr(settings, 'TEXT_CHUNK_OVERLAP', int(self.chunk_size * 0.2))
        
        logger.info(f"TextChunker initialized: chunk_size={self.chunk_size}, overlap={self.chunk_overlap}")
    
    def clean_text(self, text: str) -> str:
        """
        Clean text by removing HTML, extra spaces, empty lines, etc.
        
        Args:
            text: Raw text to clean
        
        Returns:
            Cleaned text
        """
        if not text:
            return ""
        
        # Remove HTML tags
        text = re.sub(r'<[^>]+>', '', text)
        
        # Remove URLs
        text = re.sub(r'http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+', '', text)
        
        # Remove email addresses
        text = re.sub(r'\S+@\S+', '', text)
        
        # Replace multiple whitespace with single space
        text = re.sub(r'\s+', ' ', text)
        
        # Remove leading/trailing whitespace
        text = text.strip()
        
        # Remove empty lines (replace multiple newlines with single newline)
        text = re.sub(r'\n\s*\n', '\n', text)
        
        # Remove special characters that might interfere (but keep punctuation)
        # Keep: letters, numbers, spaces, and common punctuation
        text = re.sub(r'[^\w\s\.\,\!\?\;\:\-\(\)\[\]\{\}\'\"]', ' ', text)
        
        # Final cleanup: remove extra spaces
        text = re.sub(r' +', ' ', text)
        
        return text.strip()
    
    def split_into_sentences(self, text: str) -> List[str]:
        """
        Split text into sentences using regex.
        Tries to preserve sentence boundaries.
        
        Args:
            text: Text to split
        
        Returns:
            List of sentences
        """
        # Pattern to match sentence endings (. ! ?) followed by space or end of string
        # Also handles abbreviations and decimal numbers
        sentence_pattern = r'(?<=[.!?])\s+(?=[A-Z])|(?<=[.!?])\s*$'
        sentences = re.split(sentence_pattern, text)
        
        # Filter out empty sentences
        sentences = [s.strip() for s in sentences if s.strip()]
        
        return sentences
    
    def chunk_text(self, text: str) -> List[str]:
        """
        Chunk text intelligently with overlap, preserving sentence boundaries.
        
        Args:
            text: Text to chunk
        
        Returns:
            List of text chunks with overlap
        """
        if not text or not text.strip():
            return []
        
        # Clean the text first
        cleaned_text = self.clean_text(text)
        
        if len(cleaned_text) <= self.chunk_size:
            return [cleaned_text] if cleaned_text else []
        
        # Split into sentences
        sentences = self.split_into_sentences(cleaned_text)
        
        if not sentences:
            # Fallback: split by character if no sentences found
            return self._chunk_by_characters(cleaned_text)
        
        chunks = []
        current_chunk = []
        
        for sentence in sentences:
            sentence_length = len(sentence)
            
            # Handle case where a single sentence is longer than chunk_size
            if sentence_length > self.chunk_size:
                # If we have a current chunk, save it first
                if current_chunk:
                    chunk_text = ' '.join(current_chunk)
                    chunks.append(chunk_text)
                    current_chunk = []
                
                # Split the long sentence by words and chunk it
                words = sentence.split()
                word_chunk = []
                word_chunk_length = 0
                
                for word in words:
                    word_length = len(word)
                    # Account for space if not first word
                    space_needed = 1 if word_chunk else 0
                    
                    if word_chunk_length + space_needed + word_length > self.chunk_size and word_chunk:
                        # Save current word chunk
                        chunks.append(' '.join(word_chunk))
                        
                        # Start new chunk with overlap
                        overlap_words = []
                        overlap_length = 0
                        for w in reversed(word_chunk):
                            if overlap_length + len(w) + 1 <= self.chunk_overlap:
                                overlap_words.insert(0, w)
                                overlap_length += len(w) + 1
                            else:
                                break
                        
                        word_chunk = overlap_words + [word]
                        # Recalculate length properly
                        word_chunk_length = len(' '.join(word_chunk))
                    else:
                        word_chunk.append(word)
                        word_chunk_length += word_length + space_needed
                
                # Add remaining words to current_chunk
                if word_chunk:
                    current_chunk = word_chunk
                continue
            
            # Calculate current chunk length (with spaces between sentences)
            current_length = len(' '.join(current_chunk)) if current_chunk else 0
            space_needed = 1 if current_chunk else 0
            
            # If adding this sentence would exceed chunk size, start a new chunk
            if current_length + space_needed + sentence_length > self.chunk_size and current_chunk:
                # Create chunk from current sentences
                chunk_text = ' '.join(current_chunk)
                chunks.append(chunk_text)
                
                # Start new chunk with overlap
                # Take last sentences that fit in overlap size
                overlap_sentences = []
                overlap_length = 0
                for s in reversed(current_chunk):
                    space_for_s = 1 if overlap_sentences else 0
                    if overlap_length + space_for_s + len(s) <= self.chunk_overlap:
                        overlap_sentences.insert(0, s)
                        overlap_length += len(s) + space_for_s
                    else:
                        break
                
                current_chunk = overlap_sentences + [sentence]
            else:
                current_chunk.append(sentence)
        
        # Add the last chunk
        if current_chunk:
            chunk_text = ' '.join(current_chunk)
            chunks.append(chunk_text)
        
        logger.debug(f"Chunked text into {len(chunks)} chunks (original length: {len(cleaned_text)})")
        return chunks
    
    def _chunk_by_characters(self, text: str) -> List[str]:
        """
        Fallback: chunk by characters when sentence splitting fails.
        
        Args:
            text: Text to chunk
        
        Returns:
            List of text chunks with overlap
        """
        chunks = []
        start = 0
        
        while start < len(text):
            end = start + self.chunk_size
            chunk = text[start:end]
            
            # Try to end at a word boundary
            if end < len(text):
                # Find last space in chunk
                last_space = chunk.rfind(' ')
                if last_space > self.chunk_size * 0.8:  # Only if we're not too far from end
                    chunk = chunk[:last_space]
                    end = start + last_space + 1
            
            chunks.append(chunk.strip())
            
            # Move start position with overlap
            start = end - self.chunk_overlap
            if start < 0:
                start = end
        
        return [c for c in chunks if c]  # Remove empty chunks
    
    def chunk_texts(self, texts: List[str]) -> List[str]:
        """
        Chunk multiple texts and return all chunks.
        
        Args:
            texts: List of texts to chunk
        
        Returns:
            List of all chunks from all texts
        """
        all_chunks = []
        
        for text in texts:
            if not text or not text.strip():
                continue
            
            chunks = self.chunk_text(text)
            all_chunks.extend(chunks)
        
        logger.info(f"Chunked {len(texts)} texts into {len(all_chunks)} total chunks")
        return all_chunks

