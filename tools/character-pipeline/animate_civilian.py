#!/usr/bin/env python3
"""Upload civilian_001 to Mixamo using the saved local browser profile."""
from __future__ import annotations
import argparse
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
    {"key": "look_around", "queries": ["look around", "looking around"], "need": ["look"], "exclude": ["rifle", "aim"], "inplace": False},
    {"key": "work_idle", "queries": ["working", "work"], "need": ["work"], "exclude": ["workout", "walk", "run"], "inplace": False},
    {"key": "wave", "queries": ["waving", "wave"], "need": ["wave"], "exclude": ["water"], "inplace": False},
    {"key": "sit_down", "queries": ["sitting down", "sit down"], "need": ["sit"], "exclude": ["idle", "walk"], "inplace": False},
    {"key": "stand_up", "queries": ["standing up", "stand up"], "need": ["stand"], "exclude": ["jump"], "inplace": False},
    {"key": "fear_reaction", "queries": ["scared reaction", "frightened", "fear"], "need": [], "exclude": ["dance"], "inplace": False},
    {"key": "flee_run", "queries": ["running scared", "panic run", "fear run"], "need": ["run"], "exclude": ["walk"], "inplace": True},
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

def save_upload_diagnostics(page, reason):
    """Preserve the exact Mixamo screen when Auto-Rigger does not advance."""
    OUT.mkdir(parents=True, exist_ok=True)
    html_path = OUT / "mixamo_upload_debug.html"
    image_path = OUT / "mixamo_upload_debug.png"
    note_path = OUT / "mixamo_upload_debug.txt"
    try:
        html_path.write_text(page.content(), encoding="utf-8")
        page.screenshot(path=str(image_path), full_page=True)
        note_path.write_text(reason, encoding="utf-8")
        print(f"[Mixamo] Upload diagnostics saved: {html_path.name}, {image_path.name}, {note_path.name}")
    except Exception as exc:
        print(f"[Mixamo] Could not save upload diagnostics: {exc}")


def classify_upload_status(html, get_upload_status):
    """The upstream MCP labels every .autorig-holder screen as 'review'.

    Mixamo also uses that container while its server is still processing the
    uploaded mesh. Do not click Next until that processing message disappears.
    """
    status = get_upload_status(html) or {}
    if status.get("state") == "review":
        message = norm(status.get("text", ""))
        processing_phrases = (
            "processing upload",
            "your character is processing",
            "character is processing",
            "this should take less than half a minute",
        )
        if any(phrase in message for phrase in processing_phrases):
            return {"state": "processing", "text": status.get("text", "")}
    return status


def wait_upload_complete(page, get_upload_status, confirm_review, timeout=240):
    deadline = time.time() + timeout
    started = time.time()
    last_state = None
    last_heartbeat = started
    marker_submit_attempted = False
    review_confirm_attempted = False
    change_confirm_attempted = False

    while time.time() < deadline:
        html = page.content()
        status = classify_upload_status(html, get_upload_status)
        state = status.get("state")
        now = time.time()

        if state and state != last_state:
            print(f"[Mixamo] Upload state: {state} {status.get('text', '')}".strip())
            last_state = state

        if state == "processing" and now - last_heartbeat >= 15:
            print(f"[Mixamo] Still processing ({int(now - started)}s elapsed).")
            last_heartbeat = now

        if state == "change_character":
            if not change_confirm_attempted:
                change_confirm_attempted = True
                print("[Mixamo] Confirming replacement of the current character...")
                confirm_review(page)
                page.wait_for_timeout(1500)
            elif now - last_heartbeat >= 15:
                print("[Mixamo] Waiting for character replacement to finish...")
                last_heartbeat = now
            continue

        if state == "review":
            if not review_confirm_attempted:
                review_confirm_attempted = True
                print("[Mixamo] Upload processing finished. Confirming the detected character...")
                confirm_review(page)
                page.wait_for_timeout(1800)
            else:
                reason = "Mixamo remained on the character review screen after the Next action."
                save_upload_diagnostics(page, reason)
                raise RuntimeError(reason + " See mixamo_upload_debug.png/html in the output folder.")
            continue

        if state == "markers":
            if marker_submit_attempted:
                reason = "Mixamo kept the marker-placement step open after submitting its default landmark positions."
                save_upload_diagnostics(page, reason)
                raise RuntimeError(reason + " See mixamo_upload_debug.png/html in the output folder.")
            marker_submit_attempted = True
            print("[Mixamo] Submitting Mixamo's automatically positioned body landmarks...")
            confirm_review(page)
            page.wait_for_timeout(2500)
            continue

        if state == "error":
            reason = f"Mixamo rejected the character: {status.get('text', 'unknown error')}"
            save_upload_diagnostics(page, reason)
            raise RuntimeError(reason)

        if "autorig-modal" not in html and ("product-nav" in html or "product-animation" in html):
            return

        page.wait_for_timeout(1000)

    final_html = page.content()
    final_status = classify_upload_status(final_html, get_upload_status)
    reason = (
        f"Mixamo Auto-Rigger timed out after {timeout}s. "
        f"Last state: {final_status.get('state', 'unknown')}. "
        f"Last message: {final_status.get('text', '')}"
    )
    save_upload_diagnostics(page, reason)
    raise TimeoutError(reason)

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

