// areas.js — Multi-area management with simultaneous simulation across all areas.
//
// DESIGN
// ──────
// Each area owns an AreaSim object that holds its own nodes/edges/cars/clock/metrics.
// The *active* area's AreaSim arrays ARE State.nodes/edges/cars (shared references).
// Background AreaSims tick every frame via tickAllBackgroundAreas() called from main.js.
// Portal transfers move cars between AreaSims directly — no queuing delay.

// ─── STORAGE KEYS ─────────────────────────────────────────────────────────────
const AREAS_KEY = "trafficAreas_v6";
const PORTALS_KEY = "trafficPortals_v6";
const ACTIVE_KEY = "trafficActiveArea_v6";

// ─── RUNTIME ──────────────────────────────────────────────────────────────────
// Areas   : Map<areaId, AreaRecord>  — static graph data + metadata (for persistence)
// AreaSims: Map<areaId, AreaSim>     — live simulation context per area
let Areas = new Map();
let AreaSims = new Map();
let Portals = [];

let ActiveAreaId = null;
let _nextAreaId = 1;
let _nextPortalId = 1;

// ─── AREASIM FACTORY ──────────────────────────────────────────────────────────
/**
 * Creates a fresh AreaSim from a saved AreaRecord.
 * Nodes/edges are deep-cloned so the sim mutates its own copies.
 */
function _createAreaSim(area) {
  return {
    areaId: area.id,
    nodes: area.nodes.map((n) => deepClone(n)),
    edges: area.edges.map((e) => deepClone(e)),
    cars: [],
    nextId: area.nextId,
    clock: 0,
    accumulator: 0,
    lastTickTime: performance.now(),
    isRunning: false,
    // S2: Maps are built lazily on first _simGetNode/_simGetEdge call.
    _nodeMap: null,
    _edgeMap: null,
    _indexDirty: true,
    metrics: {
      totalThroughput: 0,
      totalWaitTime: 0,
      history: [],
      lastSample: 0,
    },
  };
}

/** Snapshots a sim's graph back into its AreaRecord for persistence. */
function _snapshotSimToRecord(areaId) {
  const sim = AreaSims.get(areaId);
  const rec = Areas.get(areaId);
  if (!sim || !rec) return;
  rec.nodes = sim.nodes.map((n) => deepClone(n));
  rec.edges = sim.edges.map((e) => deepClone(e));
  rec.nextId = sim.nextId;
  rec.nodeCount = sim.nodes.length;
}

// ─── STATE BRIDGE ─────────────────────────────────────────────────────────────
// The active AreaSim IS State. We point State's arrays at the sim's arrays so
// all existing simulation/render code works unchanged.

function _bridgeSimToState(sim) {
  State.nodes = sim.nodes;
  State.edges = sim.edges;
  State.cars = sim.cars;
  State.nextId = sim.nextId;
  State.nodeCount = sim.nodes.length;
  State.simulation.isRunning = sim.isRunning;
  State.simulation.clock = sim.clock;
  State.simulation.accumulator = sim.accumulator;
  State.metrics = sim.metrics;
}

/** Sync scalars from State back into the outgoing sim before switching. */
function _bridgeStateToSim(sim) {
  // Arrays are already shared references — only scalars need copying.
  // S3: Include nodeCount so it stays consistent after nodes are added/removed
  // while the sim is active, preventing sanitizeState() from silently
  // overwriting it on the next switch.
  sim.nextId = State.nextId;
  sim.nodeCount = State.nodeCount;
  sim.clock = State.simulation.clock;
  sim.accumulator = State.simulation.accumulator;
  sim.isRunning = State.simulation.isRunning;
  sim.metrics = State.metrics;
}

// ─── AREA CRUD ────────────────────────────────────────────────────────────────
function createArea(name) {
  const id = "area_" + _nextAreaId++;
  const rec = {
    id,
    name: name || `Area ${Areas.size + 1}`,
    nodes: [],
    edges: [],
    nextId: 1,
    nodeCount: 0,
  };
  Areas.set(id, rec);
  AreaSims.set(id, _createAreaSim(rec));
  saveAreas();
  return id;
}

function renameArea(areaId, newName) {
  const area = Areas.get(areaId);
  if (!area) return;
  area.name = newName.trim() || area.name;
  saveAreas();
}

function deleteArea(areaId) {
  if (Areas.size <= 1) {
    alert("Cannot delete the only area. Create another first.");
    return;
  }
  Areas.delete(areaId);
  AreaSims.delete(areaId);
  Portals = Portals.filter(
    (p) => p.a.areaId !== areaId && p.b.areaId !== areaId,
  );
  saveAreas();
  savePortals();
  if (ActiveAreaId === areaId) {
    switchArea(Areas.keys().next().value);
  } else {
    rebuildAreaDropdown();
  }
}

// ─── SWITCH AREA (no sim stop needed) ────────────────────────────────────────
/**
 * Switch the canvas/UI to a different area.
 * The outgoing AreaSim keeps running in the background automatically.
 */
