# Map Building Guide — Strike Command

This guide shows you how to build your own maps. You can use the **Map Editor** (visual tool) or edit the **JSON file** directly.

---

## Quick Start

1. Open `map-editor.html` in your browser (run `node server.js` first)
2. Click **New** to start a fresh map
3. Use the left toolbar to pick tools (roads, buildings, props, etc.)
4. Click on the map to place things
5. Use the right panel to edit properties of selected objects
6. Click **Save** when done

---

## The Map File (new-map.json)

Every map is a JSON file in `data/worlds/`. Here's the basic structure:

```json
{
  "id": "my-map",
  "name": "My Cool Map",
  "version": 1,
  "bounds": 900,
  "startPoint": { "x": 0, "z": 70, "yaw": 3.14 },
  "ground": { "size": 2600, "color": "0x4a3a2a" },
  "roads": [],
  "buildings": [],
  "props": [],
  "landmarks": [],
  "vehicles": [],
  "trees": [],
  "spawns": [],
  "cover": [],
  "loot": [],
  "transit": [],
  "named": [],
  "reactives": [],
  "pads": []
}
```

### Top-Level Fields

| Field | What it does | Example |
|-------|-------------|---------|
| `id` | Map filename (no .json) | `"my-map"` |
| `name` | Display name | `"My City"` |
| `version` | Version number | `1` |
| `bounds` | City boundary size in meters | `900` |
| `startPoint` | Where player spawns | `{ "x": 0, "z": 70, "yaw": 3.14 }` |
| `ground` | Ground plane settings | `{ "size": 2600, "color": "0x4a3a2a" }` |

---

## Roads

Roads are drawn as a series of points. The game connects them with smooth curves.

```json
{
  "w": 14,
  "sidewalk": true,
  "smooth": true,
  "points": [[260, -650], [255, -450], [250, -250]]
}
```

| Field | What it does | Values |
|-------|-------------|--------|
| `w` | Road width in meters | `8` to `40` |
| `sidewalk` | Add sidewalks on sides | `true` / `false` |
| `smooth` | Smooth curve between points | `true` / `false` |
| `points` | Array of `[x, z]` coordinates | `[[x1, z1], [x2, z2], ...]` |

**Tips:**
- Draw roads first — buildings should be near roads
- Keep road width at `12`-`16` for normal streets, `20`+ for highways
- Use `smooth: true` for nice curved roads

---

## Buildings

Buildings are the main structures on your map.

```json
{
  "kind": "shop",
  "x": 100,
  "z": 200,
  "w": 12,
  "d": 10,
  "h": 4,
  "ry": 0,
  "m": "brick",
  "roofM": "roof",
  "name": "My Shop",
  "solid": true,
  "windows": true,
  "enterable": false,
  "roof": false,
  "roofAccess": false,
  "doorW": 2.4
}
```

### Building Fields

