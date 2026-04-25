"""Shared test configuration.

Loads .env at the repo root so tests pick up GEMINI_API_KEY (and any other
env vars) without the developer having to export them manually in every
terminal session.
"""
from dotenv import load_dotenv
from pathlib import Path

# Walk up from tests/ to find the .env file in llm-integration/
_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path)
