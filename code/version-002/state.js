// state.js
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
  },
  simulation: { isRunning: false, lastTime: 0 },
};

const getNode = (id) => State.nodes.find((n) => n.id === id);
const getEdge = (id) => State.edges.find((e) => e.id === id);

// --- NEW: Auto-Fixer to prevent ID Collisions & Data Corruption ---
function sanitizeState() {
  let maxId = 0;

  // Find the highest ID currently in use and apply missing default properties
  State.nodes.forEach((n) => {
    if (n.id > maxId) maxId = n.id;
    if (!n.banned_turns) n.banned_turns = [];
    if (!n.lights) n.lights = [];
  });
  State.edges.forEach((e) => {
    if (e.id > maxId) maxId = e.id;
  });

  // Force the next ID to be strictly higher than anything that exists
  if (State.nextId <= maxId) State.nextId = maxId + 1;

  // Fix the label alphabet counter
  if (!State.nodeCount || State.nodeCount < State.nodes.length) {
    State.nodeCount = State.nodes.length;
  }
}

function saveState() {
  const data = {
    nodes: State.nodes,
    edges: State.edges,
    nextId: State.nextId,
    nodeCount: State.nodeCount,
  };
  localStorage.setItem("trafficMapSave", JSON.stringify(data));
}

function loadState() {
  const saved = localStorage.getItem("trafficMapSave");
  if (saved) {
    try {
      const data = JSON.parse(saved);
      State.nodes = data.nodes || [];
      State.edges = data.edges || [];

      // Read from the new variables OR fallback to the old 'nid' variables
      State.nextId = data.nextId || data.nid || 1;
      State.nodeCount = data.nodeCount || data.nc || 0;

      sanitizeState(); // Clean up the data immediately upon loading
    } catch (e) {
      console.error("Failed to load map save", e);
    }
  }
}

function exportMap() {
  const data = JSON.stringify(
    {
      nodes: State.nodes,
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

      sanitizeState(); // Clean up the data upon import
      saveState();
    } catch (err) {
      alert("Invalid map file!");
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}
