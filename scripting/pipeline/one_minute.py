"""Generate a validated, 12-scene project from the PDF prompts with Groq."""
from __future__ import annotations

import argparse
import json
import os
import re
import time
from pathlib import Path

from groq import Groq

from .models import new_project, save
from .prompts import render, STYLE_LOCK

CHAR_TAG = re.compile(r"^@CHAR-\d{2}-[A-Z][A-Z0-9-]*$")
BG_TAG = re.compile(r"^#BGD-\d{2}-[A-Z][A-Z0-9-]*$")
PROJECTS_ROOT = Path(os.environ.get("PROJECTS_DIR", "projects"))


def ask(client: Groq, model: str, prompt: str, max_tokens: int = 4800):
    for attempt in range(5):
        try:
            response = client.chat.completions.create(
                model=model, temperature=0, max_tokens=max_tokens,
                reasoning_effort="low",
                messages=[{"role": "user", "content": prompt}],
            )
            content = response.choices[0].message.content or ""
            if not content.strip():
                raise ValueError(f"Groq returned empty content ({response.choices[0].finish_reason})")
            return content
        except Exception as exc:
            if "rate" not in type(exc).__name__.lower() or attempt == 4:
                raise
            time.sleep(12 * (attempt + 1))


def json_object(raw: str) -> dict:
    clean = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", raw.strip(), flags=re.I)
    try:
        result = json.loads(clean)
    except json.JSONDecodeError:
        start, end = clean.find("{"), clean.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("Groq did not return a JSON object")
        result = json.loads(clean[start:end + 1])
    if not isinstance(result, dict):
        raise ValueError("Expected a JSON object")
    return result


def save_stage(path: Path, project: dict, name: str, raw: str):
    project.setdefault("raw_stages", {})[name] = raw
    save(path, project)


def make_prompts(scene: dict, chars: dict, bgs: dict) -> dict:
    bg = scene["background_tag"]
    tags = scene["character_tags"]
    speaker = scene["speaker"]
    look = "; ".join(chars[tag]["look_summary"] for tag in tags) or "no visible characters"
    still = (
        "2D semi-realistic cartoon illustration, bold clean outlines, smooth flat cel shading, "
        f"{bg} environment ({bgs[bg]['look_summary']}), {look}. "
        f"{scene['visual_action']} Camera: {scene['camera']}. "
        "Moody teal-blue rainy night lighting, natural adult human anatomy and proportions, "
        "flat 2D vector art, no text, no watermark, --ar 16:9."
    )
    common = (
        "### SYSTEM & ENVIRONMENT\n"
        "CLIP LENGTH: Let Flow determine the natural clip length needed to complete the action and dialogue. "
        "Do not truncate a spoken line or force a fixed duration.\n"
        "STYLE ANCHOR: 2D semi-realistic cartoon illustration, bold clean outlines, "
        "smooth flat cel shading. Maintain 100% flat 2D vector art aesthetics and realistic "
        "adult human proportions.\n"
        f"ACTIVE ENVIRONMENT: {bg}\nACTIVE CHARACTERS: {', '.join(tags) if tags else 'none'}\n\n"
        "### VISUAL ACTION & CAMERA\n"
        f"SCENE ACTION: {scene['visual_action']}\n"
        f"CAMERA: {scene['camera']}\n"
        f"PHYSICS/EFFECTS: {scene['effects']}\n\n"
    )
    restrictions = (
        "### NEGATIVE RESTRICTIONS\n- NO photorealism\n- NO 3D rendering\n"
        "- NO CGI shading\n- NO oversized head or body\n- NO realistic skin/hair textures\n"
        "- NO depth-of-field that breaks the 2D plane\n- NO English-accent inflection\n"
        "- NO dual-character lip-sync\n- NO text overlays\n- NO watermarks"
    )
    dialogue = scene.get("devanagari_dialogue", "").strip()
    lip = (
        "### LIP-SYNC CONTROL & AUDIO\n"
        f"[LIP-SYNC LOCK]: Only {speaker}'s mouth animates to the dialogue. "
        f"All other characters ({', '.join(t for t in tags if t != speaker) or 'none'}) "
        "keep mouths completely closed and still.\n"
        "AUDIO PROTOCOL: Native Indian voice synthesis only.\n"
        f"SPEAKER IDENTITY: {chars[speaker]['voice_description']}\n"
        "LINGUISTIC CONSTRAINT: 100% native North Indian Hindi accent; no Western/English cadence.\n"
        f"DIALOGUE (DEVANAGARI ONLY): \"{dialogue}\"\n"
        f"SOUND DESIGN: {scene['sound_design']}\n\n"
    ) if speaker.startswith("@CHAR-") else ""
    silent = (
        "### LIP-SYNC CONTROL & AUDIO\n"
        "[LIP-SYNC LOCK]: No character speaks. All mouths closed and static.\n"
        "AUDIO PROTOCOL: No voice synthesis. Narrator voiceover will be layered in editing.\n"
        f"SOUND DESIGN: {scene['sound_design']}\n"
        "Do not add any dialogue.\n\n"
    )
    scene["assets"] = {"background_tag": bg, "character_tags": tags}
    # Flow owns the duration. A fixed length cuts off Hindi dialogue when the
    # generation needs more time to finish a performance.
    scene["clip_length_seconds"] = None
    scene["edit_length_seconds"] = None
    scene["still_image_prompt"] = still
    scene["animation_prompt_WITH_lipsync"] = common + lip + restrictions
    scene["animation_prompt_NARRATOR_ONLY"] = common + silent + restrictions
    scene["status"] = "pending"
    scene["error"] = None
    return scene