function switchArea(areaId) {
  if (!Areas.has(areaId)) return;

  // Commit live scalars into outgoing sim
  if (ActiveAreaId) {
    const out = AreaSims.get(ActiveAreaId);
    if (out) _bridgeStateToSim(out);
  }

  // Point State at incoming sim
  ActiveAreaId = areaId;
  const incoming = AreaSims.get(areaId);
  incoming.lastTickTime = performance.now(); // reset dt so no time-jump
  _bridgeSimToState(incoming);
  sanitizeState();

  try {
    localStorage.setItem(ACTIVE_KEY, areaId);
  } catch (e) {}

  State.interaction.selected = null;
  hideInspector();
  rebuildAreaDropdown();
  updatePortalBadges();
}

// ─── GLOBAL SIM TOGGLE ────────────────────────────────────────────────────────
/**
 * Starts or stops ALL area sims simultaneously.
 * Call this instead of toggling State.simulation.isRunning directly.
 */
function toggleAllSims() {
  // Sync outgoing scalars before toggling
  const activeSim = AreaSims.get(ActiveAreaId);
  if (activeSim) _bridgeStateToSim(activeSim);

  const newRunning = !State.simulation.isRunning;
  const now = performance.now();

  AreaSims.forEach((sim) => {
    sim.isRunning = newRunning;
    sim.lastTickTime = now;
    if (!newRunning) {
      sim.cars = [];
      sim.clock = 0;
      sim.accumulator = 0;
      sim.metrics = {
        totalThroughput: 0,
        totalWaitTime: 0,
        history: [],
        lastSample: 0,
      };
      // M8: Clear per-node throughput/totalWait accumulators so the inspector
      // always reflects the most recent run rather than a growing lifetime sum.
      if (typeof resetNodeSimStats === "function") resetNodeSimStats(sim.nodes);
    }
  });

  // Re-bridge active sim so State reflects new values
  if (activeSim) _bridgeSimToState(activeSim);

  const btn = document.getElementById("sb");
  if (btn) {
    btn.textContent = newRunning ? "■ STOP" : "▶ SIMULATE";
    btn.classList.toggle("stop", newRunning);
  }

  if (!newRunning) {
    saveState();
    if (State.interaction.selected?.type === "node")
      inspectIntersection(State.interaction.selected.id);
  }

  rebuildAreaDropdown(); // refresh ▶ indicators
}

// ─── BACKGROUND TICK ──────────────────────────────────────────────────────────
/**
 * Called every frame from main.js BEFORE the active-area render step.
 * Advances all non-active AreaSims in real time.
 * @param {number} nowMs - performance.now() value from rAF
 */
function tickAllBackgroundAreas(nowMs) {
  const speedMult = parseFloat(
    document.getElementById("sim-speed")?.value || 1.0,
  );

  AreaSims.forEach((sim, id) => {
    if (id === ActiveAreaId) return; // active area ticked by normal frame() path
    if (!sim.isRunning) return;

    const rawDt = Math.min(
      (nowMs - sim.lastTickTime) / 1000,
      SIM_CONFIG.MAX_DT,
    );
    sim.lastTickTime = nowMs;
    sim.accumulator += rawDt * speedMult;

    const maxSteps = 8;
    let steps = 0;
    while (sim.accumulator >= SIM_CONFIG.FIXED_STEP && steps < maxSteps) {
      sim.clock += SIM_CONFIG.FIXED_STEP;
      sim.accumulator -= SIM_CONFIG.FIXED_STEP;
      steps++;
      _tickSimStep(sim, SIM_CONFIG.FIXED_STEP);
    }
    if (sim.accumulator > SIM_CONFIG.FIXED_STEP * maxSteps) sim.accumulator = 0;
  });
}

/** One fixed-step tick on any AreaSim. */
function _tickSimStep(sim, dt) {
  _simUpdateTrafficLights(sim, dt);
  _simUpdateCars(sim, dt);
  _simSpawnCars(sim);
  _simUpdateMetrics(sim, dt);
}

// ─── SELF-CONTAINED SIM HELPERS ───────────────────────────────────────────────
// Operate on a passed-in AreaSim instead of global State.
// The active area still uses the original global functions in simulation.js.

// S2: Maintain per-sim Maps for O(1) node/edge lookup so the inner car-update
// loop does not scan the full arrays on every iteration.  Maps are rebuilt
// lazily (flagged dirty) and re-indexed at the start of each tick if needed.
function _buildSimIndexes(sim) {
  sim._nodeMap = new Map(sim.nodes.map((n) => [n.id, n]));
  sim._edgeMap = new Map(sim.edges.map((e) => [e.id, e]));
  sim._indexDirty = false;
}

function _markSimIndexDirty(sim) {
  sim._indexDirty = true;
}

function _simGetNode(sim, id) {
  if (sim._indexDirty || !sim._nodeMap) _buildSimIndexes(sim);
  return sim._nodeMap.get(id);
}

function _simGetEdge(sim, id) {
  if (sim._indexDirty || !sim._edgeMap) _buildSimIndexes(sim);
  return sim._edgeMap.get(id);
}

