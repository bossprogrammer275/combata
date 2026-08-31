// Asset: Mailbox — post-mounted mailbox with slot.
import * as THREE from 'three';
import * as TEX from '../../js/textures.js';

export function installMailbox(World) {
  World.prototype._propMailbox = function (x, z, ry, p, react) {
    const postMat = new THREE.MeshStandardMaterial({ color: 0x2f3236, roughness: .7 });
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x3564a8, roughness: .4, metalness: .3 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(.06, .08, 1.1, 12), postMat);
    post.position.set(x, .55 + (p.y || 0), z); post.castShadow = true; this.group.add(post);
    const mb = new THREE.Mesh(new THREE.BoxGeometry(.5, .34, .28), boxMat);
    mb.position.set(x, 1.18 + (p.y || 0), z); mb.castShadow = true; this.group.add(mb);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(.4, .04, .02), new THREE.MeshStandardMaterial({ color: 0x14161a }));
    slot.position.set(x, 1.3 + (p.y || 0), z + .14); this.group.add(slot);
    this.addCollider(x, p.y || 0, z, .6, 1.4, .6);
  };
}
