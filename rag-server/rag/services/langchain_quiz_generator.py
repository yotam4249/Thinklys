# rag/services/langchain_quiz_generator.py
"""
LangChain-based RAG quiz generator with OpenAI.
Cost-optimized with caching and efficient prompt design.
"""
import json
import logging
import hashlib
from typing import List, Dict, Any, Optional
from langchain_openai import ChatOpenAI
from langchain.prompts import PromptTemplate
from langchain_core.output_parsers import JsonOutputParser
from rag.services.langchain_vector_store import LangChainVectorStore
from rag.services.mcp_service import MCPService
from rag.core.config import settings

logger = logging.getLogger(__name__)


class LangChainQuizGenerator:
    """
    Generate quizzes using LangChain RAG with OpenAI.
    Optimized for cost with caching and efficient prompts.
    """
    
    def __init__(self, langchain_vector_store: LangChainVectorStore):
        self.vector_store = langchain_vector_store
        self.llm = self._initialize_llm()
        self.quiz_cache: Dict[str, Dict[str, Any]] = {}  # In-memory cache
        
        # Initialize MCP service if enabled
        self.mcp_service: Optional[MCPService] = None
        if settings.ENABLE_MCP:
            try:
                self.mcp_service = MCPService(
                    enable_wikipedia=settings.ENABLE_WIKIPEDIA,
                    enable_github=settings.ENABLE_GITHUB
                )
                logger.info("✅ MCP service initialized (Wikipedia + GitHub)")
            except Exception as e:
                logger.warning(f"Failed to initialize MCP service: {e}")
                self.mcp_service = None
        
        # Cost-optimized prompt (short and focused)
        self.quiz_prompt = PromptTemplate(
            template="""You are a quiz generator. Create a {level} difficulty quiz about "{topic}".

Context from documents:
{context}

Requirements:
- Generate EXACTLY 5 multiple-choice questions
- Each question must have exactly 4 options
- Return valid JSON only, no markdown
- correctIndex must be 0-3

JSON Schema:
{{
  "topic": "{topic}",
  "level": "{level}",
  "items": [
    {{
      "id": "1",
      "question": "...",
      "options": ["option1", "option2", "option3", "option4"],
      "correctIndex": 0
    }}
  ]
}}

Generate the quiz now:""",
            input_variables=["context", "topic", "level"]
        )
        
        # Initialize RAG components
        self.retriever = None
        self.json_parser = None
        self._create_rag_chain()
    
    def _initialize_llm(self) -> ChatOpenAI:
        """Initialize OpenAI LLM with cost-optimized settings."""
        if not settings.OPENAI_API_KEY.get_secret_value():
            raise ValueError("OPENAI_API_KEY is required for LangChain quiz generation")
        
        # Use cheapest model: gpt-4o-mini
        # Pricing: $0.15/$0.60 per 1M tokens (input/output)
        llm = ChatOpenAI(
            model=settings.OPENAI_MODEL,  # gpt-4o-mini
            temperature=settings.OPENAI_TEMPERATURE,
            api_key=settings.OPENAI_API_KEY.get_secret_value(),
            max_tokens=2000,  # Limit output to reduce costs
        )
        
        logger.info(f"Initialized OpenAI LLM: {settings.OPENAI_MODEL}")
        return llm
    
    def _create_rag_chain(self):
        """Create LangChain RAG chain for quiz generation."""
        retriever = self.vector_store.as_retriever(
            k=5,  # Retrieve top 5 relevant documents (balance between context and cost)
        )
        
        # JSON output parser for structured response
        json_parser = JsonOutputParser()
        
        # Create chain: retrieve -> format context -> generate quiz
        # We'll use a simpler approach that works better with our setup
        self.retriever = retriever
        self.json_parser = json_parser
        
        return None  # We'll handle chain execution manually
    
    def _get_cache_key(self, topic: str, level: str, context_hash: str) -> str:
        """Generate cache key from topic, level, and context."""
        key_string = f"{topic}:{level}:{context_hash}"
        return hashlib.md5(key_string.encode()).hexdigest()
    
    def _get_context_hash(self, context_documents: List[str]) -> str:
        """Generate hash of context documents for caching."""
        context_str = "|".join(sorted(context_documents))
        return hashlib.md5(context_str.encode()).hexdigest()[:16]
    
    def generate_quiz(
        self,
        topic: str,
        level: str,
        context_documents: List[str]
    ) -> Dict[str, Any]:
        """
        Generate quiz using LangChain RAG with OpenAI.
        
        Cost optimizations:
        1. Caching - avoid duplicate API calls
        2. Limited context - only top 5 relevant documents
        3. Short prompts - minimize token usage
        4. gpt-4o-mini - cheapest model
        5. max_tokens limit - prevent long outputs
        
        Args:
            topic: Quiz topic
            level: Difficulty level (beginner, intermediate, advanced)
            context_documents: List of document texts (will be enriched with vector search)
        
        Returns:
            Quiz dictionary with topic, level, and items
        """
        logger.info(f"[LangChain RAG] Generating quiz: topic={topic}, level={level}")
        
        # Check cache first
        context_hash = self._get_context_hash(context_documents)
        cache_key = self._get_cache_key(topic, level, context_hash)
        
        if cache_key in self.quiz_cache:
            logger.info(f"[LangChain RAG] Cache HIT for {topic}:{level}")
            return self.quiz_cache[cache_key]
        
        try:
            # Step 1: Retrieve relevant documents from vector store
            retrieved_docs = []
            if self.retriever:
                try:
                    retrieved_docs_list = self.retriever.get_relevant_documents(topic)
                    retrieved_docs = [doc.page_content for doc in retrieved_docs_list]
                except Exception as e:
                    logger.warning(f"Error retrieving from vector store: {e}")
            
            # Step 2: Combine retrieved docs with provided context
            all_context = list(set(context_documents + retrieved_docs))
            
            # Step 2.5: Enrich with MCP sources (Wikipedia + GitHub) if enabled
            if self.mcp_service:
                try:
                    context_before = len(all_context)
                    all_context = self.mcp_service.enrich_context(
                        topic=topic,
                        existing_context=all_context,
                        max_wikipedia_results=2,
                        max_github_results=2
                    )
                    context_after = len(all_context)
                    added = context_after - context_before
                    if added > 0:
                        logger.info(f"[LangChain RAG] ✅ MCP enriched context: +{added} sources (total: {context_after})")
                    else:
                        logger.info(f"[LangChain RAG] ⚠️ MCP enabled but no additional context added")
                except Exception as e:
                    logger.warning(f"[LangChain RAG] ❌ MCP enrichment failed: {e}", exc_info=True)
            else:
                logger.debug(f"[LangChain RAG] MCP service not enabled (ENABLE_MCP=false)")
            
            # Limit context to save tokens (cost optimization)
            context_text = "\n\n".join(all_context[:7])  # Top 7 most relevant (increased for MCP)
            
            if not context_text.strip():
                context_text = "No specific context provided. Generate a general quiz about the topic."
            
            # Step 3: Generate quiz using LLM with context
            formatted_prompt = self.quiz_prompt.format(
                context=context_text,
                topic=topic,
                level=level
            )
            
            # Call LLM
            response = self.llm.invoke(formatted_prompt)
            result_text = response.content if hasattr(response, 'content') else str(response)
            
            # Parse JSON response
            try:
                result = json.loads(result_text)
            except json.JSONDecodeError:
                # Try to extract JSON from markdown code blocks if present
                import re
                json_match = re.search(r'\{.*\}', result_text, re.DOTALL)
                if json_match:
                    result = json.loads(json_match.group())
                else:
                    raise ValueError(f"Could not parse JSON from LLM response: {result_text[:200]}")
            
            # Validate and format result
            quiz = self._validate_and_format_quiz(result, topic, level)
            
            # Cache the result
            self.quiz_cache[cache_key] = quiz
            logger.info(f"[LangChain RAG] Quiz generated and cached: {topic}:{level}")
            
            return quiz
            
        except Exception as e:
            logger.error(f"[LangChain RAG] Error generating quiz: {e}", exc_info=True)
            # Fallback to basic quiz structure
            return self._generate_fallback_quiz(topic, level)
    
    def _validate_and_format_quiz(
        self,
        result: Any,
        topic: str,
        level: str
    ) -> Dict[str, Any]:
        """Validate and format quiz result from LLM."""
        # Handle different response formats
        if isinstance(result, str):
            try:
                result = json.loads(result)
            except json.JSONDecodeError:
                logger.warning("Failed to parse JSON from LLM response")
                return self._generate_fallback_quiz(topic, level)
        
        # Ensure required structure
        if not isinstance(result, dict):
            return self._generate_fallback_quiz(topic, level)
        
        # Validate items
        items = result.get("items", [])
        if not isinstance(items, list) or len(items) < 5:
            logger.warning(f"Invalid items count: {len(items) if isinstance(items, list) else 0}")
            # Try to fix by generating missing items
            while len(items) < 5:
                items.append(self._generate_fallback_item(topic, len(items) + 1))
        
        # Ensure exactly 5 items
        items = items[:5]
        
        # Validate each item
        validated_items = []
        for i, item in enumerate(items):
            if not isinstance(item, dict):
                item = self._generate_fallback_item(topic, i + 1)
            
            # Ensure required fields
            validated_item = {
                "id": str(item.get("id", i + 1)),
                "question": item.get("question", f"Question {i + 1} about {topic}?"),
                "options": item.get("options", [f"Option {j}" for j in range(1, 5)]),
                "correctIndex": int(item.get("correctIndex", 0))
            }
            
            # Ensure 4 options
            if len(validated_item["options"]) != 4:
                validated_item["options"] = validated_item["options"][:4]
                while len(validated_item["options"]) < 4:
                    validated_item["options"].append(f"Option {len(validated_item['options']) + 1}")
            
            # Ensure correctIndex is valid
            if validated_item["correctIndex"] < 0 or validated_item["correctIndex"] >= len(validated_item["options"]):
                validated_item["correctIndex"] = 0
            
            validated_items.append(validated_item)
        
        return {
            "topic": result.get("topic", topic),
            "level": result.get("level", level),
            "items": validated_items
        }
    
    def _generate_fallback_quiz(self, topic: str, level: str) -> Dict[str, Any]:
        """Generate a basic fallback quiz when LLM fails."""
        logger.warning(f"Generating fallback quiz for {topic}:{level}")
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
    
    def clear_cache(self):
        """Clear the quiz cache (useful for testing or memory management)."""
        self.quiz_cache.clear()
        logger.info("Quiz cache cleared")

