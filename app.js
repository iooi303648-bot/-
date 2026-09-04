// 블록 월드 - 간단한 마인크래프트 스타일 복셀 게임 (Three.js)

const HALF = 24; // 월드 절반 크기 (-24 ~ 23)
const GRAVITY = 24;
const JUMP_SPEED = 8.5;
const WALK_SPEED = 5.2;
const SPRINT_SPEED = 8.2;
const REACH = 7;
const EYE_HEIGHT = 1.62;
const PLAYER_RADIUS = 0.3;

const BLOCK_TYPES = [
  { id: "grass", name: "잔디", color: 0x5fb14a, capacity: 4000 },
  { id: "dirt", name: "흙", color: 0x8a5a34, capacity: 6000 },
  { id: "stone", name: "돌", color: 0x8a8a8a, capacity: 16000 },
  { id: "sand", name: "모래", color: 0xe4d59b, capacity: 4000 },
  { id: "wood", name: "나무", color: 0x6b4a2c, capacity: 3000 },
  { id: "leaves", name: "나뭇잎", color: 0x2f8f3a, capacity: 3000 },
];

// ---------- 기본 씬 구성 ----------
const canvas = document.getElementById("game-canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const skyColor = 0x8fd0ff;
scene.background = new THREE.Color(skyColor);
scene.fog = new THREE.Fog(skyColor, 28, 60);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.05,
  200
);
camera.rotation.order = "YXZ";

const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff4d6, 0.9);
sunLight.position.set(40, 60, 20);
scene.add(sunLight);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- 월드 데이터 ----------
const world = new Map(); // "x,y,z" -> blockId

function key(x, y, z) {
  return `${x},${y},${z}`;
}

function isSolidAt(x, y, z) {
  return world.has(key(Math.floor(x), Math.floor(y), Math.floor(z)));
}

// 블록 타입별 InstancedMesh 관리
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const blockLayers = {}; // id -> { mesh, positions: [], indexOf: Map, count }

const dummy = new THREE.Object3D();

BLOCK_TYPES.forEach((type) => {
  const material = new THREE.MeshLambertMaterial({ color: type.color });
  const mesh = new THREE.InstancedMesh(boxGeometry, material, type.capacity);
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);
  blockLayers[type.id] = {
    mesh,
    positions: new Array(type.capacity),
    indexOf: new Map(),
    count: 0,
    capacity: type.capacity,
  };
});

function addBlock(x, y, z, typeId) {
  const k = key(x, y, z);
  if (world.has(k)) return;

  const layer = blockLayers[typeId];
  if (layer.count >= layer.capacity) {
    console.warn(`블록 용량 초과: ${typeId}`);
    return;
  }

  const index = layer.count;
  dummy.position.set(x + 0.5, y + 0.5, z + 0.5);
  dummy.updateMatrix();
  layer.mesh.setMatrixAt(index, dummy.matrix);
  layer.positions[index] = k;
  layer.indexOf.set(k, index);
  layer.count += 1;
  layer.mesh.count = layer.count;
  layer.mesh.instanceMatrix.needsUpdate = true;

  world.set(k, typeId);
}

function removeBlock(x, y, z) {
  const k = key(x, y, z);
  const typeId = world.get(k);
  if (!typeId) return;

  const layer = blockLayers[typeId];
  const index = layer.indexOf.get(k);
  const lastIndex = layer.count - 1;

  if (index !== lastIndex) {
    const lastMatrix = new THREE.Matrix4();
    layer.mesh.getMatrixAt(lastIndex, lastMatrix);
    layer.mesh.setMatrixAt(index, lastMatrix);

    const lastKey = layer.positions[lastIndex];
    layer.positions[index] = lastKey;
    layer.indexOf.set(lastKey, index);
  }

  layer.count -= 1;
  layer.mesh.count = layer.count;
  layer.mesh.instanceMatrix.needsUpdate = true;
  layer.indexOf.delete(k);
  world.delete(k);
}

// ---------- 지형 생성 ----------
function terrainHeight(x, z) {
  const h =
    4 +
    3 * Math.sin(x * 0.15) * Math.cos(z * 0.15) +
    2 * Math.sin(x * 0.07 + z * 0.09) +
    1.2 * Math.sin(x * 0.31 - z * 0.23);
  return Math.max(2, Math.round(h));
}

