# rag/services/mcp_service.py
"""
MCP (Model Context Protocol) Service for enriching RAG with external knowledge sources.
Uses official APIs (not scraping):
- Wikipedia API (official)
- GitHub API (official)
"""
import logging
from typing import List, Optional
from langchain_community.tools import WikipediaQueryRun
from langchain_community.utilities import WikipediaAPIWrapper
import requests
from rag.core.config import settings

logger = logging.getLogger(__name__)


class MCPService:
    """
    MCP Service for enriching context with external knowledge sources.
    Uses official APIs - no scraping involved.
    """
    
    def __init__(self, enable_wikipedia: bool = True, enable_github: bool = True):
        self.enable_wikipedia = enable_wikipedia
        self.enable_github = enable_github
        
        # Initialize Wikipedia tool (uses official Wikipedia API)
        if self.enable_wikipedia:
            try:
                wiki_wrapper = WikipediaAPIWrapper()
                self.wikipedia_tool = WikipediaQueryRun(api_wrapper=wiki_wrapper)
                logger.info("✅ Wikipedia MCP service initialized (using official API)")
            except Exception as e:
                logger.warning(f"Failed to initialize Wikipedia: {e}")
                self.enable_wikipedia = False
        
        # GitHub API setup (official GitHub REST API)
        if self.enable_github:
            try:
                github_token_value = settings.GITHUB_TOKEN.get_secret_value() if settings.GITHUB_TOKEN else None
                self.github_token = github_token_value if github_token_value and github_token_value.strip() else None
                if self.github_token:
                    logger.info("✅ GitHub MCP service initialized (using official API with token - 5000 req/hour)")
                else:
                    logger.info("ℹ️ GitHub MCP service initialized (no token - 60 req/hour limit, still works!)")
            except Exception as e:
                logger.warning(f"GitHub token error: {e}")
                self.github_token = None
                logger.info("ℹ️ GitHub MCP service will work without token (60 req/hour limit)")
    
    def enrich_context(
        self,
        topic: str,
        existing_context: List[str],
        max_wikipedia_results: int = 2,
        max_github_results: int = 2
    ) -> List[str]:
        """
        Enrich context with external knowledge sources.
        
        Args:
            topic: The quiz topic
            existing_context: Context from user documents
            max_wikipedia_results: Max Wikipedia summaries to include
            max_github_results: Max GitHub code examples to include
        
        Returns:
            Enriched context list
        """
        logger.info(f"[MCP] 🔍 Starting context enrichment for topic: {topic}")
        logger.info(f"[MCP]   Initial context size: {len(existing_context)} documents")
        
        enriched = list(existing_context)
        
        # Add Wikipedia information
        if self.enable_wikipedia:
            try:
                logger.info(f"[MCP] 📚 Querying Wikipedia API for: {topic}")
                wiki_context = self._get_wikipedia_context(topic, max_wikipedia_results)
                if wiki_context:
                    enriched.extend(wiki_context)
                    logger.info(f"[MCP] ✅ Wikipedia: Added {len(wiki_context)} context(s) ({len(wiki_context[0])} chars)")
                else:
                    logger.info(f"[MCP] ⚠️ Wikipedia: No results found")
            except Exception as e:
                logger.warning(f"[MCP] ❌ Wikipedia enrichment failed: {e}")
        else:
            logger.info(f"[MCP] ⏭️ Wikipedia: Disabled")
        
        # Add GitHub code examples
        if self.enable_github:
            try:
                logger.info(f"[MCP] 💻 Querying GitHub API for: {topic}")
                github_context = self._get_github_context(topic, max_github_results)
                if github_context:
                    enriched.extend(github_context)
                    logger.info(f"[MCP] ✅ GitHub: Added {len(github_context)} context(s)")
                    for i, ctx in enumerate(github_context, 1):
                        logger.info(f"[MCP]   GitHub #{i}: {ctx.split(chr(10))[0]}")  # First line only
                else:
                    logger.info(f"[MCP] ⚠️ GitHub: No results found (might be rate limited)")
            except Exception as e:
                logger.warning(f"[MCP] ❌ GitHub enrichment failed: {e}")
        else:
            logger.info(f"[MCP] ⏭️ GitHub: Disabled")
        
        logger.info(f"[MCP] ✅ Enrichment complete: {len(existing_context)} → {len(enriched)} documents (+{len(enriched) - len(existing_context)} from MCP)")
        return enriched
    
    def _get_wikipedia_context(self, topic: str, max_results: int = 2) -> List[str]:
        """Get Wikipedia information using official Wikipedia API."""
        try:
            # Query Wikipedia (uses official API, not scraping)
            query = f"{topic} programming"
            logger.debug(f"[MCP] Wikipedia query: {query}")
            result = self.wikipedia_tool.run(query)
            
            if result and result.strip():
                # Limit length to avoid token bloat
                summary = result[:1000] if len(result) > 1000 else result
                logger.debug(f"[MCP] Wikipedia result length: {len(summary)} chars")
                return [f"Wikipedia context about {topic}:\n{summary}"]
            
            logger.debug(f"[MCP] Wikipedia: Empty result")
            return []
        except Exception as e:
            logger.error(f"[MCP] Wikipedia API error: {e}", exc_info=True)
            return []
    
    def _get_github_context(self, topic: str, max_results: int = 2) -> List[str]:
        """Get GitHub code examples using official GitHub REST API."""
        try:
            # Search GitHub for code examples related to the topic
            # Uses official GitHub Search API (not scraping)
            query = f"{topic} language:python"
            url = "https://api.github.com/search/repositories"
            
            headers = {}
            if self.github_token:
                headers["Authorization"] = f"token {self.github_token}"
            
            params = {
                "q": query,
                "sort": "stars",
                "order": "desc",
                "per_page": max_results
            }
            
            logger.debug(f"[MCP] GitHub API request: {url}?q={query}")
            response = requests.get(url, headers=headers, params=params, timeout=5)
            
            # Check rate limit headers
            if 'X-RateLimit-Remaining' in response.headers:
                remaining = response.headers['X-RateLimit-Remaining']
                logger.debug(f"[MCP] GitHub rate limit remaining: {remaining}")
            
            if response.status_code == 200:
                data = response.json()
                total_count = data.get("total_count", 0)
                logger.debug(f"[MCP] GitHub found {total_count} repositories")
                
                contexts = []
                for repo in data.get("items", [])[:max_results]:
                    repo_name = repo.get("full_name", "")
                    description = repo.get("description", "")
                    if description:
                        contexts.append(
                            f"GitHub repository: {repo_name}\n"
                            f"Description: {description}\n"
                            f"URL: {repo.get('html_url', '')}"
                        )
                
                return contexts
            elif response.status_code == 403:
                # Rate limit reached - check if we have token
                if self.github_token:
                    logger.warning("[MCP] GitHub API rate limit reached (with token)")
                else:
                    logger.info("[MCP] GitHub API rate limit reached (no token - 60 req/hour limit). Consider adding GITHUB_TOKEN for 5000 req/hour.")
                return []
            elif response.status_code == 401:
                logger.warning("[MCP] GitHub API authentication failed (invalid token)")
                return []
            else:
                logger.warning(f"[MCP] GitHub API error: {response.status_code}")
                return []
                
        except Exception as e:
            logger.error(f"GitHub API error: {e}")
            return []