def download_clip(page, download_mod, animations_mod, output_path, include_skin, inplace, fps):
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
    download_mod.set_fps(page, fps)
    return download_mod.confirm(page, str(output_path))

def parse_args():
    parser = argparse.ArgumentParser(description="Rig the civilian and download selected Mixamo animation clips.")
    parser.add_argument("--animations", default="idle,walk,run,sprint,jump,crouch_idle,crouch_walk,talk,phone,sit_idle,sit_down,stand_up,look_around,work_idle,wave,hit_reaction,fear_reaction,flee_run,fall_death,get_up")
    parser.add_argument("--fps", type=int, default=30, choices=(24, 25, 30, 48, 50, 60))
    parser.add_argument("--output", default="data/models/npc/civilian_001")
    return parser.parse_args()

def main():
    global OUT, SOURCE_FBX
    args = parse_args()
    OUT = (ROOT / args.output).resolve()
    SOURCE_FBX = OUT / "civilian_001_source.fbx"
    requested = {item.strip().lower() for item in args.animations.split(",") if item.strip()}
    aliases = {
        "crouch": {"crouch_idle", "crouch_walk"},
        "death": {"fall_death"},
        "fall": {"fall_death"},
        "getup": {"get_up"},
        "sit": {"sit_idle"},
    }
    for alias, expanded in aliases.items():
        if alias in requested:
            requested.remove(alias)
            requested.update(expanded)
    available_keys = {job["key"] for job in ANIMATIONS}
    unknown = requested - available_keys
    if unknown:
        print("ERROR: unknown animation keys: " + ", ".join(sorted(unknown)), file=sys.stderr)
        print("Available keys: " + ", ".join(sorted(available_keys)), file=sys.stderr)
        return 2
    selected_animations = [job for job in ANIMATIONS if job["key"] in requested]
    if not selected_animations:
        print("ERROR: no animations selected.", file=sys.stderr)
        return 2

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
            download_clip(page, download_mod, animations_mod, base_path, True, False, args.fps)
            downloads["riggedModel"] = {"file": base_path.name, "mixamoName": base_clip["name"], "mixamoId": base_clip["id"], "includesSkin": True, "fps": args.fps}
            print("[Mixamo] Downloaded skinned T-pose base model.")
        else:
            print("[Mixamo] No T-pose motion found; idle will provide the skinned base model.")

        for job in selected_animations:
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
                saved = download_clip(page, download_mod, animations_mod, target, has_skin, job["inplace"], args.fps)
                downloads[job["key"]] = {
                    "file": str(Path(saved).relative_to(OUT)).replace("\\", "/"),
                    "mixamoName": found["name"],
                    "mixamoId": found["id"],
                    "fps": args.fps,
                    "inPlace": job["inplace"],
                    "includesSkin": has_skin
                }
                if has_skin:
                    downloads["riggedModel"] = {"file": target.name, "mixamoName": found["name"], "includesSkin": True, "fps": args.fps}
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
