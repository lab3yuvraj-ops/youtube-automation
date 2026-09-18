import json
from groq import Groq

class GroqClient:
    """Groq chat-completions adapter for the stage pipeline."""
    def __init__(self, model: str = "openai/gpt-oss-120b"):
        self.client = Groq()
        self.model = model

    def complete(self, prompt: str) -> str:
        msg = self.client.chat.completions.create(model=self.model, max_tokens=7000, temperature=0, messages=[{"role": "user", "content": prompt}])
        content = msg.choices[0].message.content or ""
        if not content.strip():
            raise ValueError("Groq returned an empty response")
        return content

Claude = GroqClient  # Compatibility for existing callers.

def parse_jsonish(raw: str):
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    try: return json.loads(text)
    except json.JSONDecodeError:
        start, end = min([i for i in [text.find("["), text.find("{")] if i >= 0], default=-1), max(text.rfind("]"), text.rfind("}"))
        if start >= 0 and end > start: return json.loads(text[start:end+1])
        raise ValueError("Groq output was not JSON; preserve raw output and inspect the template's required structure")
