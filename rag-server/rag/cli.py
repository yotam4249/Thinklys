# rag/cli.py
import subprocess
import sys


def dev():
    """Run the RAG server in development mode."""
    subprocess.run([sys.executable, "-m", "rag.main"])

