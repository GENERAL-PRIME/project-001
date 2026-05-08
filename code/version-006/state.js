// state.js — Global state, configuration constants, and pure helper accessors.

const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
const wp = document.getElementById("wp");

const CONFIG = {
  LANE_WIDTH: 14,
  NODE_RADIUS: 18,
  CAR_LENGTH: 10,
  CAR_WIDTH: 5.5,
  ARROW_GAP: 200,
  COLORS: {
    bg: "#080d16",
    grid: "#0d1522",
    road: "#111b2b",
    roadEdge: "#1c2e44",
    divider: "rgba(255,210,50,0.4)",
    laneLine: "rgba(255,255,255,0.14)",
    nodeBg: "#091c30",
    nodeBorder: "#1a90b8",
    text: "#2ec4e8",
    outArrow: "#30d870",
    inArrow: "#ff6535",
    select: "#f5c518",
    emergency: "#ff00aa",
    cars: [
      "#ff6b35",
      "#ffd166",
      "#06d6a0",
      "#4fc9e8",
      "#ef476f",
      "#c39be8",
      "#f9cb42",
      "#2dde8a",
    ],
  },
};

// All core physics and AI thresholds
const SIM_CONFIG = {
  MAX_CARS: 220,
  MAX_DT: 0.05,
  FIXED_STEP: 0.016,
  EWA_DECAY: 0.8,
  EWA_NEW_WEIGHT: 0.2,
  VOLUME_FLOOR: 0.1,
  MIN_GREEN_SEC: 4,
  ALL_RED_SEC: 1.5,
  PREEMPT_HOLD_SEC: 15,
  WATCHDOG_TIMEOUT: 300,
  SAVE_DEBOUNCE_MS: 500,
  METRICS_WINDOW: 60,
  POISSON_MEAN: 0.3,
  SAFE_GAP: 25, // The physical distance cars maintain between each other
  STOP_LINE_DIST: 35, // Distance from intersection where braking begins
};

let State = {
  nodes: [],
  edges: [],
  cars: [],
  nextId: 1,
  nodeCount: 0,
  camera: { x: 0, y: 0, zoom: 1 },
  interaction: {
    mode: "pan",
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    camStartX: 0,
    camStartY: 0,
    hoverCoords: null,
    routeFromNode: null,
    selected: null,
    pendingEdge: null,
    pendingNode: null,
    pendingEditEdge: null,
  },
  simulation: {
    isRunning: false,
    lastTime: 0,
    accumulator: 0,
    clock: 0,
  },
  metrics: {
    totalThroughput: 0,
    totalWaitTime: 0,
    history: [],
    lastSample: 0,
  },
};

const getNode = (id) => State.nodes.find((n) => n.id === id);
const getEdge = (id) => State.edges.find((e) => e.id === id);

function sanitizeState() {
  let maxId = 0;
  State.nodes.forEach((n) => {
    if (n.id > maxId) maxId = n.id;
    if (!n.banned_turns) n.banned_turns = [];
    if (!n.lights) n.lights = [];
  });
  State.edges.forEach((e) => {
    if (e.id > maxId) maxId = e.id;
  });
  if (State.nextId <= maxId) State.nextId = maxId + 1;
  if (!State.nodeCount || State.nodeCount < State.nodes.length) {
    State.nodeCount = State.nodes.length;
  }
}

let _saveTimer = null;
function saveState() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    const data = {
      nodes: State.nodes,
      edges: State.edges,
      nextId: State.nextId,
      nodeCount: State.nodeCount,
    };
    try {
      localStorage.setItem("trafficMapSave_v6", JSON.stringify(data));
    } catch (e) {
      console.warn("Save failed:", e);
    }
  }, SIM_CONFIG.SAVE_DEBOUNCE_MS);
}

function loadState() {
  const raw =
    localStorage.getItem("trafficMapSave_v6") ||
    localStorage.getItem("trafficMapSave");
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    State.nodes = data.nodes || [];
    State.edges = data.edges || [];
    State.nextId = data.nextId || data.nid || 1;
    State.nodeCount = data.nodeCount || data.nc || 0;
    sanitizeState();
  } catch (e) {
    console.error("Failed to load map save", e);
  }
}

function exportMap() {
  const cleanNodes = State.nodes.map((n) => {
    const c = { ...n };
    delete c.ai;
    delete c.edgeStats;
    delete c.activeGreenEdge;
    delete c.phases;
    delete c.phaseTimer;
    return c;
  });
  const data = JSON.stringify(
    {
      nodes: cleanNodes,
      edges: State.edges,
      nextId: State.nextId,
      nodeCount: State.nodeCount,
    },
    null,
    2,
  );
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "traffic_map_backup.json";
  a.click();
  URL.revokeObjectURL(url);
}

function importMap(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      State.nodes = data.nodes || [];
      State.edges = data.edges || [];
      State.nextId = data.nextId || data.nid || 1;
      State.nodeCount = data.nodeCount || data.nc || 0;
      State.cars = [];
      sanitizeState();
      saveState();
    } catch (err) {
      alert("Invalid map file!");
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}
