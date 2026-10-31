#!/usr/bin/env python3
"""Generate civilian_001 using the local headless MakeHuman core."""
from __future__ import annotations
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "models" / "npc" / "civilian_001"

def norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value).lower()).strip()

def choose(paths: list[str], terms: list[str], reject: list[str] | None = None) -> str | None:
    reject = reject or []
    ranked = []
    for raw in paths:
        name = norm(Path(raw).as_posix())
        if any(term in name for term in reject):
            continue
        score = sum((len(term.split()) + 1) * 10 for term in terms if term in name)
        if score:
            ranked.append((score, raw))
    ranked.sort(key=lambda item: (-item[0], norm(Path(item[1]).name)))
    return ranked[0][1] if ranked else None

def gender_candidates(paths: list[str], gender: str) -> list[str]:
    """Prefer matching gender-specific assets and never cross-select the opposite gender."""
    opposite = "female" if gender == "male" else "male"
    matching = []
    neutral = []
    for raw in paths:
        tokens = set(norm(Path(raw).as_posix()).split())
        if opposite in tokens:
            continue
        if gender in tokens:
            matching.append(raw)
        else:
            neutral.append(raw)
    return matching or neutral or [raw for raw in paths if opposite not in set(norm(Path(raw).as_posix()).split())]

def copy_material_textures(material_path: str, texture_dir: Path) -> list[str]:
    import shutil
    source = Path(material_path)
    copied = []
    try:
        content = source.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return copied
    texture_dir.mkdir(parents=True, exist_ok=True)
    for line in content.splitlines():
        bits = line.strip().split(None, 1)
        if len(bits) != 2:
            continue
        key, value = bits
        if "texture" not in key.lower() and "map" not in key.lower():
            continue
        rel = value.strip().strip('"')
        if not rel or rel.startswith(("http://", "https://")):
            continue
        candidates = [(source.parent / rel).resolve(), (source.parent / Path(rel).name).resolve()]
        src = next((p for p in candidates if p.is_file()), None)
        if src is None:
            continue
        dst = texture_dir / src.name
        if not dst.exists():
            shutil.copy2(src, dst)
        copied.append(str(dst.relative_to(OUT)).replace("\\", "/"))
    return sorted(set(copied))

def parse_args():
    parser = argparse.ArgumentParser(description="Generate the Open World civilian with MakeHuman.")
    parser.add_argument("--id", default="civilian_001")
    parser.add_argument("--display-name", default="Ilorin Civilian 001")
    parser.add_argument("--age", type=float, default=21)
    parser.add_argument("--gender", choices=("male", "female"), default="male")
    parser.add_argument("--weight", type=float, default=0.54)
    parser.add_argument("--muscle", type=float, default=0.62)
    parser.add_argument("--height", type=float, default=0.60)
    parser.add_argument("--skin", default="african,dark,brown,black,deep")
    parser.add_argument("--hair", default="short,fade,buzz,afro")
    parser.add_argument("--top", default="t shirt,tshirt,tee,polo,hoodie,casual shirt,shirt")
    parser.add_argument("--bottom", default="jeans,trousers,pants,denim")
    parser.add_argument("--shoes", default="sneaker,trainers,shoes,footwear")
    parser.add_argument("--output", default="data/models/npc/civilian_001")
    return parser.parse_args()

def terms(value: str) -> list[str]:
    return [item.strip().lower() for item in value.split(",") if item.strip()]

