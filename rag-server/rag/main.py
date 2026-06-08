# rag/main.py
import logging
import signal
import sys
import threading

import uvicorn

from rag.api import create_api
from rag.consumers.quiz_consumer import QuizConsumer
from rag.core.config import settings

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
        # Create QuizConsumer first so we can share its vector_store / embeddings
        # with the internal HTTP API (same Chroma collection, same model).
        print("[RAG-SERVER] Creating QuizConsumer...")
        consumer = QuizConsumer()

        # Build the internal HTTP API using the consumer's services.
        api = create_api(
            vector_store=consumer.vector_store,
            embedding_service=consumer.embedding_service,
        )

        # Kafka consumer runs in a background daemon thread; HTTP server runs
        # in the main thread so SIGINT/SIGTERM are handled correctly.
        def consumer_thread() -> None:
            try:
                print("[RAG-SERVER] Starting Kafka consumer in background thread...")
                consumer.start()
            except Exception as e:
                print(f"[RAG-SERVER] ❌ Kafka consumer thread error: {e}")
                logger.error("Kafka consumer thread error: %s", e, exc_info=True)

        kafka_thread = threading.Thread(
            target=consumer_thread,
            name="rag-kafka-consumer",
            daemon=True,
        )
        kafka_thread.start()

        host = settings.RAG_HTTP_HOST
        port = settings.RAG_HTTP_PORT
        print(f"[RAG-SERVER] Starting internal HTTP API at http://{host}:{port}")
        uvicorn.run(api, host=host, port=port, log_level="info")
    except KeyboardInterrupt:
        print("[RAG-SERVER] Server interrupted by user")
        logger.info("Server interrupted by user")
    except Exception as e:
        print(f"[RAG-SERVER] ❌ Fatal error: {e}")
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
