import os
from google import genai
from google.genai import types
from pydantic import BaseModel
from typing import TypeVar

T = TypeVar("T", bound=BaseModel)


def get_client() -> genai.Client:
    """Return a Gemini client configured for either Vertex AI or the Developer API.

    The `google-genai` SDK supports both. We pick based on env so the same code
    runs in local dev (Developer API key) and in Cloud Functions on GCP (Vertex AI).
    """
    if os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "").lower() == "true":
        return genai.Client(
            vertexai=True,
            project=os.environ["GOOGLE_CLOUD_PROJECT"],
            location=os.environ.get("GOOGLE_CLOUD_LOCATION", "europe-west1"),
        )
    return genai.Client(api_key=os.environ["GEMINI_API_KEY"])


def call_structured(model: str, prompt: str, response_schema: type[T]) -> T:
    """Single call shape reused by all 5 LLM agents.

    Forces JSON output that conforms to `response_schema` (a Pydantic class) and
    parses it back into a typed instance. If the SDK ever returns text that
    cannot be validated, this raises — phase 05 (cloud function glue) decides
    the retry policy at the orchestrator level. Do NOT add retries here.
    """
    client = get_client()
    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=response_schema,
        ),
    )
    return response_schema.model_validate_json(response.text)
