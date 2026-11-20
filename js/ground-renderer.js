// Ground Renderer — world-space procedural PBR, adapted from Ground Render Engine.html.
export function createGroundRendererMaterial(THREE, options = {}) {
  const quality = String(options.quality || 'medium');
  let tint = options.color || '#6c6758';
  if (typeof tint === 'string' && tint.startsWith('0x')) tint = '#' + tint.slice(2);
  const tintColor = new THREE.Color(tint);
  const referenceTint = new THREE.Color('#6c6758');
  const tintScale = new THREE.Vector3(
    tintColor.r / Math.max(referenceTint.r, 0.001),
    tintColor.g / Math.max(referenceTint.g, 0.001),
    tintColor.b / Math.max(referenceTint.b, 0.001),
  );
  const octaves = quality === 'high' || quality === 'ultra' ? 3 : 2;
  const detail = quality === 'high' || quality === 'ultra' ? 1 : 0;
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.97,
    metalness: 0,
  });
  material.name = 'ground_renderer_procedural_pbr';
  material.userData.groundRenderer = {
    engine: 'world-space-procedural-pbr',
    source: 'Ground Render Engine.html',
    octaves,
    microNormalDetail: !!detail,
  };
  material.customProgramCacheKey = () => 'ground-renderer-pbr-v1-' + octaves + '-' + detail;
  material.onBeforeCompile = shader => {
    shader.uniforms.uGroundTintScale = { value: tintScale };
    shader.uniforms.uGroundDetail = { value: detail };
    shader.vertexShader = 'varying vec3 vGroundWorld; varying vec3 vGroundNormal;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n' +
      'vec4 groundWorldPosition = modelMatrix * vec4(transformed, 1.0);\n' +
      'vGroundWorld = groundWorldPosition.xyz;\n' +
      'vGroundNormal = normalize(mat3(modelMatrix) * objectNormal);',
    );
    const helpers = [
      'uniform vec3 uGroundTintScale;',
      'uniform float uGroundDetail;',
      'varying vec3 vGroundWorld;',
      'varying vec3 vGroundNormal;',
      'float groundHash(vec2 p) {',
      '  p = fract(p * vec2(123.34, 456.21));',
      '  p += dot(p, p + 45.32);',
      '  return fract(p.x * p.y);',
      '}',
      'float groundNoise(vec2 p) {',
      '  vec2 i = floor(p), f = fract(p);',
      '  f = f * f * (3.0 - 2.0 * f);',
      '  return mix(mix(groundHash(i), groundHash(i + vec2(1.0, 0.0)), f.x),',
      '    mix(groundHash(i + vec2(0.0, 1.0)), groundHash(i + vec2(1.0, 1.0)), f.x), f.y);',
      '}',
      'float groundFbm(vec2 p) {',
      '  float value = 0.0, amplitude = 0.5;',
      '  for (int octave = 0; octave < ' + octaves + '; octave++) {',
      '    value += amplitude * groundNoise(p);',
      '    p = p * 2.03 + 17.0;',
      '    amplitude *= 0.5;',
      '  }',
      '  return value;',
      '}',
      'vec2 groundCell(vec2 p) {',
      '  vec2 i = floor(p), f = fract(p);',
      '  float nearest = 9.0, second = 9.0;',
      '  for (int y = -1; y <= 1; y++) {',
      '    for (int x = -1; x <= 1; x++) {',
      '      vec2 g = vec2(float(x), float(y));',
      '      vec2 feature = g + vec2(groundHash(i + g), groundHash(i + g + vec2(37.1)));',
      '      float d = length(feature - f);',
      '      if (d < nearest) { second = nearest; nearest = d; }',
      '      else if (d < second) { second = d; }',
      '    }',
      '  }',
      '  return vec2(nearest, second);',
      '}',
    ].join('\n');
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\n' + helpers,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\n' +
      'vec2 groundP = vGroundWorld.xz;\n' +
      'float groundLod = 1.0 - smoothstep(55.0, 175.0, length(vGroundWorld - cameraPosition));\n' +
      'float groundBroad = groundFbm(groundP * 0.008 + vec2(7.0, 19.0));\n' +
      'float groundPatch = groundFbm(groundP * 0.034 + vec2(23.0, 5.0));\n' +
      'float groundGrass = smoothstep(0.60, 0.78, groundFbm(groundP * 0.014 + vec2(41.0, 13.0)));\n' +
      'float groundWorn = smoothstep(0.36, 0.72, groundPatch);\n' +
      'vec3 groundSoil = mix(vec3(0.39, 0.36, 0.30), vec3(0.48, 0.44, 0.36), groundBroad);\n' +
      'vec3 groundPacked = mix(vec3(0.34, 0.33, 0.30), vec3(0.43, 0.40, 0.35), groundPatch);\n' +
      'vec3 groundGreen = mix(vec3(0.29, 0.33, 0.23), vec3(0.38, 0.41, 0.29), groundBroad);\n' +
      'vec3 groundColor = mix(groundSoil, groundPacked, groundWorn * 0.42);\n' +
      'groundColor = mix(groundColor, groundGreen, groundGrass * 0.42);\n' +
      'float groundGrain = groundNoise(groundP * 3.8) - 0.5;\n' +
      'groundColor *= 0.94 + groundGrain * 0.15 * groundLod;\n' +
      'float groundSlope = 1.0 - clamp(vGroundNormal.y, 0.0, 1.0);\n' +
      'groundColor = mix(groundColor, vec3(0.32, 0.29, 0.25), smoothstep(0.22, 0.68, groundSlope) * 0.38);\n' +
      'if (groundLod > 0.01) {\n' +
      '  vec2 groundCells = groundCell(groundP * 2.8);\n' +
      '  float groundStone = (1.0 - smoothstep(0.04, 0.22, groundCells.x)) * 0.075;\n' +
      '  groundColor *= 1.0 - groundStone;\n' +
      '}\n' +
      'diffuseColor.rgb *= pow(max(groundColor, vec3(0.02)), vec3(2.2)) * uGroundTintScale;',
    );
    if (detail) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\n' +
        'if (groundLod > 0.01 && uGroundDetail > 0.5) {\n' +
        '  float e = 0.035;\n' +
        '  float h0 = groundNoise(groundP * 18.0) * 0.018;\n' +
        '  float hx = groundNoise((groundP + vec2(e, 0.0)) * 18.0) * 0.018;\n' +
        '  float hz = groundNoise((groundP + vec2(0.0, e)) * 18.0) * 0.018;\n' +
        '  vec3 groundGradient = vec3((h0 - hx) / e, 0.0, (h0 - hz) / e) * groundLod * 0.24;\n' +
        '  normal = normalize(normal + (viewMatrix * vec4(groundGradient, 0.0)).xyz);\n' +
        '}',
      );
    }
  };
  return material;
}
