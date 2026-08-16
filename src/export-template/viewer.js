/* Wanderwall static gallery viewer.
 * Self-contained: reads window.GALLERY_DATA (baked at export time from the
 * same layout engine as the hosted scene) and renders a walkable gallery
 * with a 2D list fallback. No network dependencies beyond these files.
 */
import * as THREE from "./three.module.min.js";

const DATA = window.GALLERY_DATA;
const EYE = 1.6;
const SPEED = 3.2;
const RADIUS = 0.35;

const app = document.getElementById("app");
const listEl = document.getElementById("list-view");
const infoEl = document.getElementById("info-panel");
const roomLabelEl = document.getElementById("room-label");
const mapEl = document.getElementById("mini-map");
const toggleBtn = document.getElementById("toggle-view");

let mode = supportsWebGL2() ? "walk" : "list";
let renderer = null;
let focused = null;
let activeRoomIndex = 0;

function supportsWebGL2() {
  try {
    return Boolean(document.createElement("canvas").getContext("webgl2"));
  } catch {
    return false;
  }
}

/* ------------------------------- list view ------------------------------ */

function renderList() {
  listEl.innerHTML = "";
  for (const room of DATA.layout.rooms) {
    for (const placed of room.artworks) {
      const a = placed.artwork;
      const fig = document.createElement("figure");
      const img = document.createElement("img");
      img.src = a.urls.wall || a.urls.thumb;
      img.alt = a.title;
      img.loading = "lazy";
      const cap = document.createElement("figcaption");
      const strong = document.createElement("strong");
      strong.textContent = a.title;
      cap.appendChild(strong);
      if (a.caption) {
        const p = document.createElement("div");
        p.className = "muted";
        p.textContent = a.caption;
        cap.appendChild(p);
      }
      const lic = document.createElement("div");
      const badge = licenseBadge(a.license);
      if (badge.url) {
        const link = document.createElement("a");
        link.href = badge.url;
        link.rel = "license noopener";
        link.target = "_blank";
        link.textContent = badge.label;
        link.className = "badge";
        lic.appendChild(link);
      } else {
        const span = document.createElement("span");
        span.className = "badge";
        span.textContent = "© " + DATA.creatorName;
        lic.appendChild(span);
      }
      cap.appendChild(lic);
      fig.appendChild(img);
      fig.appendChild(cap);
      listEl.appendChild(fig);
    }
  }
}

const CC_URLS = {
  "cc-by": "https://creativecommons.org/licenses/by/4.0/",
  "cc-by-sa": "https://creativecommons.org/licenses/by-sa/4.0/",
  "cc-by-nc": "https://creativecommons.org/licenses/by-nc/4.0/",
  "cc-by-nc-sa": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  "cc-by-nd": "https://creativecommons.org/licenses/by-nd/4.0/",
  "cc-by-nc-nd": "https://creativecommons.org/licenses/by-nc-nd/4.0/",
  cc0: "https://creativecommons.org/publicdomain/zero/1.0/",
};

function licenseBadge(license) {
  if (!license || license === "all-rights-reserved") return { label: "©", url: null };
  return { label: license.toUpperCase().replace("CC-", "CC "), url: CC_URLS[license] || null };
}

/* ------------------------------- 3D scene ------------------------------- */

const FLOOR_COLORS = {
  oak: 0xcdb48c, walnut: 0x7a5a3a, terrazzo: 0xd5cfc2, concrete: 0x9d9d97,
  stone: 0xb3a68d, brick: 0x9c5a41, gravel: 0x8b857a,
};

