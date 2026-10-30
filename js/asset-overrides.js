// Non-destructive GLB node overrides shared by the Asset Lab and runtime loaders.
const EMPTY = Object.freeze({ version:1, assets:{} });
let pending=null, data=null;
export async function loadAssetOverrides(force=false) {
  if(force){pending=null;data=null;}
  if(data)return data;
  if(!pending)pending=fetch('/api/asset-overrides',{cache:'no-store'}).then(r=>r.ok?r.json():EMPTY)
    .then(v=>{data=v&&v.assets&&typeof v.assets==='object'?v:EMPTY;return data;})
    .catch(()=>{data=EMPTY;return EMPTY;});
  return pending;
}
function canonicalAssetKey(url) { return String(url || '').replace(/^\.\//, '/'); }
export function getAssetOverride(url){ const key=canonicalAssetKey(url); return data?.assets?.[key] || data?.assets?.[url] || data?.assets?.[key.replace(/^\//, './')] || null; }
function nodeKey(root,node) {
  const parts=[]; let current=node;
  while(current && current!==root){ const parent=current.parent; const index=parent ? parent.children.indexOf(current) : 0; parts.push((current.name || current.type || 'node')+'['+index+']'); current=parent; }
  return parts.reverse().join('/');
}
export function applyAssetOverrides(root,url,options={}) {
  const cfg=getAssetOverride(url);if(!cfg||!root)return cfg||{};
  if(options.applyRoot&&cfg.root){
    const p=cfg.root.position||{},r=cfg.root.rotation||{},s=cfg.root.scale||{};
    root.position.x+=Number(p.x)||0;root.position.y+=Number(p.y)||0;root.position.z+=Number(p.z)||0;
    root.rotation.x+=Number(r.x)||0;root.rotation.y+=Number(r.y)||0;root.rotation.z+=Number(r.z)||0;
    root.scale.x*=Number.isFinite(s.x)?s.x:1;root.scale.y*=Number.isFinite(s.y)?s.y:1;root.scale.z*=Number.isFinite(s.z)?s.z:1;
  }
  const edits=cfg.meshes||{};
  if(Object.keys(edits).length)root.traverse(node=>{
    const e=edits[nodeKey(root,node)] || edits[node.name];if(!e)return;
    const p=e.position||{},r=e.rotation||{},s=e.scale||{};
    node.position.x+=Number(p.x)||0;node.position.y+=Number(p.y)||0;node.position.z+=Number(p.z)||0;
    node.rotation.x+=Number(r.x)||0;node.rotation.y+=Number(r.y)||0;node.rotation.z+=Number(r.z)||0;
    node.scale.x*=Number.isFinite(s.x)?s.x:1;node.scale.y*=Number.isFinite(s.y)?s.y:1;node.scale.z*=Number.isFinite(s.z)?s.z:1;
  });
  root.userData.assetOverride=cfg;root.updateMatrixWorld(true);return cfg;
}
