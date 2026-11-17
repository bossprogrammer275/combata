// World Kit: metadata and semantic roles for imported world assets.
// Visible scenery remains source-authored GLB/glTF. Procedural geometry is reserved
// for repeatable supporting geometry and invisible gameplay proxies.

export const WORLD_KIT_VERSION = 1;

const definitions = [
  // Buildings and civic structures
  ['buildings/brooklyn_street_twin_buildings_low_poly/scene.gltf', 'brooklyn-twin-buildings', 'building', 'streetscape', 'compound', 'preserve-source-scene', 'building-shell', 'manifest-inspected'],
  ['buildings/building/scene.gltf', 'building-generic', 'building', 'building', 'compound', 'preserve-source-scene', 'building-shell', 'manifest-inspected'],
  ['buildings/car_workshop.glb', 'car-workshop', 'building', 'workshop', 'compound', 'preserve-source-scene', 'building-shell', 'pending-visual'],
  ['buildings/gas_station_5/scene.gltf', 'gas-station-5', 'building', 'fuel-station', 'compound', 'preserve-source-scene', 'building-shell', 'manifest-inspected'],
  ['buildings/low-poly_old_american_brick_building_with_shop_/scene.gltf', 'old-brick-shop', 'building', 'shop', 'atomic', 'preserve-source-scene', 'building-shell', 'manifest-inspected'],
  ['buildings/low_poly_-_industrial_warehouse.glb', 'industrial-warehouse', 'building', 'warehouse', 'compound', 'preserve-source-scene', 'building-shell', 'pending-visual'],
  ['buildings/low_poly__school_building/scene.gltf', 'school-building', 'building', 'school', 'compound', 'preserve-source-scene', 'building-shell', 'manifest-inspected'],
  ['buildings/meed_grocery_store.glb', 'grocery-store', 'building', 'shop', 'compound', 'preserve-source-scene', 'building-shell', 'pending-visual'],
  ['buildings/mosque.glb', 'mosque', 'building', 'religious-building', 'compound', 'preserve-source-scene', 'building-shell', 'pending-visual'],

  // Residential buildings
  ['residential/Building+04_GLB/Building 04.glb', 'building-04', 'residential', 'large-house', 'compound', 'preserve-source-scene', 'building-shell-with-doorway', 'manifest-inspected'],
  ['residential/american_style_house/scene.gltf', 'american-style-house', 'residential', 'house', 'compound', 'preserve-source-scene', 'building-shell', 'manifest-inspected'],
  ['residential/nigeria_duplex/scene.gltf', 'nigeria-duplex', 'residential', 'nigerian-duplex', 'atomic', 'preserve-source-scene', 'building-shell', 'manifest-inspected'],
  ['residential/residential_family_house/scene.gltf', 'residential-family-house', 'residential', 'house', 'compound', 'preserve-source-scene', 'building-shell', 'manifest-inspected'],
  ['residential/residential_house_3/scene.gltf', 'residential-house-3', 'residential', 'house', 'atomic', 'preserve-source-scene', 'building-shell', 'manifest-inspected'],

  // Roads and transport surfaces
  ['roads/concrete_block_low_poly.glb', 'concrete-road-block', 'roadside', 'road-prop', 'atomic', 'preserve-source-scene', 'solid-prop', 'pending-visual'],
  ['roads/road_block/scene.gltf', 'road-barricade', 'roadside', 'barrier', 'atomic', 'preserve-source-scene', 'solid-prop', 'manifest-inspected'],
  ['roads/road_pack/scene.gltf', 'road-pack', 'road', 'modular-road-kit', 'compound', 'six-imported-road-modules', 'no-collision', 'per-mesh-rendered-verified'],
  ['roads/sidewalks/scene.gltf', 'sidewalk-pack', 'road', 'modular-sidewalk-pack', 'compound', 'semantic-child-pieces', 'walkable-surface-pieces', 'manifest-inspected'],
  ['roads/speed_bump.glb', 'speed-bump', 'roadside', 'traffic-calming', 'atomic', 'preserve-source-scene', 'solid-prop', 'pending-visual'],
  ['roads/street_road/scene.gltf', 'street-road', 'road', 'two-lane-wet-road-source', 'compound', 'preserve-source-scene', 'road-surface', 'rendered-preview-verified'],

  // Utilities, bridges and roadside infrastructure
  ['others/-dry_type_distribution_transformer/scene.gltf', 'dry-transformer', 'infrastructure', 'electrical-transformer', 'compound', 'preserve-source-scene', 'solid-prop', 'manifest-inspected'],
  ['others/concrete_road_barrier_photoscanned/scene.gltf', 'concrete-road-barrier', 'roadside', 'barrier', 'atomic', 'preserve-source-scene', 'solid-prop', 'manifest-inspected'],
  ['others/fence_-_11mb.glb', 'fence', 'infrastructure', 'fence', 'compound', 'preserve-source-scene', 'solid-prop', 'pending-visual'],
  ['others/freeway_streetlight_1/scene.gltf', 'freeway-streetlight', 'infrastructure', 'streetlight', 'compound', 'preserve-source-scene', 'pole-proxy', 'manifest-inspected'],
  ['others/game-ready_modular_metal_guardrail.glb', 'metal-guardrail', 'infrastructure', 'guardrail', 'compound', 'preserve-source-scene', 'solid-prop', 'pending-visual'],
  ['others/low_poly_electricity_pole/scene.gltf', 'electricity-pole', 'infrastructure', 'power-pole', 'compound', 'preserve-source-scene', 'pole-proxy', 'manifest-inspected'],
  ['others/metal_billboard_advertising_single_sided_free/scene.gltf', 'billboard', 'roadside', 'advertising-board', 'compound', 'semantic-child-pieces', 'pole-and-panel', 'manifest-inspected'],
  ['others/modular_bridge__low_poly__game_ready_/scene.gltf', 'modular-bridge', 'infrastructure', 'bridge', 'compound', 'inspect-child-meshes', 'bridge-collision', 'manifest-inspected'],
  ['others/power_transformer_building__electricity.glb', 'transformer-building', 'infrastructure', 'electrical-facility', 'compound', 'preserve-source-scene', 'building-shell', 'pending-visual'],
  ['others/standard_bus_stop.glb', 'bus-stop', 'transport', 'bus-stop', 'compound', 'preserve-source-scene', 'solid-prop', 'pending-visual'],
  ['others/traffic_lights/scene.gltf', 'traffic-lights-noncommercial', 'roadside', 'traffic-signal', 'compound', 'semantic-child-pieces', 'pole-proxy', 'licence-restricted'],

  // Street life and props
  ['others/low_poly_plastic_crates.glb', 'plastic-crates', 'street-prop', 'crate-set', 'compound', 'preserve-source-scene', 'solid-prop', 'pending-visual'],
  ['others/low_poly_street_food_cart.glb', 'street-food-cart', 'street-prop', 'food-cart', 'compound', 'preserve-source-scene', 'solid-prop', 'manifest-inspected'],
  ['others/old_soviet_railway_station_kiosk/scene.gltf', 'railway-kiosk', 'street-prop', 'kiosk', 'atomic', 'preserve-source-scene', 'solid-prop', 'manifest-inspected'],
  ['others/plastic_chair.glb', 'plastic-chair', 'street-furniture', 'chair', 'atomic', 'preserve-source-scene', 'solid-prop', 'pending-visual'],
  ['others/plastic_container.glb', 'plastic-container', 'street-prop', 'container', 'atomic', 'preserve-source-scene', 'solid-prop', 'pending-visual'],
  ['others/plastic_table.glb', 'plastic-table', 'street-furniture', 'table', 'atomic', 'preserve-source-scene', 'solid-prop', 'manifest-inspected'],
  ['others/psx_-_vending_machine.glb', 'vending-machine', 'street-prop', 'vending-machine', 'compound', 'preserve-source-scene', 'solid-prop', 'manifest-inspected'],
  ['others/vietnamese_meat_market_stall.glb', 'market-stall', 'street-prop', 'market-stall', 'compound', 'preserve-source-scene', 'solid-prop', 'pending-visual'],
  ['others/water_dispenser.glb', 'water-dispenser', 'street-prop', 'water-dispenser', 'atomic', 'preserve-source-scene', 'solid-prop', 'pending-visual'],
  ['others/water_tank.glb', 'water-tank', 'street-prop', 'water-tank', 'atomic', 'preserve-source-scene', 'solid-prop', 'pending-visual'],
  ['others/wheelbarrow.glb', 'wheelbarrow', 'street-prop', 'wheelbarrow', 'compound', 'preserve-source-scene', 'solid-prop', 'pending-visual'],
  ['others/wooden_bench.glb', 'wooden-bench', 'street-furniture', 'bench', 'compound', 'preserve-source-scene', 'solid-prop', 'manifest-inspected'],

  // Vegetation
  ['coconut_tree_low_poly.glb', 'coconut-palm', 'vegetation', 'palm-tree', 'compound', 'preserve-source-scene', 'trunk-only', 'pending-visual'],
  ['tree_low-poly.glb', 'low-poly-tree', 'vegetation', 'tree', 'compound', 'preserve-source-scene', 'trunk-only', 'pending-visual'],
  ['others/hedge.glb', 'hedge', 'vegetation', 'hedge', 'atomic', 'preserve-source-scene', 'no-collision', 'pending-visual'],
  ['others/low_poly_shrub.glb', 'low-poly-shrub', 'vegetation', 'shrub', 'atomic', 'preserve-source-scene', 'no-collision', 'pending-visual'],
  ['others/low_poly_tree.glb', 'low-poly-tree-variant', 'vegetation', 'tree', 'compound', 'preserve-source-scene', 'trunk-only', 'pending-visual'],
  ['others/real_bush.glb', 'real-bush', 'vegetation', 'bush', 'atomic', 'preserve-source-scene', 'no-collision', 'pending-visual'],

  // Civic landmarks and street lighting
  ['ilorin_innovation_hub.glb', 'ilorin-innovation-hub', 'landmark', 'civic-technology', 'compound', 'preserve-source-scene', 'building-shell', 'pending-visual'],
  ['kwara_revenue_house.glb', 'kwara-revenue-house', 'landmark', 'civic-office', 'compound', 'preserve-source-scene', 'building-shell', 'pending-visual'],
  ['low_poly_skyscraper.glb', 'low-poly-skyscraper', 'building', 'high-rise', 'compound', 'preserve-source-scene', 'building-shell', 'manifest-inspected'],
  ['low_poly_street_light.glb', 'low-poly-streetlight', 'infrastructure', 'streetlight', 'compound', 'preserve-source-scene', 'pole-proxy', 'manifest-inspected'],
];