| Field | What it does | Default |
|-------|-------------|---------|
| `kind` | Building type (see list below) | `"box"` |
| `x`, `z` | Position on the map | required |
| `w`, `d` | Width and depth in meters | `12` |
| `h` | Height in meters | `4` |
| `ry` | Rotation in radians | `0` |
| `m` | Wall material | `"concrete"` |
| `roofM` | Roof material | `"roof"` |
| `name` | Building name (shows on map) | `""` |
| `solid` | Has collision (can't walk through) | `true` |
| `windows` | Show window textures | `true` |
| `enterable` | Can player go inside | `false` |
| `roof` | Has roof slab | `false` |
| `roofAccess` | Can climb to roof | `false` |
| `doorW` | Door width | `2.4` |

### Building Types (kind)

**Simple:**
- `box` — Plain block building
- `tower` — Multi-floor tower
- `shell` — U-shaped shell with opening
- `container` — Enterable container (drops loot)

**Houses:**
- `house` — Residential house with gable roof
- `housedetailed` — House with balcony, shutters, porch
- `townhouse` — Narrow townhouse
- `rowhouse` — Attached row houses
- `lcorner` — L-shaped corner building
- `luxuryvilla` — Big villa with pool & garden

**Shops & Retail:**
- `shop` — Store with glass display & awning
- `store` — Retail store with signage
- `supermarket` — Large retail building
- `mall` — Shopping mall

**Residential:**
- `apartment` — Multi-story block with balconies
- `motel` — Two-story motel with corridor

**Tall:**
- `highrise` — Tall highrise tower
- `penthousetower` — Luxury tower with helipad
- `artdeco` — Art Deco style hotel

**Services:**
- `hospital` — Hospital building
- `bank` — Bank with columns
- `policestation` — Police station
- `firestation` — Fire station
- `school` — School building
- `warehouse` — Industrial warehouse

**Entertainment:**
- `nightclub` — Nightclub / club
- `stadium` — Sports stadium
- `mosque` — Mosque

**Transport:**
- `gasstation` — Fuel station
- `modernpetrol` — Modern fuel station
- `parking` — Parking garage
- `trainstation` — Train station
- `transitstation` — Transit hub
- `marinapier` — Waterfront marina
- `airporthangar` — Airplane hangar

### Materials (m)

- `concrete` — Gray concrete
- `brick` — Red/brown brick
- `wood` — Wooden walls
- `metal` — Metal siding
- `panel` — Panel walls
- `crate` — Crate texture

---

## Pads

Pads are flat ground surfaces (plazas, parking lots, etc.)

```json
{
  "x": 100,
  "z": 200,
  "w": 30,
  "d": 20,
  "ry": 0,
  "m": "plaza"
}
```

| Field | What it does |
|-------|-------------|
| `x`, `z` | Position |
| `w`, `d` | Width and depth |
| `ry` | Rotation |
| `m` | Material (`"plaza"`, `"walk"`, `"road"`) |

---

## Props

Props are small objects placed around the map.

```json
{
  "kind": "barrel",
  "x": 100,
  "z": 200,
  "ry": 0.5,
  "m": "barrel",
  "react": "fire"
}
```

### Prop Types (kind)

**Street:**
- `bench` — Park bench
- `lamp` — Street lamp (light pole)
- `hydrant` — Fire hydrant
- `trashcan` — Trash can
- `mailbox` — Mailbox
- `busstop` — Bus stop shelter
- `trafficlight` — Traffic light
- `pole` — Utility pole
- `planter` — Planter box
- `bollard` — Short protective post
- `billboard` — Billboard

**Cargo:**
- `crate` — Wooden crate
- `woodcrate` — Wood shipping crate
- `crates` — Stack of crates
- `box` — Generic box
- `barrel` — Fuel barrel (can explode)
- `barrels` — Cluster of barrels
- `stairs` — Metal stairs

**Outdoor:**
- `dumpster` — Metal dumpster
- `umbrella` — Patio umbrella
- `cafetable` — Cafe table
- `wreck` — Destroyed vehicle

### Prop Fields

| Field | What it does |
|-------|-------------|
| `kind` | Prop type |
| `x`, `z` | Position |
| `ry` | Rotation |
| `m` | Material |
| `react` | Reaction type: `"flex"`, `"fire"`, `"firex"`, or null |

---

## Landmarks

Landmarks are special large structures.

```json
{
  "kind": "fuel",
  "x": 100,
  "z": 200,
  "ry": 0,
  "r": 3,
  "h": 7,
  "name": "Fuel Tank",
  "solid": true
}
```

### Landmark Types

- `fuel` — Explosive fuel tank (needs `r` radius and `h` height)
- `port` — Docks / port structure
- `trainstation` — Train station
- `warehouse` — Big warehouse
- `transit` — Transit station
- `mall` — Shopping mall
- `stadium` — Sports stadium
- `mosque` — Mosque
- `policestation` — Police station
- `nightclub` — Nightclub
- `firestation` — Fire station
- `school` — School
- `hill` — Terrain hill (needs `r` and `h`)
- `rockfield` — Scattered rocks (needs `r`)

---

## Vehicles

Vehicles are drivable cars, trucks, and jeeps.

```json
{
  "kind": "car",
  "x": 100,
  "z": 200,
  "ry": 0,
  "name": "My Car"
}
```

### Vehicle Types

- `car` — Fast civilian car
- `truck` — Heavy truck
- `jeep` — Off-road jeep

---

## Trees

```json
{
  "x": 100,
  "z": 200,
  "s": 1,
  "dead": false,
  "name": "Big Tree"
}
```

| Field | What it does |
|-------|-------------|
| `x`, `z` | Position |
| `s` | Scale (size) — `0.5` to `3` |
| `dead` | `true` for dead tree, `false` for living |

---

## Combat Points

### Enemy Spawns
Where enemies appear when the game starts.

```json
[[100, 200], [150, 250], [200, 300]]
```

Each spawn is just `[x, z]` coordinates.

### Cover Points
Spots where AI takes cover during fights.

```json
[[100, 200], [150, 250]]
```

### Loot Drops
Where items spawn on the ground.

```json
[[100, 200], [150, 250]]
```

---

## Map Info

### Transit Stops
Named transport stops shown on the minimap.

```json
{
  "x": 100,
  "z": 200,
  "name": "Central Station"
}
```

### Named Spots
Labeled points of interest.

```json
{
  "x": 100,
  "z": 200,
  "name": "Downtown",
  "color": "#ffd24a"
}
```

---

## Reactives

Objects that react when hit (fall, explode, etc.)

```json
{
  "kind": "flex",
  "x": 100,
  "z": 200
}
```

### Reactive Types

- `flex` — Falls / tilts when hit
- `fire` — Explodes into fire
- `firex` — Fire barrel trap

---

## Tips for Building Good Maps

1. **Start with roads** — Draw the road network first, then place buildings along them
2. **Use the validator** — Click "Validate" to check for problems
3. **Name important buildings** — Use the `name` field so you can find them later
4. **Mix building types** — Don't use only one type; mix houses, shops, and services
5. **Add props** — Barrels, crates, benches make the world feel alive
6. **Place spawns** — Put enemy spawns inside buildings and near roads
7. **Add cover points** — Place them near buildings for good firefights
8. **Use landmarks** — Big unique structures help players navigate
9. **Test often** — Click "Play" to test your map in the game
10. **Save frequently** — Ctrl+S to save, the editor also auto-saves

---

## Example: Building a Small Neighborhood

Here's how to build a small residential area:

```json
{
  "id": "my-neighborhood",
  "name": "Sunny Heights",
  "version": 1,
  "bounds": 400,
  "startPoint": { "x": 0, "z": 50, "yaw": 3.14 },
  "ground": { "size": 1200, "color": "0x4a3a2a" },
  "roads": [
    {
      "w": 14,
      "sidewalk": true,
      "smooth": true,
      "points": [[-200, 0], [0, 0], [200, 0]]
    },
    {
      "w": 12,
      "sidewalk": true,
      "smooth": true,
      "points": [[0, -150], [0, 0], [0, 150]]
    }
  ],
  "buildings": [
    { "kind": "house", "x": -80, "z": 30, "w": 10, "d": 8, "h": 4.5, "ry": 0, "name": "Blue House" },
    { "kind": "house", "x": -50, "z": 30, "w": 10, "d": 8, "h": 4.5, "ry": 0, "name": "Red House" },
    { "kind": "shop", "x": 50, "z": 30, "w": 12, "d": 10, "h": 4, "ry": 0, "m": "brick", "name": "Corner Store" },
    { "kind": "apartment", "x": 80, "z": 30, "w": 18, "d": 12, "h": 9, "ry": 0, "name": "Maple Apartments" }
  ],
  "props": [
    { "kind": "lamp", "x": -30, "z": 18, "ry": 0 },
    { "kind": "lamp", "x": 30, "z": 18, "ry": 0 },
    { "kind": "bench", "x": 0, "z": 18, "ry": 0 },
    { "kind": "trashcan", "x": 10, "z": 18, "ry": 0 }
  ],
  "trees": [
    { "x": -65, "z": 50, "s": 1.2, "dead": false },
    { "x": 65, "z": 50, "s": 1.0, "dead": false }
  ],
  "spawns": [[50, -20], [-50, -20]],
  "cover": [[-30, 15], [30, 15]],
  "loot": [[0, 0]],
  "named": [
    { "x": 0, "z": 0, "name": "Sunny Heights", "color": "#ffd24a" }
  ]
}
```

---

## Keyboard Shortcuts (Map Editor)

| Key | Action |
|-----|--------|
| `Ctrl+S` | Save map |
| `Q` / `E` | Rotate selected object |
| `Delete` | Delete selected object |
| `Arrow keys` | Nudge selected object |
| `Shift+Arrow` | Nudge by 5 meters |
| `Escape` | Deselect / cancel |
| `Enter` | Finish drawing road |
| `Scroll` | Zoom in/out |
| `Middle click + drag` | Pan the view |

---

## Fullscreen 3D Mode

Click **3D Full** button to enter fullscreen 3D editing mode. This hides the 2D view and lets you edit directly in 3D.

**In fullscreen 3D mode:**
- Left toolbar becomes a floating toolbar on the left
- Right panel becomes a floating inspector on the right
- Click on the ground to place objects
- Left-click + drag to orbit camera
- Right-click + drag to pan camera
- Scroll to zoom
- Click **Exit 3D** to return to split view

---

## Troubleshooting

**Map won't load:**
- Make sure the server is running (`node server.js`)
- Check that the JSON file is valid (no missing commas or brackets)

**Buildings overlap:**
- Use "Validate" button to find overlaps
- Move buildings apart manually

**Can't find my map:**
- Maps are saved in `data/worlds/`
- The filename is based on the map `id` field

**3D preview looks wrong:**
- Click "Rebuild 3D" to refresh
- Try changing the quality setting