function generateWorld() {
  for (let x = -HALF; x < HALF; x += 1) {
    for (let z = -HALF; z < HALF; z += 1) {
      const height = terrainHeight(x, z);
      for (let y = 0; y < height; y += 1) {
        let typeId;
        if (y === height - 1) {
          typeId = height <= 3 ? "sand" : "grass";
        } else if (y >= height - 3) {
          typeId = "dirt";
        } else {
          typeId = "stone";
        }
        addBlock(x, y, z, typeId);
      }
    }
  }

  // 나무 배치
  let treeCount = 0;
  const maxTrees = 40;
  for (let attempt = 0; attempt < 400 && treeCount < maxTrees; attempt += 1) {
    const x = Math.floor(Math.random() * (HALF * 2 - 6)) - (HALF - 3);
    const z = Math.floor(Math.random() * (HALF * 2 - 6)) - (HALF - 3);
    if (Math.abs(x) <= 4 && Math.abs(z) <= 4) continue; // 스폰 지점 주변엔 나무 안 심음
    const height = terrainHeight(x, z);
    if (height <= 3) continue; // 모래밭엔 나무 안 심음
    if (world.get(key(x, height - 1, z)) !== "grass") continue;

    const trunkHeight = 3 + Math.floor(Math.random() * 2);
    for (let ty = 0; ty < trunkHeight; ty += 1) {
      addBlock(x, height + ty, z, "wood");
    }
    const leafBaseY = height + trunkHeight - 1;
    for (let lx = -2; lx <= 2; lx += 1) {
      for (let lz = -2; lz <= 2; lz += 1) {
        for (let ly = 0; ly <= 2; ly += 1) {
          if (Math.abs(lx) === 2 && Math.abs(lz) === 2) continue;
          if (lx === 0 && lz === 0 && ly < 2) continue;
          const bx = x + lx;
          const by = leafBaseY + ly;
          const bz = z + lz;
          if (!world.has(key(bx, by, bz))) {
            addBlock(bx, by, bz, "leaves");
          }
        }
      }
    }
    treeCount += 1;
  }
}

generateWorld();

// ---------- 플레이어 ----------
const spawnHeight = terrainHeight(0, 0);
const player = {
  x: 0.5,
  y: spawnHeight + 3,
  z: 0.5,
  velocityY: 0,
  yaw: 0,
  pitch: 0,
  grounded: false,
};

function isCollidingAt(px, py, pz) {
  const r = PLAYER_RADIUS;
  const offsets = [-r, r];
  const heights = [0.08, 1.0, 1.72];
  for (const dx of offsets) {
    for (const dz of offsets) {
      for (const dy of heights) {
        if (isSolidAt(px + dx, py + dy, pz + dz)) return true;
      }
    }
  }
  return false;
}

// ---------- 입력 ----------
const keysDown = new Set();
let selectedSlot = 0;

document.addEventListener("keydown", (event) => {
  keysDown.add(event.code);
  const num = parseInt(event.key, 10);
  if (num >= 1 && num <= BLOCK_TYPES.length) {
    selectedSlot = num - 1;
    updateHotbarUI();
  }
});
document.addEventListener("keyup", (event) => {
  keysDown.delete(event.code);
});

window.addEventListener("wheel", (event) => {
  if (document.pointerLockElement !== canvas) return;
  const dir = event.deltaY > 0 ? 1 : -1;
  selectedSlot = (selectedSlot + dir + BLOCK_TYPES.length) % BLOCK_TYPES.length;
  updateHotbarUI();
});

const overlay = document.getElementById("overlay");
const startButton = document.getElementById("start-button");

startButton.addEventListener("click", () => {
  canvas.requestPointerLock();
});

canvas.addEventListener("click", () => {
  if (document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
  }
});

document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === canvas) {
    overlay.classList.add("hidden");
  } else {
    overlay.classList.remove("hidden");
  }
});

document.addEventListener("mousemove", (event) => {
  if (document.pointerLockElement !== canvas) return;
  const sensitivity = 0.0022;
  player.yaw -= event.movementX * sensitivity;
  player.pitch -= event.movementY * sensitivity;
  const limit = Math.PI / 2 - 0.01;
  player.pitch = Math.max(-limit, Math.min(limit, player.pitch));
});

canvas.addEventListener("contextmenu", (event) => event.preventDefault());

canvas.addEventListener("mousedown", (event) => {
  if (document.pointerLockElement !== canvas) return;
  if (event.button === 0) {
    breakBlock();
  } else if (event.button === 2) {
    placeBlock();
  }
});

// ---------- 레이캐스트로 블록 부수기/놓기 ----------
const raycaster = new THREE.Raycaster();
raycaster.far = REACH;
const allMeshes = BLOCK_TYPES.map((t) => blockLayers[t.id].mesh);
const meshToType = new Map(BLOCK_TYPES.map((t) => [blockLayers[t.id].mesh, t.id]));