function _simGetEdgeGeometry(sim, edge) {
  if (!edge) return null;
  const A = _simGetNode(sim, edge.from);
  const B = _simGetNode(sim, edge.to);
  if (!A || !B) return null;
  const dx = B.x - A.x,
    dy = B.y - A.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return null;
  return {
    A,
    B,
    length: len,
    logicalLength: edge.len || len,
    ux: dx / len,
    uy: dy / len,
    px: -dy / len,
    py: dx / len,
  };
}

// ── Spawn ──────────────────────────────────────────────────────────────────────
function _simSpawnCars(sim) {
  if (!sim.isRunning || !sim.edges.length) return;
  const density = parseInt(document.getElementById("dn")?.value || 50);
  const target = Math.round((density / 220) * SIM_CONFIG.MAX_CARS);

  // M1 parity: normalise probability so it is always in [0, 1].
  const spawnProbability = Math.min(
    1,
    (SIM_CONFIG.POISSON_MEAN * density) / 220,
  );

  let attempts = 0;
  while (sim.cars.length < target && attempts < 500) {
    attempts++;
    if (Math.random() > spawnProbability) continue;
    const edge = sim.edges[Math.floor(Math.random() * sim.edges.length)];
    const dirs = [];
    if (edge.out > 0) dirs.push("out");
    if (edge.inl > 0) dirs.push("in");
    if (!dirs.length) continue;
    const dir = dirs[Math.floor(Math.random() * dirs.length)];
    sim.cars.push({
      id: sim.nextId++,
      edgeId: edge.id,
      direction: dir,
      lane: Math.floor(Math.random() * (dir === "out" ? edge.out : edge.inl)),
      progress: Math.random() * 0.8,
      baseSpeed: (edge.spd / 50) * 60,
      speed: 0,
      color:
        CONFIG.COLORS.cars[
          Math.floor(Math.random() * CONFIG.COLORS.cars.length)
        ],
      isEmergency: false,
      isStopped: false,
      waitTime: 0,
      tripTime: 0,
    });
  }

  // S4 parity: prefer culling cars at the start of their journey rather than
  // blindly popping from the tail.
  while (sim.cars.length > target) {
    let minProgress = Infinity;
    let minIdx = sim.cars.length - 1;
    for (let k = 0; k < sim.cars.length; k++) {
      if (sim.cars[k].progress < minProgress) {
        minProgress = sim.cars[k].progress;
        minIdx = k;
      }
    }
    sim.cars.splice(minIdx, 1);
  }
}

