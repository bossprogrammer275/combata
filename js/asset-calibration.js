// Runtime bridge between calibrated source assets and gameplay systems.
// Calibration is metadata-only: source geometry and transforms are never rewritten.
const calibrationPromises = new Map();

function canonicalAssetUrl(value) {
  return String(value || '').split(/[?#]/, 1)[0].replace(/^\.\//, '').replace(/^\//, '');
}

export function getAssetCalibrationUrl(assetUrl) {
  const clean = canonicalAssetUrl(assetUrl);
  if (!/\.(glb|gltf)$/i.test(clean)) return null;
  return './' + clean.replace(/\.(glb|gltf)$/i, '_calibration.json');
}

export function getAssetNodeKey(root, node) {
  const parts = [];
  let current = node;
  while (current && current !== root) {
    const parent = current.parent;
    const index = parent ? parent.children.indexOf(current) : 0;
    parts.unshift(`${current.name || current.type || 'node'}[${index}]`);
    current = parent;
  }
  return parts.join('/');
}

export function resolveAssetCalibrationNode(root, key) {
  if (!root || !key) return null;
  if (root.userData?.assetCalibrationNodeMap instanceof Map) {
    return root.userData.assetCalibrationNodeMap.get(key) || null;
  }
  let found = null;
  root.traverse(node => {
    if (!found && getAssetNodeKey(root, node) === key) found = node;
  });
  return found;
}

export async function loadAssetCalibration(assetUrl, options = {}) {
  const url = getAssetCalibrationUrl(assetUrl);
  if (!url || typeof fetch !== 'function') return null;
  if (options.force) calibrationPromises.delete(url);
  let pending = calibrationPromises.get(url);
  if (!pending) {
    pending = fetch(url, { cache: options.force ? 'no-cache' : 'force-cache' })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (!data || data.schemaVersion !== 1 || data.kind !== 'open-world-asset-calibration') return null;
        const expected = canonicalAssetUrl(assetUrl);
        const actual = canonicalAssetUrl(data.source?.assetUrl);
        if (!actual || actual !== expected) {
          console.warn('[AssetCalibration] Sidecar/source mismatch:', assetUrl, data.source?.assetUrl);
          return null;
        }
        return data;
      })
      .catch(error => {
        if (options.logMissing) console.warn('[AssetCalibration] Sidecar unavailable:', url, error);
        return null;
      });
    calibrationPromises.set(url, pending);
  }
  return pending;
}

export function applyAssetCalibration(root, calibration) {
  if (!root || !calibration || calibration.schemaVersion !== 1) {
    return { profile: null, nodesByKey: new Map(), componentsByRole: new Map() };
  }

  const nodesByKey = new Map();
  root.traverse(node => nodesByKey.set(getAssetNodeKey(root, node), node));
  const componentsByRole = new Map();

  for (const component of calibration.components || []) {
    const node = nodesByKey.get(component.nodeKey);
    if (!node) continue;
    const record = {
      id: component.id || component.nodeKey,
      role: component.role || 'unclassified',
      kind: component.kind || null,
      confidence: Number(component.confidence) || 0,
      requiresReview: component.requiresReview !== false,
      source: 'asset-calibration',
    };
    node.userData ||= {};
    node.userData.assetCalibration = record;

    // Only manually accepted interaction anchors become runtime interactables.
    // Guessed seat centres/hinges must not silently move the player or NPC.
    if (component.interaction?.accepted === true && component.interaction.kind) {
      const interaction = component.interaction;
      if (String(interaction.kind).startsWith('vehicle-')
        || interaction.kind === 'steering-wheel') {
        node.userData.vehicleInteractable = {
          ...interaction,
          componentId: component.id || component.nodeKey,
          componentRole: component.role || null,
          coordinateSpace: 'component-local',
        };
      } else {
        const anchors = interaction.anchors || {};
        const anchorPosition = value => Array.isArray(value) && value.length >= 3
          ? value
          : Array.isArray(value?.position) ? value.position
            : value?.position && ['x', 'y', 'z'].every(key => Number.isFinite(Number(value.position[key])))
              ? [Number(value.position.x), Number(value.position.y), Number(value.position.z)]
              : null;
        const anchorOffset = value => {
          const position = anchorPosition(value);
          return position ? { x: Number(position[0]), y: Number(position[1]), z: Number(position[2]) } : null;
        };
        node.userData.npcInteractable = {
          ...interaction,
          kind: interaction.kind,
          label: interaction.label || interaction.kind,
          useRadius: interaction.useRadius,
          approachOffset: interaction.approachOffset || anchorOffset(anchors.approach),
          sitOffset: interaction.sitOffset || anchorOffset(anchors.pelvis || anchors.sit),
          seatFacing: anchors.seatFacing || null,
          exitOffset: anchorOffset(anchors.exit),
        };
        if (interaction.kind === 'door') {
          node.userData.npcInteractable = false;
          node.userData.worldKit ||= {};
          node.userData.worldKit.role = 'door';
          node.userData.worldKit.calibratedDoor = {
            hinge: anchorPosition(anchors.hinge),
            hingeAxis: anchors.hingeAxis || null,
            handle: anchorPosition(anchors.handle),
            closedTransform: anchors.closedTransform || null,
            openRange: anchors.openRange || null,
            openAngleDeg: Number.isFinite(Number(anchors.openAngleDeg)) ? Number(anchors.openAngleDeg) : null,
            accepted: true,
          };
        }
      }
    }

    let bucket = componentsByRole.get(record.role);
    if (!bucket) componentsByRole.set(record.role, bucket = []);
    bucket.push({ node, component, record });
  }

  root.userData ||= {};
  root.userData.assetCalibration = calibration;
  root.userData.assetCalibrationNodeMap = nodesByKey;
  root.userData.assetCalibrationComponentsByRole = componentsByRole;
  return { profile: calibration, nodesByKey, componentsByRole };
}

export function getCalibratedComponents(root, role) {
  const roles = root?.userData?.assetCalibrationComponentsByRole;
  if (!(roles instanceof Map)) return [];
  return role ? (roles.get(role) || []) : [...roles.values()].flat();
}
