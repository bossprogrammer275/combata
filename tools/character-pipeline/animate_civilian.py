#!/usr/bin/env python3
"""Upload civilian_001 to Mixamo using the saved local browser profile."""
from __future__ import annotations
import argparse
import json
import re
import sys
import time
import zipfile
import struct
import zlib
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
    for query in job["queries"]:
        print(f"[Mixamo] Searching candidates for {job['key']}: {query}")
        try:
            animations_mod.search(page, query)
            candidates = get_animation_candidates(page.content(), query)
        except Exception as exc:
            print(f"[Mixamo] Search failed for '{query}': {exc}")
            continue
        if not candidates:
            print(f"[Mixamo] No results returned for '{query}'.")
            continue
        print("")
        print(f"--- {job['key'].upper()} CANDIDATES ({query}) ---")
        visible = candidates[:20]
        for index, candidate in enumerate(visible, start=1):
            description = candidate["description"] or "No description supplied by Mixamo"
            print(f" {index:>2}. {candidate['name']} — {description}")
        if len(candidates) > len(visible):
            print(f" Showing first {len(visible)} of {len(candidates)} results.")
        while True:
            answer = input(f"Choose 1-{len(visible)}, N=next search, S=skip, Q=stop: ").strip().lower()
            if answer in {"n", "next"}:
                break
            if answer in {"s", "skip"}:
                print(f"[Mixamo] Skipped {job['key']} by user.")
                return None
            if answer in {"q", "quit", "stop"}:
                raise KeyboardInterrupt("Animation selection cancelled by user.")
            if not answer.isdigit() or not (1 <= int(answer) <= len(visible)):
                print("[Mixamo] Invalid choice. Enter a listed number, N, S or Q.")
                continue
            chosen = visible[int(answer) - 1]
            try:
                animations_mod.search(page, chosen["query"])
                ids = {item["id"] for item in get_animation_candidates(page.content(), chosen["query"])}
                if chosen["id"] not in ids:
                    print("[Mixamo] Result no longer appears on the page; choose again.")
                    break
                animations_mod.select_animation(page, chosen["id"])
                page.wait_for_timeout(2200)
                selected = animations_mod.get_selected_animation(page.content(), page) or {}
                name = selected.get("name") or chosen["name"]
                description = selected.get("description") or chosen["description"]
                print(f"[Mixamo] PREVIEW: {name}")
                if description:
                    print(f"[Mixamo] Description: {description}")
                print("Check the animation playing in the browser before approving it.")
                approval = input("Download this exact animation? [Y]=yes, R=choose again, S=skip: ").strip().lower()
                if approval in {"", "y", "yes"}:
                    return {"id": chosen["id"], "name": name, "description": description, "query": chosen["query"]}
                if approval in {"s", "skip"}:
                    return None
                animations_mod.search(page, query)
            except Exception as exc:
                print(f"[Mixamo] Could not preview candidate '{chosen['name']}': {exc}")
                try:
                    animations_mod.search(page, query)
                except Exception:
                    pass
    print(f"[Mixamo] No approved candidate selected for {job['key']}.")
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


def _paeth(a, b, c):
    p=a+b-c
    pa,pb,pc=abs(p-a),abs(p-b),abs(p-c)
    return a if pa<=pb and pa<=pc else (b if pb<=pc else c)


