#!/usr/bin/env python3
"""Upload civilian_001 to Mixamo using the saved local browser profile."""
from __future__ import annotations
import argparse
import json
import queue
import re
import sys
import threading
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIXAMO_DIR = ROOT / "tools" / "mixamo-mcp"
OUT = ROOT / "data" / "models" / "npc" / "civilian_001"
SOURCE_BUNDLE = OUT / "civilian_001_mixamo_source.zip"

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

def save_marker_diagnostics(page, reason):
    """Capture the actual marker DOM and screenshot before failing."""
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        html_path = OUT / "mixamo_marker_debug.html"
        image_path = OUT / "mixamo_marker_debug.png"
        json_path = OUT / "mixamo_marker_dom.json"
        html_path.write_text(page.content(), encoding="utf-8")
        page.screenshot(path=str(image_path), full_page=True)
        nodes = page.evaluate("""() => Array.from(document.querySelectorAll(
            '.autorig-overlay .autorig-marker, .autorig-overlay [id], #chin, #larm, #rarm, #lelbow, #relbow, #lknee, #rknee, #groin'
        )).map(el => {
            const r = el.getBoundingClientRect();
            return {
                tag: el.tagName,
                id: el.id || '',
                className: typeof el.className === 'string' ? el.className : '',
                title: el.getAttribute('title') || '',
                tooltip: el.getAttribute('data-cooltip') || '',
                rect: {x:r.x,y:r.y,width:r.width,height:r.height},
                html: el.outerHTML.slice(0, 500)
            };
        })""")
        json_path.write_text(json.dumps({"reason": reason, "nodes": nodes}, indent=2), encoding="utf-8")
        print(f"[Mixamo] Marker diagnostics saved: {html_path.name}, {image_path.name}, {json_path.name}")
        print(f"[Mixamo] Marker DOM nodes found: {len(nodes)}")
    except Exception as exc:
        print(f"[Mixamo] Could not save marker diagnostics: {exc}")


def wait_for_manual_marker_placement(page):
    """Leave Mixamo open while the user places markers, then resume on D/DONE."""
    OUT.mkdir(parents=True, exist_ok=True)

    try:
        page.bring_to_front()
    except Exception:
        pass

    # Save a starting view so the exact marker screen can be revisited.
    try:
        page.screenshot(path=str(OUT / "mixamo_markers_manual_start.png"), full_page=True)
    except Exception as exc:
        print(f"[Mixamo] Could not save starting marker screenshot: {exc}")

    print("")
    print("=" * 68)
    print("MANUAL MIXAMO MARKER PLACEMENT REQUIRED")
    print("=" * 68)
    print("The Mixamo browser is open. Place all 8 markers directly on the model:")
    print("  Chin, Left Wrist, Right Wrist, Left Elbow, Right Elbow,")
    print("  Left Knee, Right Knee and Groin.")
    print("")
    print("When finished, either:")
    print("  1. Click NEXT in the Mixamo browser, then return here; OR")
    print("  2. Return here and type D (or DONE), then press ENTER.")
    print("The script detects whether you already clicked Next.")
    print("Type Q and press ENTER to cancel.")
    print("=" * 68)

    answers = queue.Queue()

    def start_console_reader():
        def read_console_once():
            try:
                answers.put(input("[Open World] Type D when marker placement is done: "))
            except Exception as exc:
                answers.put(exc)

        reader = threading.Thread(target=read_console_once, name="mixamo-marker-console", daemon=True)
        reader.start()
        return reader

    reader = start_console_reader()
    started = time.monotonic()
    last_report = 0

    while True:
        try:
            answer = answers.get(timeout=1)
        except queue.Empty:
            elapsed = int(time.monotonic() - started)
            if elapsed - last_report >= 15:
                print(f"[Mixamo] Waiting for your marker placement... {elapsed}s elapsed.")
                last_report = elapsed
            continue

        if isinstance(answer, BaseException):
            raise RuntimeError(f"Could not read marker confirmation from console: {answer}")

        command = str(answer).strip().lower()
        if command in {"d", "done", "yes"}:
            elapsed = int(time.monotonic() - started)
            print(f"[Mixamo] Manual marker placement confirmed after {elapsed}s.")
            break
        if command in {"q", "quit", "cancel"}:
            raise RuntimeError("Manual Mixamo marker placement cancelled from console.")
        print("[Mixamo] Enter D or DONE when all eight markers are placed, or Q to cancel.")
        reader = start_console_reader()

    try:
        page.screenshot(path=str(OUT / "mixamo_markers_manual_done.png"), full_page=True)
    except Exception as exc:
        print(f"[Mixamo] Could not save completed marker screenshot: {exc}")

    # If the user did not already click Next, the automation clicks it now.
    overlay = page.locator(".autorig-overlay")
    try:
        if overlay.count() and overlay.first.is_visible():
            print("[Mixamo] Clicking Next to start Auto-Rigging...")
            page.locator(".modal-footer button.btn-primary").click()
            page.wait_for_timeout(1500)
        else:
            print("[Mixamo] Next was already clicked in the browser; continuing to rig status polling.")
    except Exception as exc:
        reason = f"Could not submit Mixamo's marker placement: {exc}"
        save_marker_diagnostics(page, reason)
        raise RuntimeError(reason)

    return True