const byUrl = Object.freeze(Object.fromEntries(definitions.map(([path, id, category, role, mode, meshPolicy, collisionProfile, review]) => [
  path,
  Object.freeze({ id, path: 'data/models/assets/' + path, category, role, mode, meshPolicy, collisionProfile, review }),
])));

export const WORLD_KIT_ASSET_DEFINITIONS = byUrl;

// Named children from the imported Road Pack, verified from separate renders.
// Preserve source geometry; these labels are only semantic prefab metadata.
export const WORLD_KIT_ROAD_PACK_PARTS = Object.freeze({
  Object_4: Object.freeze({ id: 'road-straight-01', label: 'Straight road · double centre marking', role: 'road-straight-module' }),
  Object_6: Object.freeze({ id: 'road-straight-02', label: 'Straight road · dashed centre marking', role: 'road-straight-module' }),
  Object_8: Object.freeze({ id: 'road-straight-long-01', label: 'Long straight road · marking variant A', role: 'road-straight-module' }),
  Object_10: Object.freeze({ id: 'road-straight-long-02', label: 'Long straight road · marking variant B', role: 'road-straight-module' }),
  Object_12: Object.freeze({ id: 'road-corner-01', label: 'Curved road corner · marking variant A', role: 'road-corner-module' }),
  Object_14: Object.freeze({ id: 'road-corner-02', label: 'Curved road corner · marking variant B', role: 'road-corner-module' }),
});

