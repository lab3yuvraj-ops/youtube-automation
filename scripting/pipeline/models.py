from __future__ import annotations
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
import json
from typing import Any

STATUS = {"pending", "done", "failed"}

def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _item(status: str = "pending", **kwargs: Any) -> dict[str, Any]:
    if status not in STATUS: raise ValueError(f"invalid status: {status}")
    return {"status": status, "error": None, "updated_at": utc_now(), **kwargs}

def new_project(project_id: str, method: str, input_value: str, ideas_count: int) -> dict[str, Any]:
    return {
        "schema_version": "1.0.0", "project_id": project_id, "created_at": utc_now(), "updated_at": utc_now(),
        "input": {"method": method, "value": input_value, "ideas_count": ideas_count},
        "idea": {"status": "pending", "items": [], "selected_index": None, "selected": None, "raw_output": None},
        "script": {"status": "pending", "language": None, "duration_minutes": None, "word_count": None, "monster": None, "raw_text": None, "raw_output": None},
        "characters": [], "backgrounds": [], "scenes": [], "publishing": {"status": "pending", "data": None, "raw_output": None},
        "run_log": []
    }

def load(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))

def save(path: str | Path, project: dict[str, Any]) -> None:
    project["updated_at"] = utc_now()
    p = Path(path); p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(p)

def log(project: dict[str, Any], event: str, **data: Any) -> None:
    project["run_log"].append({"at": utc_now(), "event": event, **data})