def _png_character_mask(data):
    """Decode Playwright's 8-bit canvas PNG using stdlib and isolate coloured avatar pixels."""
    if not data.startswith(b"\\x89PNG\\r\\n\\x1a\\n"):
        raise RuntimeError("Mixamo canvas screenshot is not a valid PNG.")
    pos=8; width=height=depth=colour=interlace=0; parts=[]
    while pos+8<=len(data):
        size=struct.unpack(">I",data[pos:pos+4])[0]
        kind,chunk=data[pos+4:pos+8],data[pos+8:pos+8+size]
        pos+=size+12
        if kind==b"IHDR":
            width,height,depth,colour,_,_,interlace=struct.unpack(">IIBBBBB",chunk)
        elif kind==b"IDAT": parts.append(chunk)
        elif kind==b"IEND": break
    channels={0:1,2:3,4:2,6:4}.get(colour)
    if not width or not height or channels is None or depth!=8 or interlace!=0:
        raise RuntimeError(f"Unsupported Mixamo PNG ({width}x{height}, depth={depth}, colour={colour}).")
    raw=zlib.decompress(b"".join(parts)); stride=width*channels; bpp=channels
    mask=bytearray(width*height); rows=[0]*height; cols=[0]*width
    prev=bytearray(stride); cursor=0
    for y in range(height):
        ft=raw[cursor]; cursor+=1
        row=bytearray(raw[cursor:cursor+stride]); cursor+=stride
        if ft==1:
            for i in range(stride): row[i]=(row[i]+(row[i-bpp] if i>=bpp else 0))&255
        elif ft==2:
            for i in range(stride): row[i]=(row[i]+prev[i])&255
        elif ft==3:
            for i in range(stride):
                left=row[i-bpp] if i>=bpp else 0
                row[i]=(row[i]+(left+prev[i])//2)&255
        elif ft==4:
            for i in range(stride):
                left=row[i-bpp] if i>=bpp else 0
                up=prev[i]; ul=prev[i-bpp] if i>=bpp else 0
                row[i]=(row[i]+_paeth(left,up,ul))&255
        elif ft!=0: raise RuntimeError(f"Unsupported PNG row filter {ft}.")
        for x in range(width):
            i=x*bpp
            if colour==0: r=g=b=row[i]; alpha=255
            elif colour==2: r,g,b=row[i:i+3]; alpha=255
            elif colour==4: r=g=b=row[i]; alpha=row[i+1]
            else: r,g,b,alpha=row[i:i+4]
            if alpha>=80 and max(r,g,b)>=38 and max(r,g,b)-min(r,g,b)>=18:
                mask[y*width+x]=1; rows[y]+=1; cols[x]+=1
        prev=row
    ay=[i for i,n in enumerate(rows) if n>=3]
    ax=[i for i,n in enumerate(cols) if n>=3]
    if len(ax)<10 or len(ay)<10:
        raise RuntimeError(f"Character segmentation failed ({len(ax)} columns, {len(ay)} rows).")
    return width,height,mask,(ax[0],ay[0],ax[-1],ay[-1])


def _snap_to_character(mask,width,height,x,y,radius):
    best=None; best_d2=None
    for py in range(max(0,int(y)-radius),min(height-1,int(y)+radius)+1):
        base=py*width
        for px in range(max(0,int(x)-radius),min(width-1,int(x)+radius)+1):
            if mask[base+px]:
                d2=(px-x)**2+(py-y)**2
                if best_d2 is None or d2<best_d2: best,best_d2=(px,py),d2
    if best is None or best_d2**0.5>radius:
        raise RuntimeError(f"Estimated landmark ({x:.1f},{y:.1f}) is not on the character silhouette.")
    return best,best_d2**0.5


def _drag_mixamo_marker(page,marker_id,x,y):
    marker=page.locator(f".autorig-overlay .autorig-marker#{marker_id}")
    if marker.count()!=1 or not marker.is_visible():
        raise RuntimeError(f"Mixamo marker '{marker_id}' is missing or hidden.")
    box=marker.bounding_box()
    if not box: raise RuntimeError(f"Could not read marker '{marker_id}' position.")
    sx,sy=box["x"]+box["width"]/2,box["y"]+box["height"]/2
    page.mouse.move(sx,sy); page.mouse.down()
    try:
        page.mouse.move(x,y,steps=16); page.wait_for_timeout(100)
    finally: page.mouse.up()
    page.wait_for_timeout(180)
    after=marker.bounding_box()
    if not after: raise RuntimeError(f"Marker '{marker_id}' disappeared after drag.")
    ax,ay=after["x"]+after["width"]/2,after["y"]+after["height"]/2
    error=((ax-x)**2+(ay-y)**2)**0.5
    if error>16: raise RuntimeError(f"Marker '{marker_id}' did not move to target (error {error:.1f}px).")
    return {"marker":marker_id,"target":[round(x,2),round(y,2)],"actual":[round(ax,2),round(ay,2)],"error":round(error,2)}


def auto_place_mixamo_markers(page):
    """Estimate eight joints from the live canvas, drag Mixamo markers, and verify."""
    OUT.mkdir(parents=True,exist_ok=True)
    overlay=page.locator(".autorig-overlay"); canvas=page.locator(".autorig-viewer canvas")
    try: page.bring_to_front()
    except Exception: pass
    overlay.wait_for(state="visible",timeout=20_000)
    canvas.wait_for(state="visible",timeout=20_000)
    page.wait_for_timeout(900)
    ob,cb=overlay.bounding_box(),canvas.bounding_box()
    if not ob or not cb: raise RuntimeError("Mixamo overlay or canvas has no measurable bounds.")
    if abs(ob["x"]-cb["x"])>28 or abs(ob["y"]-cb["y"])>28:
        raise RuntimeError("Mixamo marker overlay and canvas are not aligned.")
    canvas_file=OUT/"mixamo_autorig_canvas.png"
    png=canvas.screenshot(path=str(canvas_file),timeout=20_000)
    iw,ih,mask,(x0,y0,x1,y1)=_png_character_mask(png)
    cw,ch=x1-x0,y1-y0; aspect=cw/max(ch,1)
    if ch<ih*0.62 or cw<iw*0.20 or not 0.30<=aspect<=1.10:
        raise RuntimeError(f"Character is too small, incomplete or side-on (silhouette {cw}x{ch}, aspect {aspect:.2f}).")
    # Front-facing preview: anatomical left is on viewer-right.
    estimates={
        "chin":(0.50,0.105),
        "rarm":(0.04,0.392),"larm":(0.96,0.392),
        "relbow":(0.16,0.300),"lelbow":(0.84,0.300),
        "rknee":(0.37,0.750),"lknee":(0.63,0.750),
        "groin":(0.50,0.515),
    }
    symmetry=page.locator('.autorig-options input[name="symmetry"]')
    if symmetry.count()!=1:
        raise RuntimeError("Could not find Mixamo's Use Symmetry checkbox; refusing ambiguous paired-marker placement.")
    if symmetry.is_checked():
        symmetry.uncheck(); page.wait_for_timeout(250)
        if symmetry.is_checked(): raise RuntimeError("Could not disable Mixamo marker symmetry.")
    radius=max(12,int(ch*0.055))
    report={"status":"placing","canvas":[iw,ih],"characterBounds":[x0,y0,x1,y1],"placements":[]}
    report_path=OUT/"mixamo_marker_placement.json"
    report_path.write_text(json.dumps(report,indent=2),encoding="utf-8")
    for marker_id,(xr,yr) in estimates.items():
        ex,ey=x0+cw*xr,y0+ch*yr
        (px,py),snap_d=_snap_to_character(mask,iw,ih,ex,ey,radius)
        tx=cb["x"]+(px+0.5)*cb["width"]/iw
        ty=cb["y"]+(py+0.5)*cb["height"]/ih
        item=_drag_mixamo_marker(page,marker_id,tx,ty)
        item["pixel"]=[px,py]; item["estimate"]=[round(ex,2),round(ey,2)]
        item["snapDistance"]=round(snap_d,2); report["placements"].append(item)
        report["lastCompletedMarker"]=marker_id
        report_path.write_text(json.dumps(report,indent=2),encoding="utf-8")
        print(f"[Mixamo] Placed {marker_id} at canvas ({px},{py}); position verified.")
    if len(report["placements"])!=8: raise RuntimeError(f"Only {len(report['placements'])}/8 markers were verified.")
    for item in report["placements"]:
        ax,ay=item["actual"]
        if not (cb["x"]-2<=ax<=cb["x"]+cb["width"]+2 and cb["y"]-2<=ay<=cb["y"]+cb["height"]+2):
            raise RuntimeError(f"Marker {item['marker']} ended outside the character canvas.")
    report["status"]="verified"
    report_path.write_text(json.dumps(report,indent=2),encoding="utf-8")
    page.screenshot(path=str(OUT/"mixamo_markers_auto_placed.png"),full_page=True)
    print("[Mixamo] All eight anatomical markers were placed and verified.")
    return report


def attach_character_status_listener(page):
    """Capture relevant Mixamo character API responses, including Auto-Rigger errors."""
    events = []

    def on_response(response):
        try:
            url = response.url
            lowered = url.lower()
            if "/api/v1/characters/" not in lowered:
                return
            if any(part in lowered for part in ("/assets/", "/thumbnail", "/preview")):
                return

            event = {
                "time": time.time(),
                "method": response.request.method.upper(),
                "httpStatus": int(response.status),
                "urlPath": url.split("?", 1)[0][-240:],
            }
            try:
                payload = response.json()
            except Exception:
                payload = None
            if isinstance(payload, dict):
                for key in ("status", "error", "message", "reason", "code", "detail"):
                    value = payload.get(key)
                    if value is not None:
                        event[key] = str(value)[:600]
                for key in ("errors", "data"):
                    value = payload.get(key)
                    if isinstance(value, (str, int, float, bool)):
                        event[key] = str(value)[:600]
                    elif isinstance(value, dict):
                        compact = {}
                        for nested_key in ("status", "error", "message", "reason", "code", "detail"):
                            nested_value = value.get(nested_key)
                            if nested_value is not None:
                                compact[nested_key] = str(nested_value)[:300]
                        if compact:
                            event[key] = compact
            events.append(event)
            if len(events) > 100:
                del events[:-100]
        except Exception:
            pass

    page.on("response", on_response)
    return events


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


def classify_upload_status(html, get_upload_status, autorig_started=False, api_status=None):
    """Distinguish upload, marker placement, and the actual Mixamo animation workspace."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")

    if soup.find(class_="autorig-overlay"):
        return {"state": "markers", "text": "Place markers"}

    if soup.find(class_="autorig-uploading"):
        status = get_upload_status(html) or {}
        return {"state": "processing", "text": status.get("text", "Uploading")}

    # Do not search the raw HTML string for 'autorig-modal': Mixamo's bundled
    # JavaScript contains that literal even when the modal is no longer open.
    # Inspect the parsed DOM instead. The latest failure screenshot showed the
    # real editor, character preview, and Download button already available.
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

    if autorig_started and api_status not in ("ready",):
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
        api_status = next((event.get("status") for event in reversed(recent_events) if event.get("status")), None)
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

        if state == "ready":
            print("[Mixamo] Character is rigged. Animation workspace and Download controls are ready.")
            return

        if state == "processing" and now - last_heartbeat >= 15:
            elapsed = int(now - (marker_submit_time or started))
            print(f"[Mixamo] Still processing ({elapsed}s elapsed).")
            last_heartbeat = now

        if marker_submit_attempted and api_status == "needs_rigging" and marker_submit_time:
            if now - marker_submit_time > 45:
                reason = "Mixamo reports that the character still needs rigging. The landmark placements were rejected."
                save_upload_diagnostics(page, reason, api_status_events)
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
                save_upload_diagnostics(page, reason, api_status_events)
                raise RuntimeError(reason + " See mixamo_upload_debug.png/html in the output folder.")
            continue

        if state == "markers":
            if marker_submit_attempted:
                recent_events = api_status_events[api_event_start:]
                api_excerpt = json.dumps(recent_events[-8:], ensure_ascii=False)
                reason = "Mixamo returned to marker placement after the landmarks were submitted. API responses: " + api_excerpt
                save_upload_diagnostics(page, reason, api_status_events)
                raise RuntimeError(reason + " See mixamo_upload_debug.png/html in the output folder.")
            marker_submit_attempted = True
            try:
                placement_report = auto_place_mixamo_markers(page)
            except Exception as exc:
                reason = f"Automated Mixamo marker placement failed: {type(exc).__name__}: {exc}"
                save_marker_diagnostics(page, reason)
                save_upload_diagnostics(page, reason, api_status_events)
                raise RuntimeError(reason) from exc
            api_event_start = len(api_status_events)
            next_button = page.locator(".autorig-modal .modal-footer button.btn-primary")
            if next_button.count() != 1 or not next_button.is_visible() or not next_button.is_enabled():
                raise RuntimeError("Eight markers were positioned, but Mixamo's Next button is not ready.")
            next_button.click()
            print(f"[Mixamo] Submitted {len(placement_report['placements'])}/8 verified landmarks to Auto-Rigger.")
            page.wait_for_timeout(1200)
            try:
                page.screenshot(path=str(OUT/"mixamo_markers_auto_submitted.png"),full_page=True)
            except Exception:
                pass
            marker_submit_time = time.time()
            page.wait_for_timeout(1500)
            continue

        if state == "error":
            reason = f"Mixamo rejected the character: {status.get('text', 'unknown error')}"
            save_upload_diagnostics(page, reason, api_status_events)
            raise RuntimeError(reason)

        page.wait_for_timeout(1000)

    final_html = page.content()
    recent_events = api_status_events[api_event_start:]
    api_status = next((event.get("status") for event in reversed(recent_events) if event.get("status")), None)
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
    save_upload_diagnostics(page, reason, api_status_events)
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
    download_mod.open_modal(page)
    download_mod.set_format(page, "fbx")
    download_mod.set_skin(page, include_skin)
    download_mod.set_fps(page, fps)
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

    # Previous auto-picked clips are not trustworthy. Remove requested stale
    # files so skipped animations cannot accidentally remain in the new bundle.
    for job in selected_animations:
        stale_clip = animation_dir / f"{job['key']}.fbx"
        if stale_clip.is_file():
            stale_clip.unlink()
            print(f"[Mixamo] Removed previous unverified clip: {stale_clip.name}")
    # Keep the previous rigged base until a replacement FBX is downloaded and verified.

    print("[Mixamo] Opening your saved local browser profile...")
    page = browser.start()
    api_status_events = attach_character_status_listener(page)
    try:
        page.goto("https://www.mixamo.com/", wait_until="domcontentloaded")
        page.wait_for_load_state("networkidle")
        print(f"[Mixamo] Uploading Y-up OBJ package {SOURCE_BUNDLE.name}...")
        upload_mod.upload_file(page, str(SOURCE_BUNDLE))
        try:
            wait_upload_complete(page, upload_mod.get_status, upload_mod.confirm_review, api_status_events)
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
                "mixamo_marker_placement.json",
                "mixamo_autorig_canvas.png",
                "mixamo_markers_auto_placed.png",
                "mixamo_markers_auto_submitted.png",
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