def validate(project: dict):
    chars = {x["tag"]: x for x in project["characters"]}
    bgs = {x["tag"]: x for x in project["backgrounds"]}
    if len(chars) != len(project["characters"]) or not all(CHAR_TAG.fullmatch(t) for t in chars):
        raise ValueError("Duplicate or invalid character tags")
    if len(bgs) != len(project["backgrounds"]) or not all(BG_TAG.fullmatch(t) for t in bgs):
        raise ValueError("Duplicate or invalid background tags")
    if len(project["scenes"]) != 12:
        raise ValueError(f"Expected 12 scenes, got {len(project['scenes'])}")
    for i, scene in enumerate(project["scenes"], 1):
        if scene["scene_number"] != i or scene["background_tag"] not in bgs:
            raise ValueError(f"Invalid scene number or background at scene {i}")
        if any(tag not in chars for tag in scene["character_tags"]):
            raise ValueError(f"Undefined character in scene {i}")
        if scene["speaker"] not in {"NARRATOR", "none", *chars}:
            raise ValueError(f"Invalid speaker in scene {i}")
        if scene["speaker"].startswith("@CHAR-") and scene["speaker"] not in scene["character_tags"]:
            raise ValueError(f"Speaker absent from scene {i}")
        scene["timestamp"] = "AUTO — determined by the completed Flow clip"
        make_prompts(scene, chars, bgs)


