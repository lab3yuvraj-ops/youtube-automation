"""Update one generated asset's resumable state after verifying it in Flow."""
from __future__ import annotations

import argparse
from pathlib import Path

from .models import load, save, utc_now


def mark(path: Path, section: str, key: str, status: str, error: str | None = None) -> None:
    project = load(path)
    field = "scene_number" if section == "scenes" else "tag"
    target = int(key) if section == "scenes" else key
    matches = [item for item in project[section] if item[field] == target]
    if len(matches) != 1:
        raise ValueError(f"Expected one {section} entry for {key}, found {len(matches)}")
    item = matches[0]
    item.update(status=status, error=error if status == "failed" else None, updated_at=utc_now())
    project.setdefault("run_log", []).append({"at": utc_now(), "event": "asset_status", "section": section, "key": key, "status": status, "error": item["error"]})
    save(path, project)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("project", type=Path)
    ap.add_argument("section", choices=["characters", "backgrounds", "scenes"])
    ap.add_argument("key")
    ap.add_argument("status", choices=["pending", "done", "failed"])
    ap.add_argument("--error")
    args = ap.parse_args()
    mark(args.project, args.section, args.key, args.status, args.error)
