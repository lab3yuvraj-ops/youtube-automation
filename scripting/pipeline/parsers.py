import re
from .anthropic_client import parse_jsonish

TAG_CHAR = re.compile(r"@[A-Z0-9_-]+")
TAG_BG = re.compile(r"#[A-Z0-9_-]+")

def ideas(raw):
    try: data = parse_jsonish(raw)
    except ValueError: return _numbered_ideas(raw)
    items = data if isinstance(data, list) else data.get("ideas", data.get("items", []))
    return [{"index": i + 1, **item, "status": "pending"} for i, item in enumerate(items)]

def characters(raw):
    try: data = parse_jsonish(raw); items = data if isinstance(data, list) else data.get("characters", data.get("items", []))
    except ValueError: return _labeled_assets(raw, "char")
    out = []
    for item in items:
        tag = item.get("tag") or item.get("asset_tag") or next(iter(TAG_CHAR.findall(str(item))), None)
        out.append({"status":"pending","error":None,"tag":tag,"name":item.get("name"),"look_summary":item.get("look_summary", ""),"full_prompt":item.get("full_prompt") or item.get("prompt", ""),"voice":item.get("voice", {})})
    return out

def backgrounds(raw):
    try: data = parse_jsonish(raw); items = data if isinstance(data, list) else data.get("backgrounds", data.get("locations", data.get("items", [])))
    except ValueError: return _labeled_assets(raw, "bg")
    out=[]
    for item in items:
        tag=item.get("tag") or item.get("background_tag") or next(iter(TAG_BG.findall(str(item))), None)
        out.append({"status":"pending","error":None,"tag":tag,"location_name":item.get("location_name") or item.get("name"),"look_summary":item.get("look_summary", ""),"full_prompt":item.get("full_prompt") or item.get("prompt", "")})
    return out

def _narrator_variant(prompt: str) -> str:
    lines = prompt.splitlines(); kept=[]; inside=False
    for line in lines:
        u=line.upper()
        if "LIP-SYNC" in u or "DIALOGUE" in u: inside=True
        if not inside: kept.append(line)
        if inside and ("NEGATIVE RESTRICTIONS" in u or "NEGATIVE" in u): inside=False; kept.append(line)
    return "\n".join(kept).rstrip() + "\nDo not add any dialogue."

def scenes(raw):
    try: data = parse_jsonish(raw); items = data if isinstance(data, list) else data.get("scenes", data.get("items", []))
    except ValueError: return _text_scenes(raw)
    out=[]
    for i, item in enumerate(items, 1):
        speaker=item.get("speaker", "none"); anim=item.get("animation_prompt_WITH_lipsync") or item.get("animation_prompt_with_lipsync") or item.get("animation_prompt", "")
        narrator=item.get("animation_prompt_NARRATOR_ONLY") or _narrator_variant(anim)
        out.append({"status":"pending","error":None,"scene_number":item.get("scene_number",i),"title":item.get("title",""),"timestamp":item.get("timestamp","AUTO — determined by the completed Flow clip"),"clip_length_seconds":None,"assets":{"background_tag":item.get("background_tag"),"character_tags":item.get("character_tags",[])},"speaker":speaker,"still_image_prompt":item.get("still_image_prompt", ""),"animation_prompt_WITH_lipsync":anim,"animation_prompt_NARRATOR_ONLY":narrator,"devanagari_dialogue":item.get("devanagari_dialogue", item.get("dialogue", "")),"narration_text":item.get("narration_text", "")})
    return out

def publishing(raw):
    try: return parse_jsonish(raw)
    except ValueError:
        parts={}; matches=list(re.finditer(r"(?im)^\s*=====\s*PART\s+(\d+)\s*[—-]\s*([^=]+?)\s*=====",raw))
        for i,m in enumerate(matches):
            end=matches[i+1].start() if i+1<len(matches) else len(raw)
            parts[f"part_{m.group(1)}_{re.sub(r'[^a-z0-9]+','_',m.group(2).strip().lower()).strip('_')}"]=raw[m.end():end].strip()
        return {"raw":raw,"parts":parts}