function startScene() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(68, 1, 0.1, 120);
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  app.appendChild(renderer.domElement);

  const layout = DATA.layout;
  const spawn = layout.spawn;
  camera.position.set(spawn.position[0], spawn.position[1], spawn.position[2]);
  let yaw = spawn.rotationY;
  let pitch = 0;

  // Lighting from the active room's rig.
  const ambient = new THREE.AmbientLight(0xffffff, 0.75);
  const hemi = new THREE.HemisphereLight(0xeef3ff, 0xd8d2c4, 0.55);
  const key = new THREE.DirectionalLight(0xfffdf5, 1.1);
  key.position.set(-3.5, 10, -2);
  scene.add(ambient, hemi, key);

  function applyRig(rig) {
    const r = DATA.rigs[rig] || Object.values(DATA.rigs)[0];
    ambient.color.set(r.ambientColor); ambient.intensity = r.ambientIntensity;
    hemi.color.set(r.hemisphereSky); hemi.groundColor.set(r.hemisphereGround);
    hemi.intensity = r.hemisphereIntensity;
    key.color.set(r.keyColor); key.intensity = r.keyIntensity;
    key.position.set(-r.keyDirection[0] * 10, -r.keyDirection[1] * 10, -r.keyDirection[2] * 10);
  }

  // Rooms.
  const clickTargets = [];
  const floorMeshes = [];
  for (const room of layout.rooms) {
    buildRoom(scene, room, floorMeshes);
  }

  // Artworks.
  const texLoader = new THREE.TextureLoader();
  const artMeshes = [];
  for (const room of layout.rooms) {
    for (const placed of room.artworks) {
      const group = buildArtwork(placed, texLoader);
      group.userData.placed = placed;
      scene.add(group);
      artMeshes.push(group);
      clickTargets.push(...group.children.filter((c) => c.userData.isCanvas));
    }
  }

  // Input.
  const keys = {};
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    keys[e.code] = true;
    if (e.code === "Escape") setFocus(null);
  });
  window.addEventListener("keyup", (e) => { keys[e.code] = false; });

  let dragging = false;
  let last = null;
  let moved = 0;
  let moveTarget = null;
  const joy = { x: 0, y: 0 };
  const raycaster = new THREE.Raycaster();

  renderer.domElement.addEventListener("pointerdown", (e) => {
    dragging = true; moved = 0; last = [e.clientX, e.clientY];
  });
  window.addEventListener("pointermove", (e) => {
    if (!dragging || !last) return;
    const dx = e.clientX - last[0];
    const dy = e.clientY - last[1];
    last = [e.clientX, e.clientY];
    moved += Math.abs(dx) + Math.abs(dy);
    yaw -= dx * 0.0032;
    pitch = Math.max(-1.2, Math.min(1.2, pitch - dy * 0.0032));
  });
  window.addEventListener("pointerup", (e) => {
    if (dragging && moved < 6) handleClick(e);
    dragging = false; last = null;
  });

  function handleClick(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const artHit = raycaster.intersectObjects(clickTargets, false)[0];
    if (artHit) {
      setFocus(artHit.object.parent.userData.placed);
      return;
    }
    const floorHit = raycaster.intersectObjects(floorMeshes, false)[0];
    if (floorHit) moveTarget = [floorHit.point.x, floorHit.point.z];
  }

  function setFocus(placed) {
    focused = placed;
    moveTarget = null;
    if (placed) {
      const a = placed.artwork;
      const badge = licenseBadge(a.license);
      infoEl.innerHTML = "";
      const h = document.createElement("strong");
      h.textContent = a.title;
      infoEl.appendChild(h);
      if (a.caption) {
        const p = document.createElement("p");
        p.textContent = a.caption;
        infoEl.appendChild(p);
      }
      const lic = document.createElement("p");
      if (badge.url) {
        const link = document.createElement("a");
        link.href = badge.url; link.target = "_blank"; link.rel = "license noopener";
        link.textContent = badge.label;
        lic.appendChild(link);
      } else {
        lic.textContent = "© " + DATA.creatorName;
      }
      infoEl.appendChild(lic);
      const back = document.createElement("button");
      back.textContent = "Back to walking (Esc)";
      back.onclick = () => setFocus(null);
      infoEl.appendChild(back);
      infoEl.style.display = "block";
    } else {
      infoEl.style.display = "none";
    }
  }

  // Mini-map.
  renderMiniMap((target) => {
    camera.position.set(target[0], EYE, target[1]);
    setFocus(null);
  });

  // Touch joystick.
  setupJoystick(joy);

  const clock = new THREE.Clock();
  function frame() {
    const delta = Math.min(clock.getDelta(), 0.05);

    if (focused) {
      const vp = viewpoint(focused);
      camera.position.lerp(new THREE.Vector3(vp.position[0], vp.position[1], vp.position[2]), 1 - Math.exp(-delta * 4));
      const m = new THREE.Matrix4().lookAt(camera.position, new THREE.Vector3(vp.lookAt[0], vp.lookAt[1], vp.lookAt[2]), new THREE.Vector3(0, 1, 0));
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      camera.quaternion.slerp(q, 1 - Math.exp(-delta * 4));
      const e = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
      yaw = e.y; pitch = e.x;
    } else {
      camera.rotation.set(pitch, yaw, 0, "YXZ");
      const input = new THREE.Vector2(joy.x, joy.y);
      if (keys.KeyW || keys.ArrowUp) input.y += 1;
      if (keys.KeyS || keys.ArrowDown) input.y -= 1;
      if (keys.KeyA || keys.ArrowLeft) input.x -= 1;
      if (keys.KeyD || keys.ArrowRight) input.x += 1;
      if (input.lengthSq() > 1) input.normalize();

      const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const vel = fwd.multiplyScalar(input.y).add(right.multiplyScalar(input.x)).multiplyScalar(SPEED);

      if (moveTarget && input.lengthSq() < 0.01) {
        const to = new THREE.Vector3(moveTarget[0] - camera.position.x, 0, moveTarget[1] - camera.position.z);
        if (to.length() < 0.25) moveTarget = null;
        else vel.copy(to.normalize().multiplyScalar(SPEED));
      } else if (input.lengthSq() >= 0.01) {
        moveTarget = null;
      }

      if (vel.lengthSq() > 0) {
        const next = camera.position.clone().addScaledVector(vel, delta);
        const p = collide(next);
        camera.position.set(p.x, EYE, p.z);
        const room = roomAt(p.x, p.z);
        if (room && room.index !== activeRoomIndex) {
          activeRoomIndex = room.index;
          applyRig(room.lightingRig);
          roomLabelEl.textContent = room.chapterLabel || room.name || "";
          updateMiniMap();
        }
      }
    }

    resize();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  function resize() {
    const w = app.clientWidth;
    const h = app.clientHeight;
    if (renderer.domElement.width !== w || renderer.domElement.height !== h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  applyRig(layout.rooms[0].lightingRig);
  roomLabelEl.textContent = layout.rooms[0].chapterLabel || layout.rooms[0].name || "";
  frame();
}

function buildRoom(scene, room, floorMeshes) {
  const [cx, cz] = room.center;
  const halfW = room.width / 2;
  const halfD = room.depth / 2;
  const wallMat = new THREE.MeshStandardMaterial({ color: room.wallColor, roughness: 0.95 });
  const T = 0.15;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(room.width, room.depth),
    new THREE.MeshStandardMaterial({ color: FLOOR_COLORS[room.floorMaterial] || 0xcdb48c, roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cz);
  scene.add(floor);
  floorMeshes.push(floor);

  if (!room.archetype.outdoor) {
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(room.width, room.depth),
      new THREE.MeshStandardMaterial({ color: room.archetype.palette.ceiling, roughness: 1 }),
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(cx, room.ceiling, cz);
    scene.add(ceil);
  }

  const sides = [
    { side: "north", len: room.width, pos: [cx, 0, cz - halfD], rot: 0 },
    { side: "south", len: room.width, pos: [cx, 0, cz + halfD], rot: Math.PI },
    { side: "west", len: room.depth, pos: [cx - halfW, 0, cz], rot: Math.PI / 2 },
    { side: "east", len: room.depth, pos: [cx + halfW, 0, cz], rot: -Math.PI / 2 },
  ];
  for (const s of sides) {
    const doors = room.doors.filter((d) => d.side === s.side);
    const group = new THREE.Group();
    group.position.set(s.pos[0], 0, s.pos[2]);
    group.rotation.y = s.rot;
    if (doors.length === 0) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(s.len, room.ceiling, T), wallMat);
      wall.position.set(0, room.ceiling / 2, 0);
      group.add(wall);
    } else {
      for (const door of doors) {
        const dl = door.offset - door.width / 2;
        const dr = door.offset + door.width / 2;
        const leftLen = dl + s.len / 2;
        const rightLen = s.len / 2 - dr;
        if (leftLen > 0.01) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(leftLen, room.ceiling, T), wallMat);
          m.position.set(-s.len / 2 + leftLen / 2, room.ceiling / 2, 0);
          group.add(m);
        }
        if (rightLen > 0.01) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(rightLen, room.ceiling, T), wallMat);
          m.position.set(s.len / 2 - rightLen / 2, room.ceiling / 2, 0);
          group.add(m);
        }
        const lintelH = room.ceiling - door.height;
        if (lintelH > 0.01) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(door.width, lintelH, T), wallMat);
          m.position.set(door.offset, door.height + lintelH / 2, 0);
          group.add(m);
        }
      }
    }
    scene.add(group);
  }
}

