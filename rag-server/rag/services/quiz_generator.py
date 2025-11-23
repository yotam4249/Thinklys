# rag/services/quiz_generator.py
from typing import List, Dict, Any, Tuple
import logging
import random
import re
from rag.services.vector_store import VectorStore
from rag.services.embedding_service import EmbeddingService

logger = logging.getLogger(__name__)


class QuizGenerator:
    """Generate quizzes using RAG (Retrieval Augmented Generation) without LLM."""
    
    def __init__(self, vector_store: VectorStore, embedding_service: EmbeddingService):
        self.vector_store = vector_store
        self.embedding_service = embedding_service
    
    def generate_quiz(self, topic: str, level: str, context_documents: List[str]) -> Dict[str, Any]:
        """
        Generate a quiz from topic and context documents using RAG.
        
        Args:
            topic: The quiz topic
            level: Difficulty level (beginner, intermediate, advanced)
            context_documents: List of document texts to use as context
        
        Returns:
            Quiz dictionary with topic, level, and items
        """
        logger.info(f"Generating quiz for topic: {topic}, level: {level}")
        
        # Generate embedding for the topic query
        topic_embedding = self.embedding_service.embed_text(topic)
        
        # Ensure embedding is a list of floats (not tensor) - robust conversion
        if not isinstance(topic_embedding, list):
            import numpy as np
            try:
                import torch
                is_torch_tensor = isinstance(topic_embedding, torch.Tensor)
            except ImportError:
                is_torch_tensor = False
            
            if is_torch_tensor:
                # PyTorch tensor - move to CPU and convert
                topic_embedding = topic_embedding.cpu().detach().numpy().tolist()
            elif hasattr(topic_embedding, 'tolist'):
                topic_embedding = topic_embedding.tolist()
            elif hasattr(topic_embedding, 'cpu'):
                # PyTorch tensor with cpu() method
                topic_embedding = topic_embedding.cpu().numpy().tolist()
            else:
                topic_embedding = np.array(topic_embedding).tolist()
        
        # Final check: ensure it's a list of floats
        if isinstance(topic_embedding, list):
            topic_embedding = [float(x) for x in topic_embedding]
        else:
            logger.error(f"Unexpected embedding type: {type(topic_embedding)}")
            topic_embedding = []
        
        # Query vector store for relevant documents
        query_results = self.vector_store.query(
            query_embeddings=[topic_embedding],
            n_results=min(10, len(context_documents)) if context_documents else 10
        )
        
        # Combine retrieved documents with provided context
        retrieved_docs = query_results.get("documents", [[]])[0] if query_results.get("documents") else []
        all_context = list(set(context_documents + retrieved_docs))
        
        if not all_context:
            logger.warning("No context documents available, generating basic quiz")
            return self._generate_fallback_quiz(topic, level)
        
        # Extract key information from context
        key_facts = self._extract_key_facts(all_context, topic)
        
        # Generate quiz items
        quiz_items = self._generate_quiz_items(key_facts, topic, level)
        
        # Ensure exactly 5 items
        while len(quiz_items) < 5:
            quiz_items.append(self._generate_fallback_item(topic, len(quiz_items) + 1))
        
        quiz_items = quiz_items[:5]
        
        quiz = {
            "topic": topic,
            "level": level,
            "items": quiz_items
        }
        
        logger.info(f"Generated quiz with {len(quiz_items)} items")
        return quiz
    
    def _extract_key_facts(self, documents: List[str], topic: str) -> List[Dict[str, Any]]:
        """Extract key facts and concepts from documents."""
        facts = []
        
        for doc in documents:
            # Split document into sentences
            sentences = re.split(r'[.!?]+', doc)
            
            # Filter sentences relevant to topic
            topic_keywords = set(topic.lower().split())
            for sentence in sentences:
                sentence = sentence.strip()
                if len(sentence) < 20:  # Skip very short sentences
                    continue
                
                sentence_lower = sentence.lower()
                # Check if sentence mentions topic keywords
                if any(keyword in sentence_lower for keyword in topic_keywords):
                    # Extract potential facts (sentences with numbers, definitions, etc.)
                    if any(char.isdigit() for char in sentence) or "is" in sentence_lower or "are" in sentence_lower:
                        facts.append({
                            "text": sentence,
                            "keywords": [w for w in topic_keywords if w in sentence_lower]
                        })
        
        return facts[:20]  # Limit to 20 facts
    
    def _generate_quiz_items(self, facts: List[Dict[str, Any]], topic: str, level: str) -> List[Dict[str, Any]]:
        """Generate quiz items from facts."""
        items = []
        
        if not facts:
            return []
        
        # Shuffle facts for variety
        random.shuffle(facts)
        
        for i, fact in enumerate(facts[:5]):
            # Extract key information from fact
            fact_text = fact["text"]
            
            # Generate question based on fact
            question = self._generate_question_from_fact(fact_text, topic)
            
            # Generate options
            options, correct_index = self._generate_options(fact_text, facts, topic)
            
            items.append({
                "id": str(i + 1),
                "question": question,
                "options": options,
                "correctIndex": correct_index
            })
        
        return items
    
    def _generate_question_from_fact(self, fact: str, topic: str) -> str:
        """Generate a question from a fact."""
        # Simple question generation patterns
        fact_lower = fact.lower()
        
        # Pattern 1: "X is Y" -> "What is X?"
        if " is " in fact_lower:
            parts = fact.split(" is ", 1)
            if len(parts) == 2:
                subject = parts[0].strip()
                # Remove articles
                subject = re.sub(r'^(the|a|an)\s+', '', subject, flags=re.IGNORECASE)
                return f"What is {subject}?"
        
        # Pattern 2: "X are Y" -> "What are X?"
        if " are " in fact_lower:
            parts = fact.split(" are ", 1)
            if len(parts) == 2:
                subject = parts[0].strip()
                subject = re.sub(r'^(the|a|an)\s+', '', subject, flags=re.IGNORECASE)
                return f"What are {subject}?"
        
        # Pattern 3: Extract numbers and create "How many" question
        numbers = re.findall(r'\d+', fact)
        if numbers:
            return f"According to the material, what is mentioned about {topic}?"
        
        # Pattern 4: Generic question
        return f"Which statement is true about {topic}?"
    
    def _generate_options(self, correct_fact: str, all_facts: List[Dict[str, Any]], topic: str) -> Tuple[List[str], int]:
        """Generate 4 options: one correct, three distractors. Returns (options, correct_index)."""
        correct_answer = correct_fact[:200] if len(correct_fact) > 200 else correct_fact
        options = [correct_answer]
        
        # Generate distractors from other facts or generic options
        distractors = []
        
        # Use other facts as distractors
        other_facts = [f["text"] for f in all_facts if f["text"] != correct_fact]
        random.shuffle(other_facts)
        
        for fact in other_facts[:3]:
            truncated = fact[:200] if len(fact) > 200 else fact
            if truncated != correct_answer:
                distractors.append(truncated)
        
        # If not enough distractors, add generic ones
        while len(distractors) < 3:
            distractors.append(f"This statement is not directly related to {topic}.")
        
        # Combine and shuffle
        options.extend(distractors[:3])
        random.shuffle(options)
        
        # Find correct index
        correct_index = options.index(correct_answer) if correct_answer in options else 0
        
        return options[:4], correct_index
    
    def _generate_fallback_quiz(self, topic: str, level: str) -> Dict[str, Any]:
        """Generate a basic fallback quiz when no context is available."""
        items = []
        for i in range(5):
            items.append(self._generate_fallback_item(topic, i + 1))
        
        return {
            "topic": topic,
            "level": level,
            "items": items
        }
    
    def _generate_fallback_item(self, topic: str, item_num: int) -> Dict[str, Any]:
        """Generate a fallback quiz item."""
        return {
            "id": str(item_num),
            "question": f"Question {item_num} about {topic}?",
            "options": [
                f"Option A for question {item_num}",
                f"Option B for question {item_num}",
                f"Option C for question {item_num}",
                f"Option D for question {item_num}"
            ],
            "correctIndex": 0
        }