function pickTargetBlock() {
  raycaster.set(camera.position, camera.getWorldDirection(new THREE.Vector3()));
  const hits = raycaster.intersectObjects(allMeshes, false);
  if (hits.length === 0) return null;
  const hit = hits[0];
  const typeId = meshToType.get(hit.object);
  const layer = blockLayers[typeId];
  const posKey = layer.positions[hit.instanceId];
  const [bx, by, bz] = posKey.split(",").map(Number);
  return { x: bx, y: by, z: bz, normal: hit.face.normal.clone(), typeId };
}

function breakBlock() {
  const target = pickTargetBlock();
  if (!target) return;
  removeBlock(target.x, target.y, target.z);
}

function placeBlock() {
  const target = pickTargetBlock();
  if (!target) return;
  const nx = target.x + Math.round(target.normal.x);
  const ny = target.y + Math.round(target.normal.y);
  const nz = target.z + Math.round(target.normal.z);

  if (world.has(key(nx, ny, nz))) return;

  // 플레이어가 서 있는 칸에는 블록을 놓지 않음
  const overlapsPlayer =
    nx === Math.floor(player.x) &&
    nz === Math.floor(player.z) &&
    (ny === Math.floor(player.y + 0.08) ||
      ny === Math.floor(player.y + 1.0) ||
      ny === Math.floor(player.y + 1.72));
  if (overlapsPlayer) return;

  const typeId = BLOCK_TYPES[selectedSlot].id;
  addBlock(nx, ny, nz, typeId);
}

// ---------- 핫바 UI ----------
const hotbar = document.getElementById("hotbar");
function buildHotbarUI() {
  hotbar.innerHTML = "";
  BLOCK_TYPES.forEach((type, i) => {
    const slot = document.createElement("div");
    slot.className = "hotbar-slot";
    slot.innerHTML = `<span class="key">${i + 1}</span><span class="swatch" style="background:#${type.color
      .toString(16)
      .padStart(6, "0")}"></span>`;
    slot.title = type.name;
    slot.addEventListener("click", () => {
      selectedSlot = i;
      updateHotbarUI();
    });
    hotbar.appendChild(slot);
  });
  updateHotbarUI();
}

function updateHotbarUI() {
  [...hotbar.children].forEach((slot, i) => {
    slot.classList.toggle("active", i === selectedSlot);
  });
}

buildHotbarUI();

// ---------- 게임 루프 ----------
const posDisplay = document.getElementById("pos-display");
const clock = new THREE.Clock();

function updatePlayer(dt) {
  const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));

  let moveX = 0;
  let moveZ = 0;
  if (keysDown.has("KeyW")) {
    moveX += forward.x;
    moveZ += forward.z;
  }
  if (keysDown.has("KeyS")) {
    moveX -= forward.x;
    moveZ -= forward.z;
  }
  if (keysDown.has("KeyD")) {
    moveX += right.x;
    moveZ += right.z;
  }
  if (keysDown.has("KeyA")) {
    moveX -= right.x;
    moveZ -= right.z;
  }

  const len = Math.hypot(moveX, moveZ);
  const speed = keysDown.has("ShiftLeft") || keysDown.has("ShiftRight") ? SPRINT_SPEED : WALK_SPEED;
  if (len > 0) {
    moveX = (moveX / len) * speed * dt;
    moveZ = (moveZ / len) * speed * dt;
  }

  if (!isCollidingAt(player.x + moveX, player.y, player.z)) {
    player.x += moveX;
  }
  if (!isCollidingAt(player.x, player.y, player.z + moveZ)) {
    player.z += moveZ;
  }

  // 중력 & 점프
  player.velocityY -= GRAVITY * dt;
  player.velocityY = Math.max(player.velocityY, -30);
  const dy = player.velocityY * dt;

  if (dy < 0) {
    if (!isCollidingAt(player.x, player.y + dy, player.z)) {
      player.y += dy;
      player.grounded = false;
    } else {
      player.y = Math.round(player.y);
      player.velocityY = 0;
      player.grounded = true;
    }
  } else if (dy > 0) {
    if (!isCollidingAt(player.x, player.y + dy, player.z)) {
      player.y += dy;
    } else {
      player.velocityY = 0;
    }
  }

  if (keysDown.has("Space") && player.grounded) {
    player.velocityY = JUMP_SPEED;
    player.grounded = false;
  }

  // 월드 밖으로 떨어지면 리스폰
  if (player.y < -15) {
    player.x = 0.5;
    player.z = 0.5;
    player.y = terrainHeight(0, 0) + 3;
    player.velocityY = 0;
  }

  camera.position.set(player.x, player.y + EYE_HEIGHT, player.z);
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);

  if (document.pointerLockElement === canvas) {
    updatePlayer(dt);
  }

  posDisplay.textContent = `X: ${player.x.toFixed(1)}  Y: ${player.y.toFixed(1)}  Z: ${player.z.toFixed(1)}`;

  renderer.render(scene, camera);
}

animate();