function buildArtwork(placed, texLoader) {
  const frame = window.GALLERY_DATA.frames[placed.artwork.frameStyle] ||
    Object.values(window.GALLERY_DATA.frames)[0];
  const group = new THREE.Group();
  group.position.set(placed.position[0], placed.position[1], placed.position[2]);
  group.rotation.y = placed.rotationY;

  const w = placed.width;
  const h = placed.height;
  const outerW = w * (1 + frame.matte * 2) + frame.barWidth * 2;
  const outerH = h * (1 + frame.matte * 2) + frame.barWidth * 2;

  if (frame.barWidth > 0) {
    const mat = new THREE.MeshStandardMaterial({
      color: frame.color, metalness: frame.metalness, roughness: frame.roughness,
    });
    const bw = frame.barWidth;
    const bars = [
      [[0, outerH / 2 - bw / 2], [outerW, bw]],
      [[0, -outerH / 2 + bw / 2], [outerW, bw]],
      [[-outerW / 2 + bw / 2, 0], [bw, outerH - bw * 2]],
      [[outerW / 2 - bw / 2, 0], [bw, outerH - bw * 2]],
    ];
    for (const [[x, y], [bx, by]] of bars) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bx, by, frame.depth), mat);
      m.position.set(x, y, frame.depth / 2);
      group.add(m);
    }
  }
  if (frame.matte > 0) {
    const matte = new THREE.Mesh(
      new THREE.PlaneGeometry(outerW - frame.barWidth * 2, outerH - frame.barWidth * 2),
      new THREE.MeshStandardMaterial({ color: frame.matteColor, roughness: 0.95 }),
    );
    matte.position.z = frame.depth * 0.35;
    group.add(matte);
  }

  const canvasMat = new THREE.MeshStandardMaterial({
    color: (placed.artwork.dominantColors && placed.artwork.dominantColors[0]) || "#d8d5cc",
    roughness: 0.85,
  });
  const canvas = new THREE.Mesh(new THREE.PlaneGeometry(w, h), canvasMat);
  canvas.position.z = frame.depth * 0.5 + 0.002;
  canvas.userData.isCanvas = true;
  group.add(canvas);

  const url = placed.artwork.urls.wall || placed.artwork.urls.thumb;
  if (url) {
    texLoader.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      canvasMat.map = tex;
      canvasMat.color.set(0xffffff);
      canvasMat.needsUpdate = true;
    });
  }
  return group;
}