export const WORLD_KIT_PROCEDURAL_RULES = Object.freeze([
  Object.freeze({ id: 'curved-road-surfaces', use: 'procedural', reason: 'Road ribbons need to follow authored curves and variable widths; use imported road modules only where their geometry fits.' }),
  Object.freeze({ id: 'lane-markings', use: 'procedural', reason: 'Paint, dashed lane lines, stop lines and crosswalks are repeatable thin geometry.' }),
  Object.freeze({ id: 'curbs-and-road-junction-transitions', use: 'procedural', reason: 'Small transitions must meet arbitrary road and sidewalk angles without gaps.' }),
  Object.freeze({ id: 'collision-proxies', use: 'procedural-invisible', reason: 'Physics shapes should be simple boxes, capsules or convex proxies, never detailed render meshes.' }),
  Object.freeze({ id: 'terrain-and-ground-transitions', use: 'procedural', reason: 'Terrain shaping and small ground blends are structural support, not authored landmarks.' }),
  Object.freeze({ id: 'minor-repeating-details', use: 'procedural-only-when-needed', reason: 'Small bolts, brackets, trim and repeated low-value details may be generated when no useful source asset exists.' }),
]);

function normalizeAssetPath(url) {
  return String(url || '')
    .split(/[?#]/, 1)[0]
    .replace(/^\.\//, '')
    .replace(/^\//, '')
    .replace(/\\/g, '/');
}

export function getWorldKitDefinition(url) {
  const normalized = normalizeAssetPath(url);
  const prefix = 'data/models/assets/';
  const relative = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
  return WORLD_KIT_ASSET_DEFINITIONS[relative] || null;
}

function meshNames(mesh, root) {
  const names = [];
  for (let node = mesh; node && node !== root; node = node.parent) {
    if (node.name) names.unshift(node.name);
  }
  return names;
}

export function classifyWorldKitMesh(mesh, root) {
  if (root?.userData?.worldKit?.id === 'road-pack') return WORLD_KIT_ROAD_PACK_PARTS[mesh.name]?.role || 'road-module';
  const names = meshNames(mesh, root);
  const chain = names.join('/').toLowerCase();
  if (names.some(name => name.toLowerCase().startsWith('col_'))) return 'collision-proxy';
  if (names.some(name => name.toLowerCase().startsWith('door_')) || /(^|[/_. -])(?:garage)?door([/_. -]|$)|garagedoor/.test(chain)) return 'door';
  if (names.some(name => name.toLowerCase().startsWith('window_')) || /window|glazing/.test(chain)) return 'window-glazing';
  if (names.some(name => name.toLowerCase().startsWith('floor_')) || /(^|[/_. -])floor([/_. -]|$)/.test(chain)) return 'walkable-floor';
  if (names.some(name => name.toLowerCase().startsWith('stairs_')) || /stair|steps/.test(chain)) return 'stairs';
  if (/sidew{1,2}alk|curb|driveway/.test(chain)) return 'sidewalk-piece';
  if (/road|asphalt|lane/.test(chain)) return 'road-piece';
  if (/billboard|advertising|sign/.test(chain)) return 'sign-piece';
  if (/traffic.?light|signal.?head/.test(chain)) return 'traffic-signal-piece';
  if (/pole|street.?light|streetlamp|lamp|electricity.?pole|transformer|guardrail|fence|post/.test(chain)) return 'infrastructure-piece';
  if (/tree|bush|shrub|hedge|foliage|leaf/.test(chain)) return 'vegetation-piece';
  return 'static-visual';
}

export function annotateWorldKitInstance(root, placement = {}) {
  const definition = getWorldKitDefinition(placement.url);
  const id = definition?.id || String(placement.componentId || placement.url || 'unregistered-component');
  const roleCounts = Object.create(null);
  let meshCount = 0;

  root.userData ||= {};
  root.userData.worldKit = {
    version: WORLD_KIT_VERSION,
    id,
    category: definition?.category || placement.category || 'unclassified',
    role: definition?.role || placement.role || 'static-visual',
    mode: definition?.mode || 'compound',
    meshPolicy: definition?.meshPolicy || 'preserve-source-scene',
    collisionProfile: definition?.collisionProfile || 'placement-default',
    review: definition?.review || 'unregistered',
    sourceUrl: placement.url || '',
  };

  root.traverse(node => {
    if (!node.isMesh) return;
    const role = classifyWorldKitMesh(node, root);
    roleCounts[role] = (roleCounts[role] || 0) + 1;
    meshCount++;
    node.userData ||= {};
    const roadPart = id === 'road-pack' ? WORLD_KIT_ROAD_PACK_PARTS[node.name] : null;
    node.userData.worldKit = {
      assetId: id,
      role: roadPart?.role || role,
      ...(roadPart ? { componentId: roadPart.id, label: roadPart.label } : {}),
    };
  });

  return {
    id,
    category: root.userData.worldKit.category,
    role: root.userData.worldKit.role,
    mode: root.userData.worldKit.mode,
    meshCount,
    roleCounts: { ...roleCounts },
    review: root.userData.worldKit.review,
    subcomponents: root.userData.worldKit.id === 'road-pack'
      ? Object.values(WORLD_KIT_ROAD_PACK_PARTS).map(part => ({ ...part }))
      : [],
  };
}
