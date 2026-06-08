# DESTRUCTIVE: deletes the entire `quiz_documents` Chroma collection.
# Intended to be run manually after introducing per-user metadata, so the
# next round of uploads is properly user-scoped.

import logging
import sys

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)


def main() -> int:
    from rag.services.vector_store import VectorStore

    store = VectorStore()
    before = 0
    try:
        info = store.get_collection_info()
        before = int(info.get("count", 0) or 0)
    except Exception as exc:  # pragma: no cover - diagnostic only
        logger.warning("Could not read pre-wipe count: %s", exc)

    logger.info("Wiping quiz_documents collection (was %d chunks)...", before)
    store.delete_collection()

    # Re-initialize the collection so subsequent runs have a usable store.
    fresh = VectorStore()
    after = 0
    try:
        info = fresh.get_collection_info()
        after = int(info.get("count", 0) or 0)
    except Exception as exc:  # pragma: no cover - diagnostic only
        logger.warning("Could not read post-wipe count: %s", exc)

    deleted = max(before - after, before)
    logger.info("Deleted %d chunks. Collection is ready for re-upload.", deleted)
    return 0


if __name__ == "__main__":
    sys.exit(main())
