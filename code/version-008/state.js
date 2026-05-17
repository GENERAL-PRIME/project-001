// state.js — Global state, configuration constants, and pure helper accessors.
// NOTE: Persistence is now handled by areas.js (initAreas / snapshotActiveArea).
//       saveState() here still debounce-commits the live area for backward compat
//       with all the call-sites in main.js.

const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
const wp = document.getElementById("wp");

// ─── VISUAL CONFIGURATION ─────────────────────────────────────────────────────
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

// ─── SIMULATION CONFIGURATION ─────────────────────────────────────────────────
const SIM_CONFIG = {
  MAX_CARS: 220,
  SAFE_GAP: 25,
  STOP_LINE_DIST: 70,
  STOP_PIN_DIST: 32,

  MAX_DT: 0.05,
  FIXED_STEP: 0.016,

  EWA_DECAY: 0.8,
  VOLUME_FLOOR: 0.1,
  MIN_GREEN_SEC: 4,
  MAX_GREEN_SEC: 60,
  ALL_RED_SEC: 1.5,
  PREEMPT_HOLD_SEC: 15,
  WATCHDOG_TIMEOUT: 300,

  SAVE_DEBOUNCE_MS: 500,
  METRICS_WINDOW: 60,
  POISSON_MEAN: 0.3,
};

// ─── GLOBAL APPLICATION STATE ─────────────────────────────────────────────────
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
    pendingNewNode: null,
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

// ─── ACCESSOR FUNCTIONS ───────────────────────────────────────────────────────
const getNode = (id) => {
  if (!isValidId(id)) return undefined;
  return State.nodes.find((n) => n.id === id);
};

const getEdge = (id) => {
  if (!isValidId(id)) return undefined;
  return State.edges.find((e) => e.id === id);
};

// ─── STATE MANAGEMENT ────────────────────────────────────────────────────────
function sanitizeState() {
  let maxId = 0;

  State.nodes.forEach((n) => {
    if (n.id > maxId) maxId = n.id;
    if (!n.banned_turns) n.banned_turns = [];
    if (n.ctrl === "signalized" && !n.lights) n.lights = [];
    if (n.ctrl !== "signalized" && n.lights !== undefined) delete n.lights;
    if (!n.ctrl) n.ctrl = "uncontrolled";
    if (typeof n.cycle !== "number" || n.cycle < 10) n.cycle = 120;
    if (!n.lbl) n.lbl = `Node ${n.id}`;
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

/**
 * Debounced save: commits live State into the active area record, then
 * persists all areas to localStorage via areas.js.
 */
function saveState() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    if (typeof snapshotActiveArea === "function") {
      snapshotActiveArea();
      if (typeof saveAreas === "function") saveAreas();
    }
  }, SIM_CONFIG.SAVE_DEBOUNCE_MS);
}

/**
 * loadState is now a no-op stub — initAreas() in areas.js handles bootstrap.
 * Kept so any legacy call-sites don't throw.
 */
function loadState() {
  // Intentional no-op: see initAreas() in areas.js
}

// ─── EXPORT / IMPORT ──────────────────────────────────────────────────────────

/**
 * Resets per-node simulation accumulators (throughput, totalWait) on a given
 * nodes array. Called whenever a simulation run is stopped so that stats shown
 * in the inspector always reflect only the most recent run.
 * @param {Array} nodes
 */
function resetNodeSimStats(nodes) {
  (nodes || []).forEach((n) => {
    n.throughput = 0;
    n.totalWait = 0;
  });
}
function exportMap() {
  const cleanNodes = State.nodes.map((n) => {
    const node = deepClone(n);
    delete node.ai;
    delete node.edgeStats;
    delete node.activeGreenEdge;
    delete node.phases;
    delete node.phaseTimer;
    return node;
  });

  const data = {
    nodes: cleanNodes,
    edges: State.edges,
    nextId: State.nextId,
    nodeCount: State.nodeCount,
  };

  const areaName =
    typeof ActiveAreaId !== "undefined" && typeof Areas !== "undefined"
      ? Areas.get(ActiveAreaId)?.name || "area"
      : "traffic_map";

  const filename = areaName.replace(/\s+/g, "_").toLowerCase() + "_backup.json";
  downloadFile(filename, JSON.stringify(data, null, 2), "application/json");
}

function importMap(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    const data = safeJsonParse(e.target.result);

    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      alert("Invalid map file! Ensure it contains 'nodes' and 'edges' arrays.");
      return;
    }

    const nodesValid = data.nodes.every((n) => isValidNode(n));
    const edgesValid = data.edges.every((e) => isValidEdge(e));

    if (!nodesValid || !edgesValid) {
      alert("Map file contains invalid nodes or edges!");
      return;
    }

    // S5: Verify every edge references nodes that actually exist in this file.
    const nodeIdSet = new Set(data.nodes.map((n) => n.id));
    const edgesReferenceValid = data.edges.every(
      (e) => nodeIdSet.has(e.from) && nodeIdSet.has(e.to),
    );
    if (!edgesReferenceValid) {
      alert(
        "Map file contains edges that reference missing nodes. The file may be corrupted.",
      );
      return;
    }

    State.nodes = data.nodes;
    State.edges = data.edges;
    State.nextId = data.nextId || data.nid || 1;
    State.nodeCount = data.nodeCount || data.nc || 0;
    State.cars = [];
    sanitizeState();
    saveState();
  };

  reader.readAsText(file);
  event.target.value = "";
}