// ── Traffic lights ─────────────────────────────────────────────────────────────
function _simUpdateTrafficLights(sim, dt) {
  sim.nodes.forEach((node) => {
    if (node.ctrl !== "signalized" || !node.lights?.length) return;

    if (!node.ai?.phaseDurations) {
      const es = (node.cycle || 120) / node.lights.length;
      node.ai = {
        timeInPhase: 0,
        phaseQueue: [...node.lights],
        currentPhaseIndex: 0,
        historicalVolume: {},
        phaseDurations: {},
        memory: {},
        allRedTimer: 0,
        // C4 parity: start in all-red so every intersection clears before
        // issuing its first green (matches simulation.js behaviour).
        inAllRed: true,
        watchdogAccum: 0,
      };
      node.lights.forEach((id) => {
        node.ai.historicalVolume[id] = 1;
        node.ai.phaseDurations[id] = es;
      });
    }

    // Phase queue sync after lights change
    if (node.ai.phaseQueue.length !== node.lights.length) {
      const cur = node.ai.phaseQueue[node.ai.currentPhaseIndex];
      node.ai.phaseQueue = [...node.lights];
      const idx = node.ai.phaseQueue.indexOf(cur);
      if (idx >= 0) {
        node.ai.currentPhaseIndex = idx;
      } else {
        node.activeGreenEdge = null;
        node.ai.inAllRed = true;
        node.ai.allRedTimer = 0;
        node.ai.timeInPhase = 0;
        node.ai.currentPhaseIndex = 0;
      }
      const es = (node.cycle || 120) / node.lights.length;
      node.lights.forEach((id) => {
        if (!node.ai.phaseDurations[id]) node.ai.phaseDurations[id] = es;
        if (!node.ai.historicalVolume[id]) node.ai.historicalVolume[id] = 1;
      });
    }

    if (node.ai.inAllRed) {
      node.activeGreenEdge = null;
      node.ai.allRedTimer += dt;
      if (node.ai.allRedTimer >= SIM_CONFIG.ALL_RED_SEC) {
        node.ai.inAllRed = false;
        node.ai.allRedTimer = 0;
        node.ai.currentPhaseIndex =
          (node.ai.currentPhaseIndex + 1) % node.ai.phaseQueue.length;
        node.activeGreenEdge = node.ai.phaseQueue[node.ai.currentPhaseIndex];
        node.ai.timeInPhase = 0;
        node.ai.watchdogAccum = 0;
      }
      if (!node.edgeStats) node.edgeStats = {};
      _simUpdateEdgeStats(sim, node);
      return;
    }

    node.activeGreenEdge = node.ai.phaseQueue[node.ai.currentPhaseIndex];
    const curDur =
      node.ai.phaseDurations[node.activeGreenEdge] || SIM_CONFIG.MIN_GREEN_SEC;

    // C2 parity: check watchdog BEFORE advancing timers (see simulation.js).
    if (node.ai.watchdogAccum > SIM_CONFIG.WATCHDOG_TIMEOUT) {
      const es = (node.cycle || 120) / Math.max(1, node.lights.length);
      node.lights.forEach((id) => {
        node.ai.phaseDurations[id] = es;
      });
      node.activeGreenEdge = null;
      node.ai.inAllRed = true;
      node.ai.allRedTimer = 0;
      node.ai.watchdogAccum = 0;
      node.ai.timeInPhase = 0;
      node.ai.currentPhaseIndex = 0;
    }

    node.ai.timeInPhase += dt;
    node.ai.watchdogAccum += dt;
    if (!node.edgeStats) node.edgeStats = {};

    if (node.ai.timeInPhase >= curDur) {
      const nextIdx =
        (node.ai.currentPhaseIndex + 1) % node.ai.phaseQueue.length;
      const nextEdgeId = node.ai.phaseQueue[nextIdx];
      let waiting = 0;
      sim.cars.forEach((c) => {
        if (c.edgeId === nextEdgeId && c.isStopped) waiting++;
      });

      const ew = 1 - SIM_CONFIG.EWA_DECAY;
      node.ai.historicalVolume[nextEdgeId] = clamp(
        node.ai.historicalVolume[nextEdgeId] * SIM_CONFIG.EWA_DECAY +
          waiting * ew,
        SIM_CONFIG.VOLUME_FLOOR,
        Infinity,
      );

      let totalW = 0;
      node.lights.forEach((id) => {
        const e = _simGetEdge(sim, id);
        const sw = e ? e.spd / 50 : 1;
        const el = e ? (e.len ?? _simGetEdgeGeometry(sim, e)?.length ?? 1) : 1;
        const cc =
          node.edgeStats?.[id]?.cars || (id === nextEdgeId ? waiting : 0);
        const sat = Math.min(1, cc / Math.max(1, el / SIM_CONFIG.SAFE_GAP));
        totalW +=
          (node.ai.historicalVolume[id] || SIM_CONFIG.VOLUME_FLOOR) *
          sw *
          (1 + sat * 0.5);
      });

      node.lights.forEach((id) => {
        const e = _simGetEdge(sim, id);
        const sw = e ? e.spd / 50 : 1;
        const el = e ? (e.len ?? _simGetEdgeGeometry(sim, e)?.length ?? 1) : 1;
        const cc = node.edgeStats?.[id]?.cars || 0;
        const sat = Math.min(1, cc / Math.max(1, el / SIM_CONFIG.SAFE_GAP));
        const w =
          (node.ai.historicalVolume[id] || SIM_CONFIG.VOLUME_FLOOR) *
          sw *
          (1 + sat * 0.5);
        const prop = totalW > 0 ? w / totalW : 1 / node.lights.length;
        // C3 parity: guard against a negative green budget when ALL_RED_SEC *
        // phases exceeds node.cycle (see simulation.js for full explanation).
        const rawBudget =
          (node.cycle || 120) - SIM_CONFIG.ALL_RED_SEC * node.lights.length;
        const budget = Math.max(
          SIM_CONFIG.MIN_GREEN_SEC * node.lights.length,
          rawBudget,
        );

        node.ai.phaseDurations[id] = clamp(
          prop * budget,
          SIM_CONFIG.MIN_GREEN_SEC,
          SIM_CONFIG.MAX_GREEN_SEC,
        );
        node.ai.memory[id] = node.ai.phaseDurations[id];
      });

      node.activeGreenEdge = null;
      node.ai.inAllRed = true;
      node.ai.allRedTimer = 0;
      node.ai.watchdogAccum = 0;
    }
    _simUpdateEdgeStats(sim, node);
  });
}

function _simUpdateEdgeStats(sim, node) {
  if (!node.lights || !node.ai) return;
  node.lights.forEach((edgeId) => {
    let stopped = 0;
    sim.cars.forEach((c) => {
      if (c.edgeId === edgeId && c.isStopped) stopped++;
    });
    let wait = 0;
    if (node.ai.inAllRed) {
      wait = SIM_CONFIG.ALL_RED_SEC - (node.ai.allRedTimer || 0);
    } else if (node.activeGreenEdge !== edgeId) {
      const ci = node.ai.phaseQueue.indexOf(node.activeGreenEdge);
      const ti = node.ai.phaseQueue.indexOf(edgeId);
      if (ci >= 0 && ti >= 0) {
        wait += Math.max(
          0,
          (node.ai.phaseDurations[node.activeGreenEdge] || 0) -
            (node.ai.timeInPhase || 0),
        );
        let idx = (ci + 1) % node.ai.phaseQueue.length;
        while (idx !== ti) {
          wait +=
            (node.ai.phaseDurations[node.ai.phaseQueue[idx]] || 0) +
            SIM_CONFIG.ALL_RED_SEC;
          idx = (idx + 1) % node.ai.phaseQueue.length;
        }
      }
    }
    node.edgeStats[edgeId] = { cars: stopped, maxWait: wait };
  });
}

