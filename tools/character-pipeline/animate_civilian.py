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
CHARACTER_ID = "civilian_001"
SOURCE_BUNDLE = OUT / f"{CHARACTER_ID}_mixamo_source.zip"

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

def get_animation_candidates(html, query):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    results = []
    for card in soup.find_all(class_="product-animation"):
        image = card.select_one(".product-image img")
        name_el = card.find("p", class_="text-capitalize")
        if not image or not name_el:
            continue
        match = re.search(r"/motions/(\d+)/", image.get("src", ""))
        if not match:
            continue
        metadata = card.find("ul", class_="product-metadata")
        description = ""
        if metadata:
            item = metadata.find("li")
            if item:
                description = item.get_text(" ", strip=True).replace("Description:", "").strip()
        results.append({
            "id": match.group(1),
            "name": name_el.get_text(" ", strip=True),
            "description": description,
            "query": query,
        })
    return results


def prompt_animation_selection(page, animations_mod, job):
    """Search Mixamo from the console, let the user choose a preview, and approve one clip."""
    for search_index, query in enumerate(job["queries"], start=1):
        print("")
        print(f"[Mixamo] SEARCH {search_index}/{len(job['queries'])} for {job['key'].upper()}: {query}")
        try:
            animations_mod.search(page, query)
            candidates = get_animation_candidates(page.content(), query)
        except Exception as exc:
            print(f"[Mixamo] Search failed for '{query}': {exc}")
            continue

        if not candidates:
            print(f"[Mixamo] No results returned for '{query}'.")
            continue

        visible = candidates[:20]
        while True:
            print("")
            print(f"--- {job['key'].upper()} RESULTS: {query} ---")
            for index, candidate in enumerate(visible, start=1):
                description = candidate["description"] or "No description supplied by Mixamo"
                print(f" {index:>2}. {candidate['name']}  |  {description}")
            if len(candidates) > len(visible):
                print(f"Showing the first {len(visible)} of {len(candidates)} results.")

            answer = input(
                f"Choose 1-{len(visible)} to preview, N=next search term, "
                "S=skip this animation, Q=stop: "
            ).strip().lower()

            if answer in {"n", "next"}:
                break
            if answer in {"s", "skip"}:
                print(f"[Mixamo] Skipped {job['key']} by your choice.")
                return None
            if answer in {"q", "quit", "stop"}:
                raise KeyboardInterrupt("Animation selection cancelled by user.")
            if not answer.isdigit() or not (1 <= int(answer) <= len(visible)):
                print("[Mixamo] Enter a listed number, N, S or Q.")
                continue

            chosen = visible[int(answer) - 1]
            try:
                # Re-run the exact search before selecting so the result ID is
                # guaranteed to belong to the visible result set.
                animations_mod.search(page, query)
                current_ids = {
                    item["id"] for item in get_animation_candidates(page.content(), query)
                }
                if chosen["id"] not in current_ids:
                    print("[Mixamo] That result is no longer on the page. Choose another.")
                    continue

                animations_mod.select_animation(page, chosen["id"])
                page.wait_for_timeout(2200)
                selected = animations_mod.get_selected_animation(page.content(), page) or {}
                name = selected.get("name") or chosen["name"]
                description = selected.get("description") or chosen["description"]

                print("")
                print("=" * 68)
                print(f"[Mixamo] PREVIEW: {name}")
                print(f"[Mixamo] Search term: {query}")
                print(f"[Mixamo] Mixamo animation ID: {chosen['id']}")
                print(f"[Mixamo] Description: {description or 'No description supplied'}")
                print("The animation is now previewing on your rig in the Mixamo browser.")
                print("=" * 68)

                while True:
                    approval = input(
                        "[D] Download this exact preview  [R] Return to results  "
                        "[N] Next search term  [S] Skip  [Q] Stop: "
                    ).strip().lower()

                    if approval in {"d", "download", "y", "yes", ""}:
                        return {
                            "id": chosen["id"],
                            "name": name,
                            "description": description,
                            "query": query,
                        }
                    if approval in {"r", "retry", "back"}:
                        animations_mod.search(page, query)
                        break
                    if approval in {"n", "next"}:
                        break
                    if approval in {"s", "skip"}:
                        return None
                    if approval in {"q", "quit", "stop"}:
                        raise KeyboardInterrupt("Animation selection cancelled by user.")
                    print("Enter D, R, N, S or Q.")

                if approval in {"n", "next"}:
                    break
                # R returns to the same result list; the outer while displays it again.
                continue

            except KeyboardInterrupt:
                raise
            except Exception as exc:
                print(f"[Mixamo] Could not preview '{chosen['name']}': {exc}")
                try:
                    animations_mod.search(page, query)
                except Exception:
                    pass
                continue

    print(f"[Mixamo] No animation approved for {job['key']}.")
    return None


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
    """Wait for explicit console confirmation after the user manually submits Mixamo landmarks."""
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        page.bring_to_front()
    except Exception:
        pass
    try:
        page.screenshot(path=str(OUT / "mixamo_markers_manual_start.png"), full_page=True)
    except Exception as exc:
        print(f"[Mixamo] Could not save starting marker screenshot: {exc}")

    print("")
    print("=" * 72)
    print("MANUAL MIXAMO RIGGING - YOU CONTROL THE BROWSER")
    print("=" * 72)
    print("Place all 8 landmarks directly on the character:")
    print("  1. Chin")
    print("  2. Left wrist")
    print("  3. Right wrist")
    print("  4. Left elbow")
    print("  5. Right elbow")
    print("  6. Left knee")
    print("  7. Right knee")
    print("  8. Groin")
    print("")
    print("Then click NEXT yourself inside the Mixamo browser.")
    print("Wait until Mixamo visibly starts Auto-Rigging / Processing.")
    print("ONLY THEN return here and type Y to confirm you completed both actions.")
    print("N = I am still working in the browser. Q = cancel the pipeline.")
    print("=" * 72)

    while True:
        answer = input("[CONFIRM MANUAL MARKERS + NEXT CLICK] Y/N/Q: ").strip().lower()
        if answer in {"y", "yes"}:
            try:
                page.screenshot(path=str(OUT / "mixamo_markers_manual_done.png"), full_page=True)
            except Exception as exc:
                print(f"[Mixamo] Could not save confirmed marker screenshot: {exc}")
            print("[Mixamo] Manual marker submission confirmed. The script did not click any browser button.")
            return True
        if answer in {"n", "no", ""}:
            print("[Mixamo] No action taken. Finish in the browser and confirm Y only after clicking Next.")
            continue
        if answer in {"q", "quit", "stop"}:
            raise KeyboardInterrupt("Cancelled at manual Mixamo marker confirmation.")
        print("Enter Y only after placing all 8 markers AND clicking Next. N keeps this prompt open; Q cancels.")


