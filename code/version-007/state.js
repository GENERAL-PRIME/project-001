// state.js — Global state, configuration constants, and pure helper accessors.

const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
const wp = document.getElementById("wp");

const CONFIG = {
  LANE_WIDTH: 14, // Visual width of a single lane (in pixels)
  NODE_RADIUS: 18, // Radius of intersection nodes (in pixels)
  CAR_LENGTH: 10, // Visual length of a car (in pixels)
  CAR_WIDTH: 5.5, // Visual width of a car (in pixels)
  ARROW_GAP: 200, // Distance from node center to draw turn arrows (in pixels)
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
  MAX_CARS: 220, // Absolute max number of cars in the simulation to prevent browser overload.
  MAX_DT: 0.05, // Max physics timestep to prevent instability during lag spikes.
  FIXED_STEP: 0.016, // Fixed physics timestep (in seconds) for consistent simulation updates (60 FPS).
  EWA_DECAY: 0.8, // Decay factor for exponentially weighted averages (e.g. wait times, throughput).
  EWA_NEW_WEIGHT: 0.2, // Weight for new samples in exponentially weighted averages (e.g. wait times, throughput).
  VOLUME_FLOOR: 0.1, // Minimum traffic volume to prevent zero-division and keep some AI learning signal.
  MIN_GREEN_SEC: 4, // Minimum green light duration to prevent excessively rapid switching.
  ALL_RED_SEC: 1.5, // All-red duration between light changes for safety.
  PREEMPT_HOLD_SEC: 15, // Minimum time to hold preemptive green for emergency vehicles to ensure they can clear the intersection.
  WATCHDOG_TIMEOUT: 300, // Time in seconds to reset the simulation if it appears stuck (e.g. due to a bug causing cars to freeze).
  SAVE_DEBOUNCE_MS: 500, // Debounce delay for auto-saving state to localStorage after changes.
  METRICS_WINDOW: 60, // Number of samples to include in the metrics window.
  POISSON_MEAN: 0.3, //Probability coefficient (λ) for modeling bursty vehicle arrivals.
  SAFE_GAP: 25, // Minimum safe gap between cars to prevent collisions (in pixels)
  STOP_LINE_DIST: 60, // Distance from node center to stop line where cars must wait when red (in pixels)
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