def main() -> int:
    global OUT
    args = parse_args()
    OUT = (ROOT / args.output).resolve()
    try:
        import mhcore
    except Exception as exc:
        print(f"ERROR: MakeHuman core import failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        print("Run this through tools/character-pipeline/run-civilian.ps1.", file=sys.stderr)
        return 2

    OUT.mkdir(parents=True, exist_ok=True)
    texture_dir = OUT / "textures"
    texture_dir.mkdir(parents=True, exist_ok=True)
    print("[MakeHuman] Creating civilian_001...")
    human = mhcore.new_human()

    # MakeHuman maps age 10 to ~0.1875 and age 25 to 0.5.
    age = max(10.0, min(90.0, args.age))
    if age <= 25.0:
        age_macro = 0.1875 + (age - 10.0) * (0.5 - 0.1875) / 15.0
    else:
        age_macro = 0.5 + (age - 25.0) * 0.5 / 65.0
    human.set_gender(1.0 if args.gender == "male" else 0.0)
    human.set_age(max(0.0, min(1.0, age_macro)))
    human.set_weight(max(0.0, min(1.0, args.weight)))
    human.set_muscle(max(0.0, min(1.0, args.muscle)))
    human.set_height(max(0.0, min(1.0, args.height)))

    selected = {}
    available = {}
    for kind in ("skins", "hair", "eyes", "eyebrows", "eyelashes", "teeth", "clothes"):
        try:
            available[kind] = list(human.list_available(kind))
        except Exception as exc:
            available[kind] = []
            print(f"[MakeHuman] Warning: could not list {kind}: {exc}")

    skin_terms = terms(args.skin)
    gender_skins = gender_candidates(available["skins"], args.gender)
    skin = choose(gender_skins, skin_terms + [args.gender]) if skin_terms else None
    if skin is None and gender_skins:
        skin = choose(gender_skins, ["african", args.gender], ["old", "elder", "fantasy"])
    if skin:
        human.set_skin(skin)
        selected["skin"] = skin
        print(f"[MakeHuman] Skin: {Path(skin).name}")
    else:
        selected["skin"] = None
        print("[MakeHuman] WARNING: no skin materials found; using default material.")

    hair_terms = terms(args.hair)
    hair = choose(available["hair"], hair_terms, ["long", "ponytail", "female"]) if hair_terms else None
    if hair:
        human.equip_hair(hair)
        selected["hair"] = hair
        print(f"[MakeHuman] Hair: {Path(hair).name}")
    else:
        selected["hair"] = None
        print("[MakeHuman] WARNING: no short-hair asset matched; default hair retained.")

    for kind, method in (("eyes", "equip_eyes"), ("eyebrows", "equip_eyebrows"),
                         ("eyelashes", "equip_eyelashes"), ("teeth", "equip_teeth")):
        if available[kind]:
            try:
                getattr(human, method)(available[kind][0])
                selected[kind] = available[kind][0]
            except Exception as exc:
                print(f"[MakeHuman] Warning: {kind} not equipped: {exc}")

    clothes = available["clothes"]
    gender_clothes = gender_candidates(clothes, args.gender)
    shoe_assets = [
        path for path in gender_clothes
        if any(term in norm(Path(path).name) for term in ("shoe", "sneaker", "trainer", "footwear"))
    ]
    shoes = choose(shoe_assets, terms(args.shoes) + ["shoe", "shoes"]) if shoe_assets else None

    # This MakeHuman install provides complete casual-suit proxies rather than
    # separate T-shirt and jeans pieces. Equip one gender-matched outfit plus
    # a separate neutral shoe proxy; never substitute a female outfit.
    outfit_assets = [path for path in gender_clothes if path not in shoe_assets]
    outfit = choose(
        outfit_assets,
        terms(args.top) + terms(args.bottom) + ["casual", args.gender],
        ["dress", "bikini", "armor", "fantasy", "uniform"]
    )
    if outfit is None and outfit_assets:
        outfit = choose(outfit_assets, [args.gender], ["dress", "bikini", "armor", "fantasy", "uniform"])

    if outfit:
        try:
            human.equip_clothes(outfit)
            selected["outfit"] = outfit
            print(f"[MakeHuman] Outfit: {Path(outfit).name}")
        except Exception as exc:
            print(f"[MakeHuman] WARNING: outfit could not be equipped: {exc}")
    else:
        print(f"[MakeHuman] WARNING: no {args.gender}-compatible outfit found.")

    if shoes:
        try:
            human.equip_clothes(shoes)
            selected["shoes"] = shoes
            print(f"[MakeHuman] Shoes: {Path(shoes).name}")
        except Exception as exc:
            print(f"[MakeHuman] Warning: shoes could not be equipped: {exc}")
    else:
        print("[MakeHuman] WARNING: no shoe proxy matched; default footwear retained.")

    native_path = OUT / "civilian_001.mhm"
    fbx_path = OUT / "civilian_001_source.fbx"
    saved = human.save_mhm(str(native_path))
    # Mixamo Auto-Rigger expects a clean mesh without an incompatible pre-bound armature.
    # It creates the game skeleton itself during the upload stage.
    exported = human.export(str(fbx_path), format="fbx", rig="none", feet_on_ground=True)

    copied_textures = []
    if selected.get("skin"):
        copied_textures.extend(copy_material_textures(selected["skin"], texture_dir))

    manifest = {
        "id": args.id,
        "displayName": args.display_name,
        "description": f"Nigerian {args.gender} civilian, age {age:g}, everyday casual streetwear.",
        "ageTarget": age,
        "body": {"gender": args.gender, "weight": args.weight, "muscle": args.muscle, "heightMacro": args.height},
        "source": "MakeHuman core",
        "skeleton": "Unrigged MakeHuman mesh; submitted to Mixamo Auto-Rigger",
        "sourceModel": str(Path(exported).resolve().relative_to(ROOT)).replace("\\", "/"),
        "nativeProject": str(Path(saved).resolve().relative_to(ROOT)).replace("\\", "/"),
        "selectedAssets": selected,
        "availableAssetCounts": {key: len(value) for key, value in available.items()},
        "availableClothing": [str(Path(p)) for p in clothes],
        "wardrobeNote": "The installed MakeHuman asset pack supplies complete casual-suit proxies, not separate T-shirt and jeans pieces.",
        "copiedTextures": copied_textures,
        "animations": {},
        "status": "character-generated-awaiting-mixamo"
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"[MakeHuman] Vertices: {human.vertex_count:,}")
    print(f"[MakeHuman] Exported: {exported}")
    print(f"[MakeHuman] Manifest: {OUT / 'manifest.json'}")
    print("[MakeHuman] CHARACTER GENERATION COMPLETE")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
