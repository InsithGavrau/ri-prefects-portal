import * as THREE from "three";

const GOLD = 0xc9a646;
const PALE_GOLD = 0xffefaa;
const EMERALD = 0x0f8d66;
const BURGUNDY = 0x6a362a;

export function mountHallOfFameWebGL(root) {
  if (!root || root.querySelector("[data-hof-webgl]")) return () => {};

  const canvas = document.createElement("canvas");
  canvas.className = "hof-webgl-canvas";
  canvas.dataset.hofWebgl = "true";
  canvas.setAttribute("aria-hidden", "true");
  root.prepend(canvas);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
  } catch (error) {
    canvas.remove();
    root.classList.add("hof-webgl-unavailable");
    console.warn("Hall of Fame WebGL is unavailable", error);
    return () => {};
  }

  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 0, 7.2);

  const crown = createCrown();
  scene.add(crown);

  const honorArc = createHonorArc();
  scene.add(honorArc);

  const particles = createParticleField();
  scene.add(particles);

  const keyLight = new THREE.DirectionalLight(0xffe39a, 4.2);
  keyLight.position.set(4.5, 4, 5);
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight(EMERALD, 2.4);
  rimLight.position.set(-4, -1.5, 3);
  scene.add(rimLight);

  const fillLight = new THREE.HemisphereLight(0xfff2c7, 0x130b09, 1.7);
  scene.add(fillLight);

  const pointer = { x: 0, y: 0 };
  const pointerTarget = { x: 0, y: 0 };
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  let frameId = 0;
  let visible = true;
  let disposed = false;

  const resize = () => {
    const width = Math.max(1, root.clientWidth);
    const height = Math.max(1, root.clientHeight);
    const aspect = width / height;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(width, height, false);
    camera.aspect = aspect;
    camera.position.z = aspect < 0.92 ? 8.4 : 7.2;
    camera.updateProjectionMatrix();

    const compact = aspect < 1.05;
    const scale = compact ? 0.76 : aspect < 1.45 ? 0.9 : 1;
    crown.scale.setScalar(scale);
    crown.position.set(compact ? 0.78 : 1.65, compact ? -0.26 : 0.02, 0);
    crown.userData.baseY = crown.position.y;
    honorArc.scale.setScalar(scale);
    honorArc.position.copy(crown.position);
    renderer.render(scene, camera);
  };

  const onPointerMove = event => {
    const bounds = root.getBoundingClientRect();
    pointerTarget.x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
    pointerTarget.y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
  };

  const onPointerLeave = () => {
    pointerTarget.x = 0;
    pointerTarget.y = 0;
  };

  const renderFrame = now => {
    if (disposed) return;
    if (visible && !document.hidden) {
      const time = now * 0.001;
      pointer.x += (pointerTarget.x - pointer.x) * 0.045;
      pointer.y += (pointerTarget.y - pointer.y) * 0.045;
      crown.rotation.x = -0.08 + pointer.y * 0.07 + Math.sin(time * 0.7) * 0.025;
      crown.rotation.y = -0.18 + pointer.x * 0.16 + Math.sin(time * 0.45) * 0.085;
      crown.rotation.z = Math.sin(time * 0.34) * 0.015;
      crown.position.y = crown.userData.baseY + Math.sin(time * 0.82) * 0.055;
      honorArc.position.y = crown.userData.baseY + Math.sin(time * 0.82) * 0.028;
      honorArc.rotation.z = Math.sin(time * 0.22) * 0.025;
      particles.rotation.y = time * 0.018;
      particles.rotation.z = Math.sin(time * 0.12) * 0.025;
      keyLight.position.x = 3.8 + Math.sin(time * 0.6) * 1.5;
      renderer.render(scene, camera);
    }
    frameId = requestAnimationFrame(renderFrame);
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(root);

  const visibilityObserver = new IntersectionObserver(entries => {
    visible = entries[0]?.isIntersecting ?? true;
  }, { threshold: 0.02 });
  visibilityObserver.observe(root);

  if (!reducedMotion) {
    root.addEventListener("pointermove", onPointerMove, { passive: true });
    root.addEventListener("pointerleave", onPointerLeave, { passive: true });
    frameId = requestAnimationFrame(renderFrame);
  }

  resize();
  root.classList.add("hof-webgl-ready");

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frameId);
    resizeObserver.disconnect();
    visibilityObserver.disconnect();
    root.removeEventListener("pointermove", onPointerMove);
    root.removeEventListener("pointerleave", onPointerLeave);
    scene.traverse(object => {
      object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.filter(Boolean).forEach(material => material.dispose?.());
    });
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    root.classList.remove("hof-webgl-ready");
  };

  window.addEventListener("pagehide", cleanup, { once: true });
  return cleanup;
}

