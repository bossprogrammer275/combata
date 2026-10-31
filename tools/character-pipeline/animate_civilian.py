#!/usr/bin/env python3
"""Upload civilian_001 to Mixamo using the saved local browser profile."""
from __future__ import annotations
import json
import re
import sys
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIXAMO_DIR = ROOT / "tools" / "mixamo-mcp"
OUT = ROOT / "data" / "models" / "npc" / "civilian_001"
SOURCE_FBX = OUT / "civilian_001_source.fbx"

ANIMATIONS = [
    {"key": "idle", "queries": ["standing idle", "idle"], "need": ["idle"], "exclude": ["crouch", "sitting", "walk", "run"], "inplace": False},
    {"key": "walk", "queries": ["walking", "walk"], "need": ["walk"], "exclude": ["crouch", "backward", "sneak", "run"], "inplace": True},
    {"key": "run", "queries": ["running", "run"], "need": ["run"], "exclude": ["walk", "crouch", "backward"], "inplace": True},
    {"key": "sprint", "queries": ["sprinting", "sprint"], "need": ["sprint"], "exclude": ["walk", "crouch"], "inplace": True},
    {"key": "jump", "queries": ["jump"], "need": ["jump"], "exclude": [], "inplace": False},
    {"key": "crouch_idle", "queries": ["crouch idle", "crouching"], "need": ["crouch"], "exclude": ["walk", "run"], "inplace": False},
    {"key": "crouch_walk", "queries": ["crouch walk", "crouching walk"], "need": ["crouch", "walk"], "exclude": ["run"], "inplace": True},
    {"key": "talk", "queries": ["talking", "talk"], "need": ["talk"], "exclude": ["phone"], "inplace": False},
    {"key": "phone", "queries": ["phone call", "phone"], "need": ["phone"], "exclude": [], "inplace": False},
    {"key": "sit_idle", "queries": ["sitting idle", "sit idle"], "need": ["sit"], "exclude": ["stand", "walk"], "inplace": False},
    {"key": "hit_reaction", "queries": ["hit reaction", "hit"], "need": ["hit"], "exclude": ["golf", "baseball"], "inplace": False},
    {"key": "fall_death", "queries": ["falling death", "death", "dying"], "need": ["death"], "exclude": ["dance"], "inplace": False},
    {"key": "get_up", "queries": ["getting up", "stand up"], "need": ["up"], "exclude": ["jump"], "inplace": False},
]

def norm(value):
    return re.sub(r"[^a-z0-9]+", " ", str(value).lower()).strip()

def pick_animation(items, job):
    candidates = []
    for item in items:
        name = norm(item.get("name", ""))
        if not name or any(term in name for term in job["exclude"]):
            continue
        if not all(term in name for term in job["need"]):
            continue
        score = sum(20 for term in norm(job["queries"][0]).split() if term in name)
        candidates.append((score, item))
    candidates.sort(key=lambda entry: (-entry[0], entry[1]["name"].lower()))
    return candidates[0][1] if candidates else None

def wait_upload_complete(page, get_upload_status, confirm_review, timeout=240):
    deadline = time.time() + timeout
    last_state = None
    while time.time() < deadline:
        html = page.content()
        status = get_upload_status(html) or {}
        state = status.get("state")
        if state and state != last_state:
            print(f"[Mixamo] Upload state: {state} {status.get('text', '')}".strip())
            last_state = state
        if state in ("review", "change_character"):
            confirm_review(page)
            page.wait_for_timeout(1800)
            continue
        if state == "markers":
            raise RuntimeError("Mixamo requires marker placement. This MCP does not automate marker placement; the browser is left open for inspection.")
        if state == "error":
            raise RuntimeError(f"Mixamo rejected the character: {status.get('text', 'unknown error')}")
        if "autorig-modal" not in html and ("product-nav" in html or "product-animation" in html):
            return
        page.wait_for_timeout(1000)
    raise TimeoutError("Mixamo Auto-Rigger did not finish within 4 minutes.")

def search_and_select(page, animations_mod, job):
    for query in job["queries"]:
        print(f"[Mixamo] Searching: {query}")
        try:
            animations_mod.search(page, query)
            items = animations_mod.get_animation_list(page.content())["items"]
        except Exception as exc:
            print(f"[Mixamo] Search failed for '{query}': {exc}")
            continue
        found = pick_animation(items, job)
        if found:
            animations_mod.select_animation(page, found["id"])
            page.wait_for_timeout(2200)
            return found
    return None

