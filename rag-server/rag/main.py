# rag/main.py
import logging
import signal
import sys
from rag.consumers.quiz_consumer import QuizConsumer

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

logger = logging.getLogger(__name__)


def signal_handler(sig, frame):
    """Handle shutdown signals."""
    logger.info("Shutdown signal received, exiting...")
    sys.exit(0)


def main():
    """Main entry point for RAG server."""
    print("=" * 60)
    print("[RAG-SERVER] 🚀 Starting RAG Quiz Generation Server...")
    print("=" * 60)
    logger.info("Starting RAG Quiz Generation Server...")
    
    # Register signal handlers
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        # Create and start quiz consumer
        print("[RAG-SERVER] Creating QuizConsumer...")
        consumer = QuizConsumer()
        print("[RAG-SERVER] Starting consumer...")
        consumer.start()
    except KeyboardInterrupt:
        print("[RAG-SERVER] Server interrupted by user")
        logger.info("Server interrupted by user")
    except Exception as e:
        print(f"[RAG-SERVER] ❌ Fatal error: {e}")
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()