def generate(project_id: str, model: str, title: str | None = None, concept: str | None = None):
    client = Groq()
    path = PROJECTS_ROOT / project_id / "pipeline.json"
    concept = concept or "बारिश में उत्तर भारतीय कस्बे की आख़िरी बस; एक अकेली महिला यात्री, तीसरी खाली सीट, और पिछली दुर्घटना में मरी आत्मा"
    project = new_project(project_id, "B", concept, 3)
    project["style_reference"] = STYLE_LOCK
    project["flow_project_name"] = f"YouTube Automation - {(title or 'Last Bus')[:48]}"
    save(path, project)

    if title:
        raw = "Title supplied directly by the user; idea selection intentionally skipped."
    else:
        idea_prompt = render("ideas", {"CATEGORY": "", "CONCEPT": concept, "NUMBER_OF_IDEAS": 3})
        raw = ask(client, model, idea_prompt + "\nReturn the numbered list exactly as requested. Do not invent real place names.", 1800)
    save_stage(path, project, "ideas", raw)
    project["idea"].update(status="done", raw_output=raw)
    # User delegated selection. Lock the topic before the next call so later stages cannot drift.
    if title:
        hook = ask(client, model, f"Write one single-sentence Devanagari Hindi folk-horror hook for this exact video title: {title}. Keep it original, set in a fictional North Indian town, and use no real people or places. Return only the hook.", 220)
        selected = {"index": 1, "title": title.strip(), "hook": hook.strip(), "entity_archetype": "Pret-aatma"}
    else:
        selected = {"index": 1, "title": "आख़िरी बस की तीसरी सीट (Aakhri Bus Ki Teesri Seat)",
                    "hook": "बरसाती रात की आख़िरी बस में तीसरी सीट हर पड़ाव पर भीग जाती है, जबकि उस पर कोई दिखाई नहीं देता।",
                    "entity_archetype": "Pret-aatma"}
    project["idea"].update(items=[selected], selected_index=1, selected=selected)
    save(path, project)

    story = render("story", {"TITLE": selected["title"], "HOOK": selected["hook"], "LANGUAGE": "Hindi",
                               "DURATION_MINUTES": 1, "WORD_COUNT": 150, "MONSTER": "बस की तीसरी सीट की प्रेत-आत्मा"})
    raw = ask(client, model, story + "\nWrite the full 130–155-word Hindi story now. Use only fictional named people and a fictional unnamed North Indian town. Every line that will be spoken must be written in Devanagari. One female protagonist, one driver, one spectral woman. Do not switch to another premise.", 4000)
    project["script"].update(status="done", language="Hindi", duration_minutes=1, word_count=150,
                             monster="प्रेत-आत्मा", raw_text=raw, raw_output=raw)
    save(path, project)

    schema = """Return ONLY JSON: {"characters":[{"tag":"@CHAR-01-NAME","name":"...","look_summary":"...","full_prompt":"...","voice_description":"..."}]}.
All names/roles must come from the locked script. Never include a tag table as a character. Each full_prompt must be a complete 16:9 human-proportioned 2D reference-sheet prompt with exact face, clothes, age, and pose."""
    raw = ask(client, model, render("characters", {"SCRIPT": raw}) + "\n" + schema, 3000)
    project["characters"] = [{**c, "status": "pending", "error": None} for c in json_object(raw)["characters"]]
    save_stage(path, project, "characters", raw)

    bg_schema = """Return ONLY JSON: {"backgrounds":[{"tag":"#BGD-01-NAME","location_name":"...","look_summary":"...","full_prompt":"..."}]}.
Every recurring location gets a wide and a close angle as separate tagged plates. All plates must be empty, 16:9, and in the locked 2D style."""
    raw = ask(client, model, render("backgrounds", {"SCRIPT": project["script"]["raw_text"]}) + "\n" + bg_schema, 3000)
    project["backgrounds"] = [{**b, "status": "pending", "error": None} for b in json_object(raw)["backgrounds"]]
    save_stage(path, project, "backgrounds", raw)

    compact_chars = [{"tag": c["tag"], "name": c["name"], "look_summary": c["look_summary"]} for c in project["characters"]]
    compact_bgs = [{"tag": b["tag"], "location_name": b["location_name"], "look_summary": b["look_summary"]} for b in project["backgrounds"]]
    scene_prompt = render("scenes", {"DURATION_MINUTES": 1, "MINIMUM_SCENES": 7, "SCENE_COUNT": 12,
                                     "SCRIPT": project["script"]["raw_text"],
                                     "CHARACTERS": json.dumps(compact_chars, ensure_ascii=False),
                                     "BACKGROUNDS": json.dumps(compact_bgs, ensure_ascii=False)})
    scene_schema = """Return ONLY JSON with {"scenes":[{"scene_number":1,"title":"...","background_tag":"#BGD-01-NAME","character_tags":["@CHAR-01-NAME"],"speaker":"NARRATOR|none|@CHAR-01-NAME","visual_action":"...","camera":"...","effects":"...","sound_design":"...","devanagari_dialogue":"...","narration_text":"..."}]}.
Exactly 12 scenes in script order. Do not specify, request, or assume a fixed clip length: Flow must choose the natural length needed to complete the action and any dialogue. Use ONLY listed tags. Dialogue must be an exact line from the script; for narration, keep the exact line as metadata for later editing, not in the Flow animation prompt. For every NARRATOR or none scene, narration_text is mandatory: provide one concise Devanagari Hindi narration line consistent with the locked script, never blank. Do not invent character dialogue."""
    raw = ask(client, model, scene_prompt + "\n" + scene_schema, 6000)
    project["scenes"] = json_object(raw)["scenes"]
    save_stage(path, project, "scenes", raw)
    validate(project)
    missing_narration = [str(s["scene_number"]) for s in project["scenes"] if s["speaker"] in {"NARRATOR", "none"} and not str(s.get("narration_text", "")).strip()]
    if missing_narration:
        raise ValueError(f"Narration text is required for every non-character scene; missing scenes: {', '.join(missing_narration)}")
    save(path, project)
    return path


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-id", default="youtube-automation-last-bus")
    parser.add_argument("--model", default="openai/gpt-oss-120b")
    parser.add_argument("--title", default=None, help="A supplied title skips idea selection and generates the locked 12-scene project.")
    parser.add_argument("--concept", default=None, help="Optional premise detail to guide the title-based story.")
    args = parser.parse_args()
    print(generate(args.project_id, args.model, title=args.title, concept=args.concept))
