// state.js — Global state, configuration constants, and pure helper accessors.

const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
const wp = document.getElementById("wp");

// ─── VISUAL CONFIGURATION ─────────────────────────────────────────────────────
const CONFIG = {
  // Canvas rendering dimensions
  LANE_WIDTH: 14,
  NODE_RADIUS: 18,
  CAR_LENGTH: 10,
  CAR_WIDTH: 5.5,
  ARROW_GAP: 200,

  // Color scheme
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
// All core physics and AI thresholds
const SIM_CONFIG = {
  // Vehicle management
  MAX_CARS: 220,
  SAFE_GAP: 25, // Physical distance cars maintain between each other
  STOP_LINE_DIST: 70, // Distance from intersection where braking begins
  STOP_PIN_DIST: 32, // C2 FIX: Hard stop position (guarantees clearance gap before node)

  // Physics timestep
  MAX_DT: 0.05,
  FIXED_STEP: 0.016,

  // Traffic light AI
  // S1 FIX: Only EWA_DECAY is declared; new-weight is always (1 - EWA_DECAY)
  // so they are guaranteed to sum to 1.0 regardless of future edits.
  EWA_DECAY: 0.8,
  VOLUME_FLOOR: 0.1,
  MIN_GREEN_SEC: 4,
  MAX_GREEN_SEC: 60, // S2 FIX: Cap to prevent single-approach starvation
  ALL_RED_SEC: 1.5,
  PREEMPT_HOLD_SEC: 15,
  WATCHDOG_TIMEOUT: 300,

  // Metrics & storage
  SAVE_DEBOUNCE_MS: 500,
  METRICS_WINDOW: 60,
  POISSON_MEAN: 0.3,
};

// ─── GLOBAL APPLICATION STATE ─────────────────────────────────────────────────
let State = {
  // Graph data
  nodes: [],
  edges: [],
  cars: [],
  nextId: 1,
  nodeCount: 0,

  // Camera/viewport
  camera: {
    x: 0,
    y: 0,
    zoom: 1,
  },

  // User interaction state
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
    pendingNewNode: null, // minor fix: declare in schema so it's visible
  },

  // Simulation runtime
  simulation: {
    isRunning: false,
    lastTime: 0,
    accumulator: 0,
    clock: 0,
  },

  // Performance metrics
  metrics: {
    totalThroughput: 0,
    totalWaitTime: 0,
    history: [],
    lastSample: 0,
  },
};

// ─── ACCESSOR FUNCTIONS ───────────────────────────────────────────────────────
/**
 * Retrieves a node by ID with validation
 * @param {number} id
 * @returns {Object|undefined}
 */
const getNode = (id) => {
  if (!isValidId(id)) return undefined;
  return State.nodes.find((n) => n.id === id);
};

/**
 * Retrieves an edge by ID with validation
 * @param {number} id
 * @returns {Object|undefined}
 */
const getEdge = (id) => {
  if (!isValidId(id)) return undefined;
  return State.edges.find((e) => e.id === id);
};

// ─── STATE MANAGEMENT ──────────────────────────────────────────────────────────
/**
 * Ensures state has proper default values and fixes inconsistencies
 */
function sanitizeState() {
  let maxId = 0;

  // Ensure all nodes have required properties
  State.nodes.forEach((n) => {
    if (n.id > maxId) maxId = n.id;
    if (!n.banned_turns) n.banned_turns = [];
    if (n.ctrl === "signalized" && !n.lights) n.lights = [];
    if (n.ctrl !== "signalized" && n.lights !== undefined) delete n.lights;
    if (!n.ctrl) n.ctrl = "uncontrolled";
    if (!n.cycle) n.cycle = 120;
    if (!n.lbl) n.lbl = `Node ${n.id}`;
  });

  // Track max edge ID
  State.edges.forEach((e) => {
    if (e.id > maxId) maxId = e.id;
  });

  // Update nextId if needed
  if (State.nextId <= maxId) State.nextId = maxId + 1;

  // Update node count
  if (!State.nodeCount || State.nodeCount < State.nodes.length) {
    State.nodeCount = State.nodes.length;
  }
}

let _saveTimer = null;

/**
 * Saves current state to localStorage with debouncing
 */
function saveState() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    const data = {
      nodes: State.nodes,
      edges: State.edges,
      nextId: State.nextId,
      nodeCount: State.nodeCount,
    };
    if (!saveToStorage("trafficMapSave_v6", data)) {
      console.error("Failed to save map state");
    }
  }, SIM_CONFIG.SAVE_DEBOUNCE_MS);
}

/**
 * Loads state from localStorage
 */
function loadState() {
  const data =
    getFromStorage("trafficMapSave_v6") || getFromStorage("trafficMapSave");

  if (!data) return;

  // C1 FIX: Actually validate the loaded data, not a dummy object.
  // Only accept the save if every node and edge passes schema validation.
  const nodesOk =
    Array.isArray(data.nodes) && data.nodes.every((n) => isValidNode(n));
  const edgesOk =
    Array.isArray(data.edges) && data.edges.every((e) => isValidEdge(e));

  if (!nodesOk || !edgesOk) {
    console.error(
      "Corrupt or incompatible save data — refusing to load.",
      "Nodes valid:",
      nodesOk,
      "Edges valid:",
      edgesOk,
    );
    return;
  }

  State.nodes = data.nodes;
  State.edges = data.edges;
  State.nextId = data.nextId || data.nid || 1;
  State.nodeCount = data.nodeCount || data.nc || 0;
  sanitizeState();
}

/**
 * Exports current map to JSON file, excluding runtime AI state
 */
function exportMap() {
  const cleanNodes = State.nodes.map((n) => {
    const node = deepClone(n);
    // Remove runtime AI state that shouldn't be saved
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

  const jsonStr = JSON.stringify(data, null, 2);
  downloadFile("traffic_map_backup.json", jsonStr, "application/json");
}

/**
 * Imports a map from JSON file
 * @param {Event} event - File input change event
 */
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

    // Validate all nodes and edges before importing
    const nodesValid = data.nodes.every((n) => isValidNode(n));
    const edgesValid = data.edges.every((e) => isValidEdge(e));

    if (!nodesValid || !edgesValid) {
      alert("Map file contains invalid nodes or edges!");
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