function viewpoint(placed) {
  const d = 2.2;
  const dx = Math.sin(placed.rotationY) * d;
  const dz = Math.cos(placed.rotationY) * d;
  return {
    position: [placed.position[0] + dx, EYE, placed.position[2] + dz],
    lookAt: placed.position,
  };
}

function collide(next) {
  const p = { x: next.x, z: next.z };
  for (let pass = 0; pass < 2; pass++) {
    for (const seg of DATA.layout.walls) {
      const ax = seg.a[0], az = seg.a[1], bx = seg.b[0], bz = seg.b[1];
      const abx = bx - ax, abz = bz - az;
      const lenSq = abx * abx + abz * abz || 1e-9;
      let t = ((p.x - ax) * abx + (p.z - az) * abz) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const cx2 = ax + abx * t, cz2 = az + abz * t;
      const dx = p.x - cx2, dz = p.z - cz2;
      const dist = Math.hypot(dx, dz);
      if (dist < RADIUS && dist > 1e-6) {
        p.x += (dx / dist) * (RADIUS - dist);
        p.z += (dz / dist) * (RADIUS - dist);
      }
    }
  }
  return new THREE.Vector3(p.x, next.y, p.z);
}

function roomAt(x, z) {
  for (const room of DATA.layout.rooms) {
    if (
      Math.abs(x - room.center[0]) <= room.width / 2 + 0.3 &&
      Math.abs(z - room.center[1]) <= room.depth / 2 + 0.3
    ) return room;
  }
  return null;
}