def confirm_console_action(action, details=""):
    """Require a deliberate Y before the script performs a consequential Mixamo action."""
    print("")
    print("=" * 68)
    print(f"CONFIRM ACTION: {action}")
    if details:
        print(details)
    print("Nothing will happen until you type Y.")
    print("=" * 68)
    while True:
        answer = input("[Y] Confirm and continue  [Q] Cancel pipeline: ").strip().lower()
        if answer in {"y", "yes"}:
            print(f"[Mixamo] Confirmed by user: {action}")
            return True
        if answer in {"q", "quit", "stop"}:
            raise KeyboardInterrupt(f"Cancelled before action: {action}")
        print("No action taken. Enter Y to confirm or Q to cancel.")


def save_upload_diagnostics(page, reason, api_events=None):
    """Preserve the Mixamo screen, marker positions, viewer geometry and API responses."""
    OUT.mkdir(parents=True, exist_ok=True)
    html_path = OUT / "mixamo_upload_debug.html"
    image_path = OUT / "mixamo_upload_debug.png"
    note_path = OUT / "mixamo_upload_debug.txt"
    dom_path = OUT / "mixamo_upload_debug_dom.json"
    try:
        html_path.write_text(page.content(), encoding="utf-8")
        page.screenshot(path=str(image_path), full_page=True)
        note_path.write_text(reason, encoding="utf-8")
        try:
            snapshot = page.evaluate("""() => {
                const rect = (el) => {
                    if (!el) return null;
                    const r = el.getBoundingClientRect();
                    return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};
                };
                const overlay = document.querySelector(".autorig-overlay");
                const markers = overlay ? Array.from(overlay.querySelectorAll(".autorig-marker")) : [];
                const views = Array.from(document.querySelectorAll(
                    "canvas, #editor, .product-preview-holder, .autorig-overlay, .autorig-modal, .autorig-holder"
                )).map((el) => ({
                    tag: el.tagName,
                    id: el.id || "",
                    className: typeof el.className === "string" ? el.className : "",
                    rect: rect(el),
                }));
                return {
                    url: location.href,
                    title: document.title,
                    viewport: {width: innerWidth, height: innerHeight, devicePixelRatio},
                    overlay: rect(overlay),
                    markers: markers.map((el) => ({
                        id: el.id,
                        tooltip: el.getAttribute("data-cooltip") || "",
                        style: el.getAttribute("style") || "",
                        rect: rect(el),
                    })),
                    views,
                    buttons: Array.from(document.querySelectorAll(".autorig-modal button")).map((el) => ({
                        text: (el.innerText || "").trim(),
                        disabled: !!el.disabled,
                        className: el.className || "",
                    })),
                    bodyText: (document.body?.innerText || "").slice(-4000),
                };
            }""")
            dom_path.write_text(json.dumps({
                "reason": reason,
                "snapshot": snapshot,
                "apiEvents": (api_events or [])[-30:],
            }, indent=2), encoding="utf-8")
        except Exception as exc:
            dom_path.write_text(json.dumps({
                "reason": reason,
                "domCaptureError": f"{type(exc).__name__}: {exc}",
                "apiEvents": (api_events or [])[-30:],
            }, indent=2), encoding="utf-8")
        print(f"[Mixamo] Upload diagnostics saved: {html_path.name}, {image_path.name}, {note_path.name}, {dom_path.name}")
    except Exception as exc:
        print(f"[Mixamo] Could not save upload diagnostics: {exc}")