function createCrown() {
  const group = new THREE.Group();
  group.rotation.set(-0.08, -0.18, 0);

  const shape = new THREE.Shape();
  shape.moveTo(-1.86, -0.62);
  shape.lineTo(-1.58, 0.72);
  shape.lineTo(-0.78, 0.08);
  shape.lineTo(0, 1.16);
  shape.lineTo(0.78, 0.08);
  shape.lineTo(1.58, 0.72);
  shape.lineTo(1.86, -0.62);
  shape.closePath();

  const crownGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.25,
    bevelEnabled: true,
    bevelSegments: 4,
    bevelSize: 0.055,
    bevelThickness: 0.055,
    curveSegments: 16,
  });
  crownGeometry.center();

  const crownMaterial = new THREE.MeshStandardMaterial({
    color: GOLD,
    metalness: 0.88,
    roughness: 0.2,
    emissive: 0x271607,
    emissiveIntensity: 0.22,
  });
  const crownMesh = new THREE.Mesh(crownGeometry, crownMaterial);
  crownMesh.position.y = 0.16;
  group.add(crownMesh);

  const edgeMaterial = new THREE.LineBasicMaterial({ color: PALE_GOLD, transparent: true, opacity: 0.58 });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(crownGeometry, 24), edgeMaterial);
  edges.position.copy(crownMesh.position);
  group.add(edges);

  const band = new THREE.Mesh(
    new THREE.BoxGeometry(3.82, 0.36, 0.4, 8, 2, 2),
    new THREE.MeshStandardMaterial({ color: 0xb78d2d, metalness: 0.92, roughness: 0.24 }),
  );
  band.position.set(0, -0.72, 0.01);
  group.add(band);

  const gemGeometry = new THREE.OctahedronGeometry(0.16, 1);
  [
    { x: -0.82, color: BURGUNDY },
    { x: 0, color: EMERALD },
    { x: 0.82, color: 0xf5e8d8 },
  ].forEach(({ x, color }, index) => {
    const gem = new THREE.Mesh(
      gemGeometry,
      new THREE.MeshPhysicalMaterial({
        color,
        metalness: 0.15,
        roughness: 0.12,
        transmission: index === 2 ? 0.28 : 0.12,
        thickness: 0.35,
      }),
    );
    gem.position.set(x, -0.7, 0.3);
    gem.rotation.z = Math.PI / 4;
    group.add(gem);
  });

  return group;
}

function createHonorArc() {
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.34 });

  [0, Math.PI].forEach(rotation => {
    const curve = new THREE.EllipseCurve(0, -0.08, 2.42, 1.72, -1.08, 1.08, false, rotation);
    const points = curve.getPoints(80).map(point => new THREE.Vector3(point.x, point.y, -0.42));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material.clone());
    group.add(line);
  });

  const tickMaterial = new THREE.LineBasicMaterial({ color: PALE_GOLD, transparent: true, opacity: 0.24 });
  const tickPoints = [];
  for (let index = 0; index < 18; index += 1) {
    const angle = -1.02 + index * 0.12;
    const side = index % 2 === 0 ? -1 : 1;
    const x = side * Math.cos(angle) * 2.48;
    const y = Math.sin(angle) * 1.75 - 0.08;
    tickPoints.push(new THREE.Vector3(x, y, -0.38), new THREE.Vector3(x * 1.04, y * 1.04, -0.38));
  }
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tickPoints), tickMaterial));
  return group;
}

function createParticleField() {
  const compact = window.innerWidth < 760;
  const count = compact ? 100 : 190;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const gold = new THREE.Color(GOLD);
  const cream = new THREE.Color(PALE_GOLD);
  const emerald = new THREE.Color(EMERALD);

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    positions[offset] = (Math.random() - 0.5) * 10;
    positions[offset + 1] = (Math.random() - 0.5) * 5.4;
    positions[offset + 2] = -1.5 - Math.random() * 5;
    const color = index % 17 === 0 ? emerald : index % 3 === 0 ? cream : gold;
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: compact ? 0.035 : 0.045,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.72,
    vertexColors: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geometry, material);
}