def download_clip(page, download_mod, animations_mod, output_path, include_skin, inplace):
    try:
        animations_mod.set_checkbox(page, "mirror", False)
    except Exception:
        pass
    try:
        animations_mod.set_checkbox(page, "inplace", inplace)
    except Exception as exc:
        print(f"[Mixamo] Note: In Place setting unavailable: {exc}")
    download_mod.open_modal(page)
    download_mod.set_format(page, "fbx")
    download_mod.set_skin(page, include_skin)
    download_mod.set_fps(page, 30)
    return download_mod.confirm(page, str(output_path))

def main():
    if not SOURCE_FBX.is_file():
        print(f"ERROR: MakeHuman FBX not found: {SOURCE_FBX}", file=sys.stderr)
        return 2
    if not MIXAMO_DIR.is_dir():
        print(f"ERROR: Mixamo MCP directory not found: {MIXAMO_DIR}", file=sys.stderr)
        return 2

    sys.path.insert(0, str(MIXAMO_DIR))
    try:
        import browser
        from screens import animations as animations_mod
        from screens import download as download_mod
        from screens import upload as upload_mod
    except Exception as exc:
        print(f"ERROR: Mixamo MCP imports failed: {exc}", file=sys.stderr)
        return 2

    OUT.mkdir(parents=True, exist_ok=True)
    animation_dir = OUT / "animations"
    animation_dir.mkdir(parents=True, exist_ok=True)
    downloads = {}
    errors = []

    print("[Mixamo] Opening your saved local browser profile...")
    page = browser.start()
    try:
        page.goto("https://www.mixamo.com/", wait_until="domcontentloaded")
        page.wait_for_load_state("networkidle")
        print("[Mixamo] Uploading civilian_001_source.fbx...")
        upload_mod.upload_file(page, str(SOURCE_FBX))
        wait_upload_complete(page, upload_mod.get_status, upload_mod.confirm_review)

        base_job = {"queries": ["t pose", "t-pose"], "need": ["pose"], "exclude": []}
        base_clip = search_and_select(page, animations_mod, base_job)
        if base_clip:
            base_path = OUT / "civilian_001_rigged.fbx"
            download_clip(page, download_mod, animations_mod, base_path, True, False)
            downloads["riggedModel"] = {"file": base_path.name, "mixamoName": base_clip["name"], "mixamoId": base_clip["id"], "includesSkin": True, "fps": 30}
            print("[Mixamo] Downloaded skinned T-pose base model.")
        else:
            print("[Mixamo] No T-pose motion found; idle will provide the skinned base model.")

        for job in ANIMATIONS:
            found = search_and_select(page, animations_mod, job)
            if not found:
                errors.append(f"{job['key']}: no matching Mixamo animation in current search results")
                print(f"[Mixamo] WARNING: no match for {job['key']}")
                continue
            target = animation_dir / f"{job['key']}.fbx"
            has_skin = False
            if job["key"] == "idle" and "riggedModel" not in downloads:
                target = OUT / "civilian_001_rigged.fbx"
                has_skin = True
            try:
                saved = download_clip(page, download_mod, animations_mod, target, has_skin, job["inplace"])
                downloads[job["key"]] = {
                    "file": str(Path(saved).relative_to(OUT)).replace("\\", "/"),
                    "mixamoName": found["name"],
                    "mixamoId": found["id"],
                    "fps": 30,
                    "inPlace": job["inplace"],
                    "includesSkin": has_skin
                }
                if has_skin:
                    downloads["riggedModel"] = {"file": target.name, "mixamoName": found["name"], "includesSkin": True, "fps": 30}
                print(f"[Mixamo] Downloaded {job['key']}: {found['name']}")
            except Exception as exc:
                errors.append(f"{job['key']}: download failed: {exc}")
                print(f"[Mixamo] ERROR {job['key']}: {exc}")

        manifest_path = OUT / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"id": "civilian_001"}
        manifest["riggedModel"] = downloads.get("riggedModel", {}).get("file")
        manifest["skeleton"] = "Mixamo auto-rig; riggedModel is the canonical skinned FBX"
        manifest["animations"] = downloads
        manifest["animationErrors"] = errors
        completed = len([key for key in downloads if key != "riggedModel"])
        manifest["status"] = "ready-for-game-integration" if completed >= 8 and manifest["riggedModel"] else "partial-animation-set"
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

        zip_path = OUT / "civilian_001_bundle.zip"
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for item in sorted(OUT.rglob("*")):
                if item.is_file() and item != zip_path:
                    archive.write(item, item.relative_to(OUT.parent))
        print(f"[Mixamo] Finished clips: {completed}")
        if errors:
            print("[Mixamo] Missing/failed clips:")
            for error in errors:
                print(f"  - {error}")
        print(f"[Mixamo] Bundle: {zip_path}")
        return 0 if completed >= 8 and manifest["riggedModel"] else 1
    finally:
        browser.stop()

if __name__ == "__main__":
    raise SystemExit(main())
