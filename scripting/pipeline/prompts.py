from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1] / "prompts"
STYLE_LOCK = (ROOT.parent / "style_reference.md").read_text(encoding="utf-8")
FILES = {
    "ideas": "1- IDEA GENERATION.txt", "story": "3- STORY.txt", "characters": "4- CHARACTER IMAGE PROMPTS.txt",
    "backgrounds": "5- IMAGE PROMPTS.txt", "scenes": "6- ANIMATION PROMPTS.txt", "publishing": "7- UPLOADING.txt",
}

def render(stage: str, values: dict[str, object]) -> str:
    path = ROOT / FILES[stage]
    if not path.exists(): raise FileNotFoundError(f"Missing literal PDF template: {path}")
    text = path.read_text(encoding="utf-8")
    if "PASTE_LITERAL_TEMPLATE_HERE" in text: raise RuntimeError(f"Template has not been copied from HORROR_PROMPTS.pdf: {path}")
    def replace(m: re.Match[str]) -> str:
        key = m.group(1)
        if key not in values: raise KeyError(f"No substitution supplied for {{{{{key}}}}} in {path.name}")
        return str(values[key])
    rendered = re.sub(r"\{\{([A-Za-z0-9_]+)\}\}", replace, text)
    if stage in {"characters", "backgrounds", "scenes"}:
        rendered += "\n\nPROJECT STYLE LOCK — preserve exactly:\n" + STYLE_LOCK
        rendered += "\n\nOPERATIONAL INSTRUCTION: All locked inputs required for this stage are included below. Do not ask for them. Generate the requested output now."
        if stage in {"characters", "backgrounds"}:
            rendered += "\n\nLOCKED SCRIPT — SOURCE OF TRUTH:\n" + str(values["SCRIPT"])
    return rendered