def classify_upload_status(html, get_upload_status, autorig_started=False, page=None):
    """Classify Mixamo's visible upload, marker, review, and animation-workspace screens."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    marker_overlay = soup.find(class_="autorig-overlay")
    marker_visible = bool(marker_overlay)
    if marker_overlay:
        classes = set(marker_overlay.get("class", []))
        style = (marker_overlay.get("style") or "").replace(" ", "").lower()
        marker_visible = (
            not marker_overlay.has_attr("hidden")
            and "hidden" not in classes
            and "display:none" not in style
            and "visibility:hidden" not in style
        )
    if page is not None and marker_overlay:
        try:
            marker_visible = page.locator(".autorig-overlay").first.is_visible()
        except Exception:
            pass
    if marker_visible:
        return {"state": "markers", "text": "Place markers"}

    if soup.find(class_="autorig-uploading"):
        upload_status = get_upload_status(html) or {}
        return {"state": "processing", "text": upload_status.get("text", "Uploading")}

    animation_workspace = (
        soup.find(class_="product-preview-holder") is not None
        and soup.find(id="editor") is not None
        and soup.find(class_="sidebar-header") is not None
    )
    if autorig_started and soup.find(class_="autorig-modal") is None and animation_workspace:
        return {"state": "ready", "text": "Mixamo animation workspace is ready"}

    info = soup.find(class_="autorig-info")
    info_text = info.get_text(" ", strip=True) if info else ""
    message = norm(info_text)
    if any(phrase in message for phrase in (
        "processing upload", "your character is processing",
        "auto rigging", "auto-rigging", "rigging in progress",
        "please wait", "preparing your character",
    )):
        return {"state": "processing", "text": info_text}

    if soup.find(class_="autorig-holder"):
        return {"state": "review", "text": info_text or "Auto-Rigger review"}
    if soup.find(string=re.compile("unable to map your existing skeleton", re.I)):
        return {"state": "error", "text": "Unable to map your existing skeleton"}
    return get_upload_status(html) or {}


def wait_upload_complete(page, get_upload_status, confirm_review, timeout=600):
    deadline = time.time() + timeout
    started = time.time()
    last_state = None
    last_heartbeat = started
    marker_submit_attempted = False
    marker_submit_time = None
    review_confirm_attempted = False
    review_confirmed_at = None
    change_confirm_attempted = False

    while time.time() < deadline:
        html = page.content()
        status = classify_upload_status(
            html,
            get_upload_status,
            autorig_started=marker_submit_attempted,
            page=page,
        )
        state = status.get("state")
        now = time.time()

        if state and state != last_state:
            print(f"[Mixamo] Upload state: {state} {status.get('text', '')}".strip())
            last_state = state

        if state == "ready":
            print("[Mixamo] Mixamo reports the character is in the animation workspace.")
            print("[Mixamo] The next download requires your explicit console approval.")
            return

        if state == "processing" and now - last_heartbeat >= 15:
            elapsed = int(now - (marker_submit_time or started))
            print(f"[Mixamo] Mixamo is processing ({elapsed}s elapsed). No action will be taken automatically.")
            last_heartbeat = now

        if state == "change_character":
            if not change_confirm_attempted:
                confirm_console_action(
                    "replace the character currently open in Mixamo",
                    "Mixamo says the previous character will not be saved. Confirm only if that is intended."
                )
                print("[Mixamo] Sending the user-approved replacement click.")
                confirm_review(page)
                change_confirm_attempted = True
                page.wait_for_timeout(1200)
            else:
                page.wait_for_timeout(1000)
            continue

        if state == "review":
            if not review_confirm_attempted:
                confirm_console_action(
                    "accept the rig generated by Mixamo",
                    "Inspect the rig in the browser first. Y authorizes the script to click Mixamo's review/Next button."
                )
                print("[Mixamo] Sending the user-approved rig-review click.")
                confirm_review(page)
                review_confirm_attempted = True
                review_confirmed_at = time.time()
                page.wait_for_timeout(1800)
            elif review_confirmed_at is not None and now - review_confirmed_at > 12:
                if "autorig-modal" not in page.content():
                    page.wait_for_timeout(800)
                    continue
                reason = "Mixamo remained on the rig review screen after the user-approved confirmation."
                save_upload_diagnostics(page, reason)
                raise RuntimeError(reason + " Check mixamo_upload_debug.png/html.")
            else:
                page.wait_for_timeout(1000)
            continue

        if state == "markers":
            if marker_submit_attempted:
                reason = "Mixamo is still showing marker placement after your previous confirmation. It may have rejected one or more marker positions."
                save_marker_diagnostics(page, reason)
                save_upload_diagnostics(page, reason)
                print("")
                print("[Mixamo] Mixamo is still on the marker screen. The script has not clicked anything.")
                print("[Mixamo] Correct any marker warning, click Next yourself, then confirm again here.")
                marker_submit_attempted = False
                marker_submit_time = None
            wait_for_manual_marker_placement(page)
            marker_submit_attempted = True
            marker_submit_time = time.time()
            last_state = None
            continue

        if state == "error":
            reason = f"Mixamo rejected the character: {status.get('text', 'unknown error')}"
            save_upload_diagnostics(page, reason)
            raise RuntimeError(reason)

        page.wait_for_timeout(1000)

    final_status = classify_upload_status(
        page.content(),
        get_upload_status,
        autorig_started=marker_submit_attempted,
        page=page,
    )
    reason = (
        f"Mixamo Auto-Rigger timed out after {timeout}s. "
        f"Last state: {final_status.get('state', 'unknown')}. "
        f"Last message: {final_status.get('text', '')}."
    )
    save_upload_diagnostics(page, reason)
    raise TimeoutError(reason)


def verify_fbx_download(path):
    file_path = Path(path)
    if not file_path.is_file():
        raise RuntimeError(f"Download did not create the expected file: {file_path}")
    size = file_path.stat().st_size
    if size < 1024:
        raise RuntimeError(f"Downloaded FBX is suspiciously small ({size} bytes): {file_path}")
    with file_path.open("rb") as handle:
        header = handle.read(64)
    if not (header.startswith(b"Kaydara FBX Binary") or header.lstrip().startswith(b"; FBX")):
        raise RuntimeError(f"Downloaded file does not have an FBX header ({size} bytes): {file_path}")
    print(f"[Mixamo] Verified FBX: {file_path.name} ({size:,} bytes)")
    return str(file_path)


def download_clip(page, download_mod, animations_mod, output_path, include_skin, inplace, fps,
                  configure_animation=True):
    if configure_animation:
        try:
            animations_mod.set_checkbox(page, "mirror", False)
        except Exception:
            pass
        try:
            animations_mod.set_checkbox(page, "inplace", inplace)
        except Exception:
            # Mixamo does not expose In Place on every animation; preserve its default.
            pass
    output_path = Path(output_path).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        confirm_console_action("overwrite an existing FBX file", f"Existing file: {output_path}")
    print(f"[Mixamo] Download format: FBX | FPS: {fps} | Include skin: {'yes' if include_skin else 'no'}")
    print(f"[Mixamo] Saving browser download directly to: {output_path}")
    download_mod.open_modal(page)
    download_mod.set_format(page, "fbx")
    download_mod.set_skin(page, include_skin)
    download_mod.set_fps(page, fps)
    # The Mixamo download helper listens for the real browser download and
    # saves it with Playwright Download.save_as(output_path), avoiding the
    # browser's default Downloads directory.
    saved = download_mod.confirm(page, str(output_path))
    return verify_fbx_download(saved)

def parse_args():
    parser = argparse.ArgumentParser(description="Rig the civilian and download selected Mixamo animation clips.")
    parser.add_argument("--animations", default="idle,walk,run,sprint,jump,crouch_idle,crouch_walk,talk,phone,sit_idle,sit_down,stand_up,look_around,work_idle,wave,hit_reaction,fear_reaction,flee_run,fall_death,get_up")
    parser.add_argument("--id", default="civilian_001")
    parser.add_argument("--fps", type=int, default=30, choices=(24, 25, 30, 48, 50, 60))
    parser.add_argument("--output", default=None)
    return parser.parse_args()

def main():
    global OUT, SOURCE_BUNDLE, CHARACTER_ID
    args = parse_args()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", args.id):
        print("ERROR: --id must contain only letters, numbers, underscores or hyphens.", file=sys.stderr)
        return 2
    CHARACTER_ID = args.id
    if not args.output:
        args.output = f"data/models/npc/{CHARACTER_ID}"
    OUT = (ROOT / args.output).resolve()
    SOURCE_BUNDLE = OUT / f"{CHARACTER_ID}_mixamo_source.zip"
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

    # Never delete existing character or animation files automatically.
    print("[Mixamo] Existing FBX files will be kept unless you explicitly approve an overwrite.")

    print("[Mixamo] Opening your saved local browser profile...")
    page = browser.start()
    # No browser response listener is registered; the console owns all approvals.
    try:
        page.goto("https://www.mixamo.com/", wait_until="domcontentloaded")
        page.wait_for_load_state("networkidle")
        print(f"[Mixamo] Uploading Y-up OBJ package {SOURCE_BUNDLE.name}...")
        upload_mod.upload_file(page, str(SOURCE_BUNDLE))
        try:
            wait_upload_complete(page, upload_mod.get_status, upload_mod.confirm_review)
        except Exception as exc:
            manifest_path = OUT / "manifest.json"
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"id": CHARACTER_ID}
                manifest["status"] = "mixamo-upload-failed"
                manifest["mixamoUploadError"] = str(exc)
                manifest["mixamoUploadDiagnostics"] = [
                    name for name in (
                        "mixamo_upload_debug.html",
                        "mixamo_upload_debug.png",
                        "mixamo_upload_debug.txt",
                        "mixamo_upload_debug_dom.json",
                        "mixamo_marker_debug.html",
                        "mixamo_marker_debug.png",
                        "mixamo_marker_dom.json",
                        "mixamo_markers_manual_start.png",
                        "mixamo_markers_manual_done.png",
                        "mixamo_markers_placed.png",
                        "mixamo_marker_debug.html",
                        "mixamo_marker_debug.png",
                        "mixamo_marker_dom.json",
                        "mixamo_markers_manual_start.png",
                        "mixamo_markers_manual_done.png",
                    ) if (OUT / name).is_file()
                ]
                manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
            except Exception as manifest_exc:
                print(f"[Mixamo] Could not update failure manifest: {manifest_exc}")
            raise

        manifest_path = OUT / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"id": CHARACTER_ID}
        manifest["status"] = "animation-generation-in-progress"
        manifest["animations"] = {}
        manifest["animationSelections"] = {}
        manifest["animationErrors"] = []
        manifest.pop("mixamoUploadError", None)
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

        # Export the newly rigged character without selecting any animation.
        base_path = OUT / f"{CHARACTER_ID}_rigged.fbx"
        confirm_console_action(
            "download the unanimated rigged base character",
            f"Mixamo will export the skinned rigged model to: {base_path}"
        )
        print("[Mixamo] Downloading the unanimated rigged character with skin...")
        try:
            saved_base = download_clip(
                page, download_mod, animations_mod, base_path, True, False, args.fps,
                configure_animation=False,
            )
            downloads["riggedModel"] = {
                "file": Path(saved_base).name,
                "includesSkin": True,
                "fps": args.fps,
                "unanimated": True,
            }
            print("[Mixamo] Unanimated rigged character downloaded and verified.")
        except Exception as exc:
            errors.append(f"riggedModel: base character download failed: {exc}")
            print(f"[Mixamo] FATAL: could not download the rigged character: {exc}")
            raise

        selections = {}
        for job in selected_animations:
            found = prompt_animation_selection(page, animations_mod, job)
            if not found:
                errors.append(f"{job['key']}: no animation approved by user")
                continue
            target = animation_dir / f"{job['key']}.fbx"
            try:
                saved = download_clip(
                    page, download_mod, animations_mod, target, False,
                    job["inplace"], args.fps, configure_animation=True,
                )
                relative_file = str(Path(saved).relative_to(OUT)).replace("\\", "/")
                downloads[job["key"]] = {
                    "file": relative_file,
                    "mixamoName": found["name"],
                    "mixamoDescription": found["description"],
                    "mixamoId": found["id"],
                    "searchQuery": found["query"],
                    "fps": args.fps,
                    "inPlaceRequested": job["inplace"],
                    "includesSkin": False,
                }
                selections[job["key"]] = {
                    "id": found["id"],
                    "name": found["name"],
                    "description": found["description"],
                    "query": found["query"],
                }
                print(f"[Mixamo] Downloaded and verified {job['key']}: {found['name']}")
            except Exception as exc:
                errors.append(f"{job['key']}: download failed: {exc}")
                print(f"[Mixamo] ERROR {job['key']}: {exc}")

            # Persist each approved/verified selection immediately so a later
            # interrupted run does not lose the exact animation IDs already used.
            progress_manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"id": CHARACTER_ID}
            progress_manifest["riggedModel"] = downloads.get("riggedModel", {}).get("file")
            progress_manifest["animations"] = downloads
            progress_manifest["animationSelections"] = selections
            progress_manifest["animationErrors"] = errors
            progress_manifest["status"] = "animation-generation-in-progress"
            manifest_path.write_text(json.dumps(progress_manifest, indent=2), encoding="utf-8")

        manifest_path = OUT / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"id": CHARACTER_ID}
        manifest["riggedModel"] = downloads.get("riggedModel", {}).get("file")
        manifest["skeleton"] = "Mixamo auto-rig; riggedModel is the canonical skinned FBX"
        manifest["animations"] = downloads
        manifest["animationSelections"] = selections
        manifest["animationErrors"] = errors
        completed = len([key for key in downloads if key != "riggedModel"])
        manifest["status"] = "ready-for-game-integration" if completed >= 8 and manifest["riggedModel"] else "partial-animation-set"
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

        zip_path = OUT / f"{CHARACTER_ID}_bundle.zip"
        confirm_console_action(
            "create/update the character asset bundle",
            f"Bundle destination: {zip_path}"
        )
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
    except KeyboardInterrupt:
        print("[Mixamo] Pipeline cancelled from the console.")
        return 130
    finally:
        browser.stop()

if __name__ == "__main__":
    raise SystemExit(main())