// ── Car movement ───────────────────────────────────────────────────────────────
function _simUpdateCars(sim, dt) {
  const geomCache = {};
  for (let i = sim.cars.length - 1; i >= 0; i--) {
    const car = sim.cars[i];
    const edge = _simGetEdge(sim, car.edgeId);
    if (!edge) {
      sim.cars.splice(i, 1);
      continue;
    }

    car.tripTime += dt;
    if (!geomCache[edge.id])
      geomCache[edge.id] = _simGetEdgeGeometry(sim, edge);
    const geom = geomCache[edge.id];
    if (!geom) continue;

    // Car-ahead check
    let targetSpeed = car.baseSpeed,
      minDiff = Infinity,
      carAhead = null;
    for (let j = 0; j < sim.cars.length; j++) {
      if (i === j) continue;
      const o = sim.cars[j];
      if (
        o.edgeId === car.edgeId &&
        o.direction === car.direction &&
        o.lane === car.lane
      ) {
        const d = o.progress - car.progress;
        if (d > 0 && d < minDiff) {
          minDiff = d;
          carAhead = o;
        }
      }
    }

    let isForcedStop = false;
    if (carAhead) {
      const dist = minDiff * geom.logicalLength;
      if (dist < SIM_CONFIG.SAFE_GAP) {
        targetSpeed = 0;
        isForcedStop = true;
      } else if (dist < SIM_CONFIG.SAFE_GAP * 3) {
        const sf = (dist - SIM_CONFIG.SAFE_GAP) / (SIM_CONFIG.SAFE_GAP * 2);
        targetSpeed = Math.min(
          targetSpeed,
          carAhead.speed + (car.baseSpeed - carAhead.speed) * sf,
        );
      }
    }

    const targetNodeId = car.direction === "out" ? edge.to : edge.from;
    const targetNode = _simGetNode(sim, targetNodeId);
    const distToEnd = (1 - car.progress) * geom.logicalLength;
    let isRedLight = false;

    if (targetNode?.ctrl === "signalized") {
      if (
        (targetNode.lights || []).includes(edge.id) &&
        (targetNode.activeGreenEdge !== edge.id || targetNode.ai?.inAllRed)
      )
        isRedLight = true;
    } else if (targetNode?.ctrl === "uncontrolled") {
      let occ = 0;
      sim.cars.forEach((c) => {
        if (c.edgeId !== edge.id && c.progress > 0.8 && c.progress < 1.0) {
          const ce = _simGetEdge(sim, c.edgeId);
          if (ce && (c.direction === "out" ? ce.to : ce.from) === targetNodeId)
            occ++;
        }
      });
      if (occ > 0 && distToEnd < SIM_CONFIG.STOP_LINE_DIST * 2)
        targetSpeed = Math.min(targetSpeed, 10);
    }

    const pin = SIM_CONFIG.STOP_PIN_DIST;
    if (isRedLight) {
      if (distToEnd <= pin) {
        car.progress = 1 - pin / geom.logicalLength;
        targetSpeed = 0;
        isForcedStop = true;
      } else if (distToEnd < SIM_CONFIG.STOP_LINE_DIST) {
        targetSpeed *= Math.max(
          0,
          (distToEnd - pin) / (SIM_CONFIG.STOP_LINE_DIST - pin),
        );
      }
    }

    car.speed = Math.max(0, targetSpeed);
    if (car.speed < 2 || isForcedStop) {
      car.isStopped = true;
      car.speed = 0;
      car.waitTime += dt;
      sim.metrics.totalWaitTime += dt;
    } else {
      car.isStopped = false;
    }

    if (!car.isStopped && !isForcedStop) {
      car.progress += (car.speed * dt) / geom.logicalLength;
      if (isRedLight && distToEnd >= pin)
        car.progress = Math.min(car.progress, 1 - pin / geom.logicalLength);
    }

    if (car.progress >= 1) {
      if (targetNode) {
        targetNode.throughput = (targetNode.throughput || 0) + 1;
        targetNode.totalWait = (targetNode.totalWait || 0) + car.waitTime;
      }
      car.isStopped = false;
      car.waitTime = 0;

      // Portal check
      const connected = sim.edges.filter(
        (e) => e.from === targetNodeId || e.to === targetNodeId,
      );
      if (connected.length === 1) {
        const portal = getPortalForEndpoint(sim.areaId, targetNodeId, edge.id);
        if (portal) {
          const dest = getOtherEndpoint(portal, sim.areaId, targetNodeId);
          _deliverCarToSim(dest.areaId, dest.edgeId, dest.nodeId, car);
          sim.metrics.totalThroughput++;
          sim.cars.splice(i, 1);
          continue;
        }
      }

      // Normal routing
      let nextEdges = sim.edges.filter(
        (x) =>
          x.id !== edge.id &&
          ((x.from === targetNodeId && x.out > 0) ||
            (x.to === targetNodeId && x.inl > 0)),
      );
      if (targetNode?.banned_turns)
        nextEdges = nextEdges.filter(
          (nx) =>
            !targetNode.banned_turns.find(
              (bt) => bt.from === edge.id && bt.to === nx.id,
            ),
        );

      if (!nextEdges.length) {
        sim.metrics.totalThroughput++;
        sim.cars.splice(i, 1);
      } else {
        const nx = nextEdges[Math.floor(Math.random() * nextEdges.length)];
        car.edgeId = nx.id;
        car.progress = 0;
        car.baseSpeed = (nx.spd / 50) * 60;
        if (nx.from === targetNodeId && nx.out > 0) {
          car.direction = "out";
          car.lane = Math.floor(Math.random() * nx.out);
        } else {
          car.direction = "in";
          car.lane = Math.floor(Math.random() * nx.inl);
        }
      }
    }
  }
}