def _numbered_ideas(raw):
    out=[]
    table_rows=re.findall(r"(?m)^\s*\|\s*(\d+)\s*\|\s*(?:\*\*)?([^|\n]+?)(?:\*\*)?\s*\|", raw)
    if table_rows:
        for idx,title in table_rows:
            if title.lower().startswith("title") or set(title.strip()) <= {"-"}: continue
            out.append({"index":int(idx),"title":re.sub(r"[*]", "", title).strip(),"raw":title.strip(),"status":"pending"})
        if out: return out
    for i, block in enumerate(re.split(r"(?m)^\s*(?=\d+[.)]\s)", raw.strip()), 1):
        if not block.strip(): continue
        first=block.strip().splitlines()[0].strip(); out.append({"index":i,"title":re.sub(r"^\d+[.)]\s*", "", first),"raw":block,"status":"pending"})
    return out

def _labeled_assets(raw, kind):
    tag_re = TAG_CHAR if kind == "char" else TAG_BG
    matches=list(tag_re.finditer(raw)); out=[]
    for i,m in enumerate(matches):
        block=raw[m.start():matches[i+1].start() if i+1<len(matches) else len(raw)].strip()
        tag=m.group(0); name=(re.search(r"(?im)^\s*(?:NAME|LOCATION)\s*[:—-]\s*(.+)$",block) or [None, tag])[1].strip()
        prompt=block
        if kind=="char": out.append({"status":"pending","error":None,"tag":tag,"name":name,"look_summary":"","full_prompt":prompt,"voice":{}})
        else: out.append({"status":"pending","error":None,"tag":tag,"location_name":name,"look_summary":"","full_prompt":prompt})
    unique=[]; seen=set()
    for item in out:
        if item['tag'] in seen: continue
        seen.add(item['tag']); unique.append(item)
    return unique

def _text_scenes(raw):
    blocks=re.split(r"(?m)^\s*(?=---\s*SCENE|##\s+Example|###\s+SCENE)",raw)
    out=[]
    for i,block in enumerate(blocks):
        m=re.search(r"SCENE\s+(\d+)\s*[—-]\s*(.+)",block,re.I)
        if not m: continue
        ts=re.search(r"TIMESTAMP:?\s*([^\n]+)",block,re.I); assets=re.search(r"ASSETS:?\s*([^\n]+)",block,re.I); sp=re.search(r"SPEAKER:?\s*([^\n]+)",block,re.I)
        still=re.search(r"STILL\s+IMAGE\s+PROMPT\s*:?\s*(.*?)(?=---\s*##\s+ANIMATION|##\s+ANIMATION|$)",block,re.I|re.S)
        anim=re.search(r"(?:ANIMATION\s*\+\s*AUDIO\s+PROMPT|ANIMATION\s*\+\s*AUDIO\s+PROMPT:)(.*)$",block,re.I|re.S)
        asset_text=assets.group(1) if assets else ""; bg=next(iter(TAG_BG.findall(asset_text)),None); chars=TAG_CHAR.findall(asset_text); speaker=(sp.group(1).strip() if sp else "none").split()[0]
        anim_text=anim.group(1).strip() if anim else ""; dialogue=re.search(r"DIALOGUE[^:]*:\s*[\"“](.*?)[\"”]",anim_text,re.I|re.S)
        out.append({"status":"pending","error":None,"scene_number":int(m.group(1)),"title":m.group(2).strip(),"timestamp":ts.group(1).strip() if ts else "AUTO — determined by the completed Flow clip","clip_length_seconds":None,"assets":{"background_tag":bg,"character_tags":chars},"speaker":speaker,"still_image_prompt":still.group(1).strip() if still else "","animation_prompt_WITH_lipsync":anim_text,"animation_prompt_NARRATOR_ONLY":_narrator_variant(anim_text) if speaker in {"NARRATOR","none"} else _narrator_variant(anim_text),"devanagari_dialogue":dialogue.group(1).strip() if dialogue else "","narration_text":""})
    return out