def attach_character_status_listener(page):
    """Capture Mixamo's character status polls so we don't click through a running rig."""
    events = []

    def on_response(response):
        try:
            if response.request.method.upper() != "GET":
                return
            url = response.url.lower()
            if "/api/v1/characters/" not in url or any(part in url for part in ("/assets/", "/autorig")):
                return
            payload = response.json()
            if isinstance(payload, dict) and payload.get("status"):
                events.append({"time": time.time(), "status": str(payload["status"]).lower()})
        except Exception:
            pass

    page.on("response", on_response)
    return events


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


def classify_upload_status(html, get_upload_status, autorig_started=False, api_status=None):
    """Distinguish marker placement, active rigging, and a completed rig review."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    if soup.find(class_="autorig-overlay"):
        return {"state": "markers", "text": "Place markers"}
    if soup.find(class_="autorig-uploading"):
        status = get_upload_status(html) or {}
        return {"state": "processing", "text": status.get("text", "Uploading")}

    info = soup.find(class_="autorig-info")
    info_text = info.get_text(" ", strip=True) if info else ""
    message = norm(info_text)

    if any(phrase in message for phrase in (
        "processing upload", "your character is processing",
        "auto rigging", "auto-rigging", "rigging in progress",
        "please wait", "preparing your character",
    )):
        return {"state": "processing", "text": info_text}

    if autorig_started and api_status not in ("ready",):
        # The upstream Mixamo MCP labels every .autorig-holder as 'review'.
        # After Next, that same container is also used while the server rigs.
        if soup.find(class_="autorig-holder"):
            return {"state": "processing", "text": info_text or "Waiting for Mixamo Auto-Rigger"}
    if soup.find(class_="autorig-holder"):
        return {"state": "review", "text": info_text}
    if soup.find(string=re.compile("unable to map your existing skeleton", re.I)):
        return {"state": "error", "text": "Unable to map your existing skeleton"}
    return get_upload_status(html) or {}


def wait_upload_complete(page, get_upload_status, confirm_review, api_status_events, timeout=360):
    deadline = time.time() + timeout
    started = time.time()
    last_state = None
    last_heartbeat = started
    marker_submit_attempted = False
    marker_submit_time = None
    review_confirm_attempted = False
    review_confirmed_at = None
    change_confirm_attempted = False
    api_event_start = len(api_status_events)

    while time.time() < deadline:
        html = page.content()
        recent_events = api_status_events[api_event_start:]
        api_status = recent_events[-1]["status"] if recent_events else None
        autorig_started = marker_submit_attempted
        status = classify_upload_status(
            html, get_upload_status,
            autorig_started=autorig_started,
            api_status=api_status,
        )
        state = status.get("state")
        now = time.time()

        if state and state != last_state:
            print(f"[Mixamo] Upload state: {state} {status.get('text', '')}".strip())
            last_state = state

        if state == "processing" and now - last_heartbeat >= 15:
            elapsed = int(now - (marker_submit_time or started))
            print(f"[Mixamo] Still processing ({elapsed}s elapsed).")
            last_heartbeat = now

        if marker_submit_attempted and api_status == "needs_rigging" and marker_submit_time:
            if now - marker_submit_time > 45:
                reason = "Mixamo reports that the character still needs rigging. The landmark placements were rejected."
                save_upload_diagnostics(page, reason)
                raise RuntimeError(reason + " See mixamo_upload_debug.png/html in the output folder.")

        if state == "change_character":
            if not change_confirm_attempted:
                change_confirm_attempted = True
                print("[Mixamo] Confirming replacement of the current character...")
                confirm_review(page)
                page.wait_for_timeout(1500)
            else:
                if now - last_heartbeat >= 15:
                    print("[Mixamo] Waiting for character replacement to finish...")
                    last_heartbeat = now
                page.wait_for_timeout(1000)
            continue

        if state == "review":
            if marker_submit_attempted and api_status != "ready":
                page.wait_for_timeout(1000)
                continue
            if not review_confirm_attempted:
                review_confirm_attempted = True
                print("[Mixamo] Auto-Rigging completed. Confirming the rigged character...")
                confirm_review(page)
                review_confirmed_at = time.time()
                page.wait_for_timeout(1800)
            elif review_confirmed_at is not None and now - review_confirmed_at < 10:
                page.wait_for_timeout(1000)
            else:
                if "autorig-modal" not in page.content():
                    return
                reason = "Mixamo remained on the rig review screen 10 seconds after confirmation."
                save_upload_diagnostics(page, reason)
                raise RuntimeError(reason + " See mixamo_upload_debug.png/html in the output folder.")
            continue

        if state == "markers":
            if marker_submit_attempted:
                reason = "Mixamo returned to marker placement after the landmarks were submitted."
                save_upload_diagnostics(page, reason)
                raise RuntimeError(reason + " See mixamo_upload_debug.png/html in the output folder.")
            marker_submit_attempted = True
            wait_for_manual_marker_placement(page)
            marker_submit_attempted = True
            marker_submit_time = time.time()
            api_event_start = len(api_status_events)
            page.wait_for_timeout(1500)
            continue

        if state == "error":
            reason = f"Mixamo rejected the character: {status.get('text', 'unknown error')}"
            save_upload_diagnostics(page, reason)
            raise RuntimeError(reason)

        if "autorig-modal" not in html and ("product-nav" in html or "product-animation" in html):
            return

        page.wait_for_timeout(1000)

    final_html = page.content()
    recent_events = api_status_events[api_event_start:]
    api_status = recent_events[-1]["status"] if recent_events else None
    final_status = classify_upload_status(
        final_html, get_upload_status,
        autorig_started=marker_submit_attempted,
        api_status=api_status,
    )
    reason = (
        f"Mixamo Auto-Rigger timed out after {timeout}s. "
        f"Last state: {final_status.get('state', 'unknown')}. "
        f"Last message: {final_status.get('text', '')}. "
        f"Last API status: {api_status or 'not captured'}."
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
    global OUT, SOURCE_BUNDLE
    args = parse_args()
    OUT = (ROOT / args.output).resolve()
    SOURCE_BUNDLE = OUT / "civilian_001_mixamo_source.zip"
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

    if not SOURCE_BUNDLE.is_file():
        print(f"ERROR: Mixamo OBJ package not found: {SOURCE_BUNDLE}", file=sys.stderr)
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
    api_status_events = attach_character_status_listener(page)
    try:
        page.goto("https://www.mixamo.com/", wait_until="domcontentloaded")
        page.wait_for_load_state("networkidle")
        print("[Mixamo] Uploading Y-up OBJ package civilian_001_mixamo_source.zip...")
        upload_mod.upload_file(page, str(SOURCE_BUNDLE))
        try:
            wait_upload_complete(page, upload_mod.get_status, upload_mod.confirm_review, api_status_events)
        except Exception as exc:
            manifest_path = OUT / "manifest.json"
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"id": "civilian_001"}
                manifest["status"] = "mixamo-upload-failed"
                manifest["mixamoUploadError"] = str(exc)
                manifest["mixamoUploadDiagnostics"] = [
                    name for name in (
                        "mixamo_upload_debug.html",
                        "mixamo_upload_debug.png",
                        "mixamo_upload_debug.txt",
                        "mixamo_markers_placed.png",
                        "mixamo_marker_debug.html",
                        "mixamo_marker_debug.png",
                        "mixamo_marker_dom.json",
                    ) if (OUT / name).is_file()
                ]
                manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
            except Exception as manifest_exc:
                print(f"[Mixamo] Could not update failure manifest: {manifest_exc}")
            raise

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