function _simUpdateMetrics(sim, dt) {
  sim.metrics.lastSample += dt;
  if (sim.metrics.lastSample < 1) return;
  sim.metrics.lastSample = 0;
  const avg =
    sim.cars.length > 0
      ? sim.cars.reduce((s, c) => s + c.waitTime, 0) / sim.cars.length
      : 0;
  sim.metrics.history.push({
    t: sim.clock,
    throughput: sim.metrics.totalThroughput,
    avgWait: avg,
  });
  const cutoff = sim.clock - SIM_CONFIG.METRICS_WINDOW;
  while (sim.metrics.history.length && sim.metrics.history[0].t < cutoff)
    sim.metrics.history.shift();
}

// M2: Module-level cache for the dangling-node list built by openPortalManager().
// Using a module variable instead of window._portalDanglingCache avoids
// polluting the global namespace and is resilient if the modal is closed
// without confirming (the cache simply becomes stale and is ignored).
let _portalDanglingCache = [];
function _deliverCarToSim(targetAreaId, edgeId, nodeId, sourceCar) {
  const targetSim = AreaSims.get(targetAreaId);
  if (!targetSim) return;
  const edge = _simGetEdge(targetSim, edgeId);
  if (!edge) return;
  const dir = edge.from === nodeId ? "out" : "in";
  const maxLanes = dir === "out" ? edge.out : edge.inl;
  targetSim.cars.push({
    id: targetSim.nextId++,
    edgeId,
    direction: dir,
    lane: Math.floor(Math.random() * Math.max(1, maxLanes)),
    progress: 0,
    baseSpeed: sourceCar.baseSpeed,
    speed: 0,
    color: sourceCar.color,
    isEmergency: sourceCar.isEmergency || false,
    isStopped: false,
    waitTime: 0,
    tripTime: 0,
    fromPortal: true,
  });
  // If targetAreaId === ActiveAreaId, targetSim.cars IS State.cars, so it's
  // immediately visible on canvas — no extra work needed.
}

// ─── ACTIVE-AREA PORTAL HOOK (called from updateCars in simulation.js) ────────
let _pendingTransfers = [];

function schedulePortalTransfer(car, targetNodeId, edge) {
  const portal = getPortalForEndpoint(ActiveAreaId, targetNodeId, edge.id);
  if (!portal) return false;
  const dest = getOtherEndpoint(portal, ActiveAreaId, targetNodeId);
  _pendingTransfers.push({
    targetAreaId: dest.areaId,
    edgeId: dest.edgeId,
    nodeId: dest.nodeId,
    car,
  });
  return true;
}

function flushPortalTransfers() {
  if (!_pendingTransfers.length) return;
  _pendingTransfers
    .splice(0)
    .forEach(({ targetAreaId, edgeId, nodeId, car }) => {
      _deliverCarToSim(targetAreaId, edgeId, nodeId, car);
    });
}

// ─── DANGLING NODE DETECTION ──────────────────────────────────────────────────
function getDanglingNodes(areaId) {
  const sim = AreaSims.get(areaId || ActiveAreaId);
  if (!sim) return [];
  return sim.nodes
    .map((node) => {
      const connected = sim.edges.filter(
        (e) => e.from === node.id || e.to === node.id,
      );
      return connected.length === 1 ? { node, edge: connected[0] } : null;
    })
    .filter(Boolean);
}

// ─── PORTAL CRUD ──────────────────────────────────────────────────────────────
function createPortal(endpointA, endpointB) {
  Portals = Portals.filter(
    (p) =>
      !_endpointMatches(p.a, endpointA) &&
      !_endpointMatches(p.b, endpointA) &&
      !_endpointMatches(p.a, endpointB) &&
      !_endpointMatches(p.b, endpointB),
  );
  const id = "portal_" + _nextPortalId++;
  Portals.push({ id, a: endpointA, b: endpointB });
  savePortals();
  updatePortalBadges();
  return id;
}

function deletePortal(portalId) {
  Portals = Portals.filter((p) => p.id !== portalId);
  savePortals();
  updatePortalBadges();
}

function _endpointMatches(ep, t) {
  return (
    ep.areaId === t.areaId && ep.nodeId === t.nodeId && ep.edgeId === t.edgeId
  );
}

function getPortalForEndpoint(areaId, nodeId, edgeId) {
  return (
    Portals.find(
      (p) =>
        _endpointMatches(p.a, { areaId, nodeId, edgeId }) ||
        _endpointMatches(p.b, { areaId, nodeId, edgeId }),
    ) || null
  );
}