/* ------------------------------- mini-map ------------------------------- */

let mapTeleport = null;

function renderMiniMap(onTeleport) {
  mapTeleport = onTeleport;
  updateMiniMap();
}

function updateMiniMap() {
  const rooms = DATA.layout.rooms;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const r of rooms) {
    minX = Math.min(minX, r.center[0] - r.width / 2);
    maxX = Math.max(maxX, r.center[0] + r.width / 2);
    minZ = Math.min(minZ, r.center[1] - r.depth / 2);
    maxZ = Math.max(maxZ, r.center[1] + r.depth / 2);
  }
  const pad = 1;
  const svgNS = "http://www.w3.org/2000/svg";
  mapEl.innerHTML = "";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `${minX - pad} ${minZ - pad} ${maxX - minX + pad * 2} ${maxZ - minZ + pad * 2}`);
  for (const r of rooms) {
    const rect = document.createElementNS(svgNS, "rect");
    rect.setAttribute("x", r.center[0] - r.width / 2);
    rect.setAttribute("y", r.center[1] - r.depth / 2);
    rect.setAttribute("width", r.width);
    rect.setAttribute("height", r.depth);
    rect.setAttribute("fill", r.index === activeRoomIndex ? "rgba(250,244,225,0.85)" : "rgba(255,255,255,0.18)");
    rect.setAttribute("stroke", "rgba(255,255,255,0.6)");
    rect.setAttribute("stroke-width", "0.12");
    rect.style.cursor = "pointer";
    rect.addEventListener("click", () => mapTeleport && mapTeleport(r.center));
    svg.appendChild(rect);
    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", r.center[0]);
    label.setAttribute("y", r.center[1]);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "middle");
    label.setAttribute("font-size", Math.min(1.1, r.width / 7));
    label.setAttribute("fill", r.index === activeRoomIndex ? "#1c1b18" : "#efeee8");
    label.style.pointerEvents = "none";
    label.textContent = r.name || "";
    svg.appendChild(label);
  }
  mapEl.appendChild(svg);
}

/* ------------------------------- joystick ------------------------------- */

function setupJoystick(joy) {
  if (!window.matchMedia("(pointer: coarse)").matches) return;
  const base = document.getElementById("joystick");
  base.style.display = "block";
  let active = false;
  function update(e) {
    if (!active) return;
    const rect = base.getBoundingClientRect();
    const dx = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const dy = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    const len = Math.hypot(dx, dy) || 1;
    joy.x = len > 1 ? dx / len : dx;
    joy.y = -(len > 1 ? dy / len : dy);
  }
  base.addEventListener("pointerdown", (e) => { active = true; base.setPointerCapture(e.pointerId); update(e); });
  base.addEventListener("pointermove", update);
  const stop = () => { active = false; joy.x = 0; joy.y = 0; };
  base.addEventListener("pointerup", stop);
  base.addEventListener("pointercancel", stop);
}

/* -------------------------------- boot ---------------------------------- */

function setMode(next) {
  mode = next;
  if (mode === "list") {
    app.style.display = "none";
    document.getElementById("hud").style.display = "none";
    listEl.style.display = "grid";
    toggleBtn.textContent = "Walk the gallery";
  } else {
    listEl.style.display = "none";
    app.style.display = "block";
    document.getElementById("hud").style.display = "block";
    toggleBtn.textContent = "List view";
    if (!renderer) startScene();
  }
}

renderList();
if (!supportsWebGL2()) {
  toggleBtn.style.display = "none";
}
toggleBtn.addEventListener("click", () => setMode(mode === "walk" ? "list" : "walk"));
setMode(mode);
