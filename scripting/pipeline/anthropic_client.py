"""Provider-neutral text client for the scripting half of the pipeline."""
import json
import os
from typing import Literal

from dotenv import load_dotenv

load_dotenv()

Provider = Literal["openai", "groq"]
DEFAULT_MODELS: dict[Provider, str] = {"openai": "gpt-4.1-mini", "groq": "openai/gpt-oss-120b"}


def select_provider() -> Provider:
    """Prefer OpenAI when both supported keys are intentionally configured."""
    if os.getenv("OPENAI_API_KEY"):
        return "openai"
    if os.getenv("GROQ_API_KEY"):
        return "groq"
    raise RuntimeError("No writing-model key found. Add OPENAI_API_KEY or GROQ_API_KEY to scripting/.env (or set it in your environment).")


class ScriptClient:
    """Text-completions adapter using the available local provider."""
    def __init__(self, provider: Provider | None = None, model: str | None = None):
        self.provider = provider or select_provider()
        self.model = model or os.getenv(f"{self.provider.upper()}_MODEL") or DEFAULT_MODELS[self.provider]
        if self.provider == "openai":
            from openai import OpenAI
            self.client = OpenAI()
        else:
            from groq import Groq
            self.client = Groq()

    def complete(self, prompt: str, max_tokens: int = 7000, temperature: float = 0) -> str:
        response = self.client.chat.completions.create(
            model=self.model, max_tokens=max_tokens, temperature=temperature,
            messages=[{"role": "user", "content": prompt}],
        )
        content = response.choices[0].message.content or ""
        if not content.strip():
            raise ValueError(f"{self.provider} returned an empty response")
        return content


# Compatibility names used by the existing stage CLI.
GroqClient = ScriptClient
Claude = ScriptClient

def parse_jsonish(raw: str):
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    try: return json.loads(text)
    except json.JSONDecodeError:
        start, end = min([i for i in [text.find("["), text.find("{")] if i >= 0], default=-1), max(text.rfind("]"), text.rfind("}"))
        if start >= 0 and end > start: return json.loads(text[start:end+1])
        raise ValueError("Groq output was not JSON; preserve raw output and inspect the template's required structure")