function getOtherEndpoint(portal, fromAreaId, fromNodeId) {
  return portal.a.areaId === fromAreaId && portal.a.nodeId === fromNodeId
    ? portal.b
    : portal.a;
}

// ─── PERSISTENCE ──────────────────────────────────────────────────────────────
function saveAreas() {
  AreaSims.forEach((_, id) => _snapshotSimToRecord(id));
  try {
    const obj = {};
    Areas.forEach((rec, id) => {
      obj[id] = rec;
    });
    localStorage.setItem(
      AREAS_KEY,
      JSON.stringify({ areas: obj, nextAreaId: _nextAreaId }),
    );
  } catch (e) {
    console.error("saveAreas failed:", e);
  }
}

function savePortals() {
  try {
    localStorage.setItem(
      PORTALS_KEY,
      JSON.stringify({ portals: Portals, nextPortalId: _nextPortalId }),
    );
  } catch (e) {
    console.error("savePortals failed:", e);
  }
}

function loadAreas() {
  try {
    const raw = localStorage.getItem(AREAS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      _nextAreaId = p.nextAreaId || 1;
      Object.values(p.areas || {}).forEach((rec) => Areas.set(rec.id, rec));
    }
  } catch (e) {
    console.error("loadAreas failed:", e);
  }
  try {
    const raw = localStorage.getItem(PORTALS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      _nextPortalId = p.nextPortalId || 1;
      Portals = p.portals || [];
    }
  } catch (e) {
    console.error("loadPortals failed:", e);
  }
}

// ─── BOOTSTRAP ────────────────────────────────────────────────────────────────
function initAreas() {
  loadAreas();

  // First-run migration from old single-map save
  if (Areas.size === 0) {
    const old =
      getFromStorage("trafficMapSave_v6") || getFromStorage("trafficMapSave");
    const id = "area_" + _nextAreaId++;
    Areas.set(id, {
      id,
      name: "Area 1",
      nodes: old?.nodes || [],
      edges: old?.edges || [],
      nextId: old?.nextId || 1,
      nodeCount: old?.nodeCount || 0,
    });
    saveAreas();
  }

  // Build an AreaSim for every area record
  Areas.forEach((rec, id) => AreaSims.set(id, _createAreaSim(rec)));

  // Determine active area
  let targetId = null;
  try {
    targetId = localStorage.getItem(ACTIVE_KEY);
  } catch (e) {}
  if (!targetId || !Areas.has(targetId)) targetId = Areas.keys().next().value;

  ActiveAreaId = targetId;
  AreaSims.get(targetId).lastTickTime = performance.now();
  _bridgeSimToState(AreaSims.get(targetId));
  sanitizeState();
}

/** Called by saveState() in state.js */
function snapshotActiveArea() {
  if (!ActiveAreaId) return;
  _bridgeStateToSim(AreaSims.get(ActiveAreaId));
  _snapshotSimToRecord(ActiveAreaId);
}

// ─── UI ───────────────────────────────────────────────────────────────────────
function rebuildAreaDropdown() {
  const dd = document.getElementById("area-select");
  if (!dd) return;
  dd.innerHTML = "";
  Areas.forEach((area, id) => {
    const opt = document.createElement("option");
    opt.value = id;
    const sim = AreaSims.get(id);
    const cars = sim?.cars.length || 0;
    const run = sim?.isRunning ? ` ▶ ${cars}🚗` : "";
    opt.textContent = area.name + run;
    if (id === ActiveAreaId) opt.selected = true;
    dd.appendChild(opt);
  });
}

function updatePortalBadges() {
  rebuildAreaDropdown();
  const badge = document.getElementById("portal-count");
  if (badge) badge.textContent = Portals.length > 0 ? Portals.length : "";
}

