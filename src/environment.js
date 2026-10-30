import * as THREE from 'three';

// A dim room with a few bright sources, used only for reflections. Gloss reads
// as distinct highlights against darker surroundings; a uniformly bright room
// just washes a clear coat out to grey.
export function createEnvironment(renderer) {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(
    new THREE.BoxGeometry(60, 30, 60),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.045, 0.04), side: THREE.BackSide })
  ));

  const panel = (w, h, pos, look, rgb) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(...rgb), side: THREE.DoubleSide })
    );
    m.position.set(...pos);
    m.lookAt(...look);
    scene.add(m);
  };

  // Ceiling light strips.
  for (const x of [-18, -6, 6, 18]) panel(2, 40, [x, 14.8, 0], [x, 0, 0], [7, 6.4, 5.6]);
  // Window on the left wall, cooler daylight.
  panel(22, 11, [-29.8, 3, -4], [0, 3, -4], [2.4, 2.7, 3.2]);
  // Softbox behind and above the viewer: what the wall mirrors straight on.
  panel(12, 7, [9, 6, 29.8], [9, 6, 0], [3.2, 2.9, 2.5]);
  // Warm floor bounce.
  panel(60, 60, [0, -14.8, 0], [0, 0, 0], [0.16, 0.12, 0.08]);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  return env;
}