// ─── PORTAL MANAGER MODAL ─────────────────────────────────────────────────────
function openPortalManager() {
  snapshotActiveArea();

  const allDangling = [];
  Areas.forEach((area, areaId) => {
    const sim = AreaSims.get(areaId);
    if (!sim) return;
    sim.nodes.forEach((node) => {
      const connected = sim.edges.filter(
        (e) => e.from === node.id || e.to === node.id,
      );
      if (connected.length === 1) {
        const edge = connected[0];
        const portal = getPortalForEndpoint(areaId, node.id, edge.id);
        allDangling.push({ areaId, areaName: area.name, node, edge, portal });
      }
    });
  });

  if (!allDangling.length) {
    alert(
      "No dangling nodes found.\n\nA dangling node has exactly one connected road. Create such nodes in different areas to link them as portals.",
    );
    return;
  }

  let html = `<h4>PORTAL LINKS</h4>
  <p style="font-size:10px;color:var(--color-text-secondary);margin-bottom:12px;line-height:1.5;">
    Portals connect dangling roads between areas. Cars cross instantly in both directions.<br>
    A dangling node has exactly <b>one</b> connected road.
  </p>`;

  if (Portals.length) {
    html += `<div style="margin-bottom:14px;"><span class="pk" style="display:block;margin-bottom:6px;">ACTIVE PORTALS</span>`;
    Portals.forEach((p) => {
      const aA = Areas.get(p.a.areaId),
        aB = Areas.get(p.b.areaId);
      const sA = AreaSims.get(p.a.areaId),
        sB = AreaSims.get(p.b.areaId);
      const nA = sA?.nodes.find((n) => n.id === p.a.nodeId);
      const nB = sB?.nodes.find((n) => n.id === p.b.nodeId);
      html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;margin-bottom:4px;background:var(--color-background-secondary);border:1px solid var(--color-border-secondary);border-radius:4px;font-size:11px;">
        <span style="color:var(--color-text-primary)">
          <b style="color:#2ec4e8">${aA?.name || "?"}</b> · ${nA?.lbl || "?"}
          <span style="color:var(--color-text-tertiary)">⟷</span>
          <b style="color:#2ec4e8">${aB?.name || "?"}</b> · ${nB?.lbl || "?"}
        </span>
        <button onclick="deletePortal('${p.id}');openPortalManager();"
          style="background:transparent;border:1px solid var(--color-border-danger);color:var(--color-text-danger);padding:2px 7px;cursor:pointer;font:inherit;font-size:10px;border-radius:3px;">✕</button>
      </div>`;
    });
    html += `</div>`;
  }

  const makeOpts = (sid) => {
    let s = `<select id="${sid}" style="width:100%;padding:6px 8px;font:inherit;font-size:11px;background:var(--color-background-secondary);border:1px solid var(--color-border-secondary);color:var(--color-text-primary);border-radius:4px;outline:none;"><option value="">— select endpoint —</option>`;
    allDangling.forEach((d, i) => {
      s += `<option value="${i}">${d.areaName} · Node ${d.node.lbl}${d.portal ? " 🔗" : ""}</option>`;
    });
    return s + `</select>`;
  };

  html += `
    <span class="pk" style="display:block;margin-bottom:6px;">CREATE NEW PORTAL</span>
    <div class="mf" style="margin-bottom:8px;"><label>ENDPOINT A</label>${makeOpts("portal-ep-a")}</div>
    <div class="mf" style="margin-bottom:14px;"><label>ENDPOINT B</label>${makeOpts("portal-ep-b")}</div>
    <div class="ma"><button onclick="hideModal()">CANCEL</button><button class="ok" onclick="_confirmCreatePortal()">LINK</button></div>`;

  _portalDanglingCache = allDangling;
  document.getElementById("mb").innerHTML = html;
  document.getElementById("mo").classList.add("vis");
}

function _confirmCreatePortal() {
  const dangling = _portalDanglingCache;
  const ia = parseInt(document.getElementById("portal-ep-a").value);
  const ib = parseInt(document.getElementById("portal-ep-b").value);
  if (isNaN(ia) || isNaN(ib) || ia === ib) {
    alert("Select two different endpoints.");
    return;
  }
  const dA = dangling[ia],
    dB = dangling[ib];
  if (dA.areaId === dB.areaId) {
    alert("Both endpoints are in the same area. Portals must cross areas.");
    return;
  }
  createPortal(
    { areaId: dA.areaId, nodeId: dA.node.id, edgeId: dA.edge.id },
    { areaId: dB.areaId, nodeId: dB.node.id, edgeId: dB.edge.id },
  );
  hideModal();
}

// ─── PORTAL CANVAS INDICATORS ─────────────────────────────────────────────────
function drawPortalIndicators() {
  getDanglingNodes().forEach(({ node, edge }) => {
    const portal = getPortalForEndpoint(ActiveAreaId, node.id, edge.id);
    if (!portal) return;
    const [sx, sy] = worldToScreen(node.x, node.y);
    const r = CONFIG.NODE_RADIUS * State.camera.zoom;

    ctx.beginPath();
    ctx.arc(sx, sy, r * 2.2, 0, Math.PI * 2);
    ctx.strokeStyle = "#a855f7";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (State.camera.zoom > 0.35) {
      const partner = getOtherEndpoint(portal, ActiveAreaId, node.id);
      const partnerArea = Areas.get(partner.areaId);
      const partnerSim = AreaSims.get(partner.areaId);
      const partnerNode = partnerSim?.nodes.find(
        (n) => n.id === partner.nodeId,
      );
      const pSim = AreaSims.get(partner.areaId);
      const carCount = pSim?.cars.length || 0;
      const label = partnerArea
        ? `⇄ ${partnerArea.name}${partnerNode ? " · " + partnerNode.lbl : ""}${pSim?.isRunning ? " (" + carCount + "🚗)" : ""}`
        : "⇄";
      ctx.font = `bold ${Math.max(8, Math.round(9 * Math.min(State.camera.zoom, 1)))}px monospace`;
      const tw = ctx.measureText(label).width;
      const bx = sx - tw / 2 - 4,
        by = sy - r * 2.8 - 14;
      ctx.fillStyle = "rgba(80,20,120,0.88)";
      ctx.beginPath();
      ctx.roundRect(bx, by, tw + 8, 14, 3);
      ctx.fill();
      ctx.fillStyle = "#d8b4fe";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, sx, by + 7);
    }
  });
}
