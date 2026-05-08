// simulation.js — Traffic signal control AI, car movement, and metrics.

// ─── Car Spawning ─────────────────────────────────────────────────────────────
function spawnCars() {
  if (!State.simulation.isRunning || !State.edges.length) return;

  const dnInput = document.getElementById("dn");
  const density = dnInput ? parseInt(dnInput.value) || 50 : 50;
  const targetCount = Math.min(
    density * Math.max(1, State.edges.length),
    SIM_CONFIG.MAX_CARS,
  );

  let attempts = 0;
  while (State.cars.length < targetCount && attempts < 500) {
    attempts++;
    if (Math.random() > SIM_CONFIG.POISSON_MEAN * density) continue;

    const edge = State.edges[Math.floor(Math.random() * State.edges.length)];
    const availableDirs = [];
    if (edge.out > 0) availableDirs.push("out");
    if (edge.inl > 0) availableDirs.push("in");
    if (!availableDirs.length) continue;

    const dir = availableDirs[Math.floor(Math.random() * availableDirs.length)];
    const maxLanes = dir === "out" ? edge.out : edge.inl;

    // HIDDEN: Emergency Spawn Chance
    const isEmergency = false;

    State.cars.push({
      id: State.nextId++,
      edgeId: edge.id,
      direction: dir,
      lane: Math.floor(Math.random() * maxLanes),
      progress: Math.random() * 0.8,
      baseSpeed: (edge.spd / 50) * 60, // HIDDEN: Emergency speed multiplier
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
  while (State.cars.length > targetCount) State.cars.pop();
}

// ─── Emergency Preemption ────────────────────────────────────────────────────
function handleEmergencyPreemption(node) {
  // HIDDEN: Preemption logic left intact, but currently unused
  let preemptEdgeId = null;
  for (const car of State.cars) {
    if (!car.isEmergency) continue;
    const edge = getEdge(car.edgeId);
    if (!edge) continue;
    const targetNodeId = car.direction === "out" ? edge.to : edge.from;
    if (targetNodeId !== node.id) continue;
    if ((node.lights || []).includes(edge.id)) {
      preemptEdgeId = edge.id;
      break;
    }
  }

  if (!preemptEdgeId) {
    if (node.ai && node.ai.preempting) {
      node.ai.preempting = false;
      node.ai.preemptTimer = 0;
      node.ai.timeInPhase = 0;
    }
    return false;
  }

  if (!node.ai) return false;
  node.ai.preempting = true;
  node.ai.preemptTimer = node.ai.preemptTimer || 0;
  node.activeGreenEdge = preemptEdgeId;
  return true;
}

// ─── Watchdog / Failsafe ─────────────────────────────────────────────────────
function watchdogCheck(node) {
  if (!node.ai) return;
  node.ai.watchdogAccum = node.ai.watchdogAccum || 0;
  if (node.ai.watchdogAccum > SIM_CONFIG.WATCHDOG_TIMEOUT) {
    const evenSplit = (node.cycle || 120) / Math.max(1, node.lights.length);
    node.lights.forEach((id) => {
      node.ai.phaseDurations[id] = evenSplit;
    });
    node.ai.watchdogAccum = 0;
    node.ai.timeInPhase = 0;
    node.ai.currentPhaseIndex = 0;
  }
}

// ─── Traffic Light Controller (Adaptive AI) ──────────────────────────────────
function updateTrafficLights(dt) {
  State.nodes.forEach((node) => {
    if (node.ctrl !== "signalized" || !node.lights || node.lights.length === 0)
      return;

    if (!node.ai || !node.ai.phaseDurations) {
      const evenSplit = (node.cycle || 120) / node.lights.length;
      node.ai = {
        timeInPhase: 0,
        phaseQueue: [...node.lights],
        currentPhaseIndex: 0,
        historicalVolume: {},
        phaseDurations: {},
        memory: {},
        allRedTimer: 0,
        inAllRed: false,
        preempting: false,
        preemptTimer: 0,
        watchdogAccum: 0,
      };
      node.lights.forEach((id) => {
        node.ai.historicalVolume[id] = 1;
        node.ai.phaseDurations[id] = evenSplit;
      });
    }

    if (node.ai.phaseQueue.length !== node.lights.length) {
      const currentGreen = node.ai.phaseQueue[node.ai.currentPhaseIndex];
      node.ai.phaseQueue = [...node.lights];
      const newIdx = node.ai.phaseQueue.indexOf(currentGreen);
      node.ai.currentPhaseIndex = newIdx >= 0 ? newIdx : 0;
    }

    // HIDDEN: Emergency Preemption Bypass
    const preempting = false;

    if (preempting) {
      node.ai.preemptTimer += dt;
      node.ai.watchdogAccum = 0;
      if (node.ai.inAllRed) {
        node.ai.inAllRed = false;
        node.ai.allRedTimer = 0;
      }
      if (!node.edgeStats) node.edgeStats = {};
      _updateEdgeStats(node);
      return;
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
      _updateEdgeStats(node);
      return;
    }

    node.activeGreenEdge = node.ai.phaseQueue[node.ai.currentPhaseIndex];
    const currentGreenDuration =
      node.ai.phaseDurations[node.activeGreenEdge] || SIM_CONFIG.MIN_GREEN_SEC;

    node.ai.timeInPhase += dt;
    node.ai.watchdogAccum += dt;
    if (!node.edgeStats) node.edgeStats = {};

    watchdogCheck(node);

    if (node.ai.timeInPhase >= currentGreenDuration) {
      const nextPhaseIndex =
        (node.ai.currentPhaseIndex + 1) % node.ai.phaseQueue.length;
      const nextEdgeId = node.ai.phaseQueue[nextPhaseIndex];

      let carsWaiting = 0;
      State.cars.forEach((c) => {
        if (c.edgeId === nextEdgeId && c.isStopped) carsWaiting++;
      });

      // 1. Keep the Historical EMA pure (just counting physical cars)
      // FORMULA: Exponential Moving Average (EMA)
      // V_learned = (V_historical * Decay_Factor) + (V_current * Update_Weight)
      node.ai.historicalVolume[nextEdgeId] =
        node.ai.historicalVolume[nextEdgeId] * SIM_CONFIG.EWA_DECAY +
        carsWaiting * SIM_CONFIG.EWA_NEW_WEIGHT;

      if (node.ai.historicalVolume[nextEdgeId] < SIM_CONFIG.VOLUME_FLOOR)
        node.ai.historicalVolume[nextEdgeId] = SIM_CONFIG.VOLUME_FLOOR;

      let totalWeightedVolume = 0;

      // 2. Calculate the Total Pie Size using Speed AND Road Length Saturation
      node.lights.forEach((id) => {
        const edge = getEdge(id);
        const speedWeight = edge ? edge.spd / 50 : 1.0;

        let saturationWeight = 1.0;
        if (edge) {
          const maxCapacity = edge.len / SIM_CONFIG.SAFE_GAP;
          // FORMULA: Queue Saturation Index
          // Saturation = Current_Vehicles / Maximum_Physical_Capacity
          const currentCars =
            node.edgeStats?.[id]?.cars || (id === nextEdgeId ? carsWaiting : 0);
          const saturation = Math.min(
            1.0,
            currentCars / Math.max(1, maxCapacity),
          );
          saturationWeight = 1.0 + saturation * 0.5; // Up to 50% priority boost for full roads
        }

        const combinedWeight = speedWeight * saturationWeight;
        totalWeightedVolume +=
          (node.ai.historicalVolume[id] || SIM_CONFIG.VOLUME_FLOOR) *
          combinedWeight;
      });

      // 3. Slice the Pie using the new Combined Weights
      node.lights.forEach((id) => {
        const edge = getEdge(id);

        const speedWeight = edge ? edge.spd / 50 : 1.0;
        let saturationWeight = 1.0;
        if (edge) {
          const maxCapacity = edge.len / SIM_CONFIG.SAFE_GAP;
          const currentCars = node.edgeStats?.[id]?.cars || 0;
          const saturation = Math.min(
            1.0,
            currentCars / Math.max(1, maxCapacity),
          );
          saturationWeight = 1.0 + saturation * 0.5;
        }

        const combinedWeight = speedWeight * saturationWeight;
        const weighted =
          (node.ai.historicalVolume[id] || SIM_CONFIG.VOLUME_FLOOR) *
          combinedWeight;
        // FORMULA: Proportional Cycle Slicing
        // T_green = Demand_Proportion * (Total_Cycle - Mandatory_Clearance_Times)
        const proportion =
          totalWeightedVolume > 0
            ? weighted / totalWeightedVolume
            : 1 / node.lights.length;

        node.ai.phaseDurations[id] = Math.max(
          SIM_CONFIG.MIN_GREEN_SEC,
          proportion *
            ((node.cycle || 120) - SIM_CONFIG.ALL_RED_SEC * node.lights.length),
        );
        node.ai.memory[id] = node.ai.phaseDurations[id];
      });

      node.activeGreenEdge = null;
      node.ai.inAllRed = true;
      node.ai.allRedTimer = 0;
      node.ai.watchdogAccum = 0;
    }
    _updateEdgeStats(node);
  });
}

function _updateEdgeStats(node) {
  if (!node.lights || !node.ai) return;
  node.lights.forEach((edgeId) => {
    let stoppedCars = 0;
    State.cars.forEach((car) => {
      if (car.edgeId === edgeId && car.isStopped) stoppedCars++;
    });

    let timeUntilGreen = 0;
    if (node.ai.inAllRed) {
      timeUntilGreen = SIM_CONFIG.ALL_RED_SEC - (node.ai.allRedTimer || 0);
    } else if (node.activeGreenEdge !== edgeId) {
      const currentIndex = node.ai.phaseQueue.indexOf(node.activeGreenEdge);
      const targetIndex = node.ai.phaseQueue.indexOf(edgeId);
      if (currentIndex >= 0 && targetIndex >= 0) {
        timeUntilGreen += Math.max(
          0,
          (node.ai.phaseDurations[node.activeGreenEdge] || 0) -
            (node.ai.timeInPhase || 0),
        );
        let idx = (currentIndex + 1) % node.ai.phaseQueue.length;
        while (idx !== targetIndex) {
          timeUntilGreen +=
            (node.ai.phaseDurations[node.ai.phaseQueue[idx]] || 0) +
            SIM_CONFIG.ALL_RED_SEC;
          idx = (idx + 1) % node.ai.phaseQueue.length;
        }
      }
    }
    node.edgeStats[edgeId] = { cars: stoppedCars, maxWait: timeUntilGreen };
  });
}

// ─── Car Movement ─────────────────────────────────────────────────────────────
function updateCars(dt) {
  const edgeGeometries = {};

  for (let i = State.cars.length - 1; i >= 0; i--) {
    const car = State.cars[i];
    const edge = getEdge(car.edgeId);
    if (!edge) {
      State.cars.splice(i, 1);
      continue;
    }

    car.tripTime += dt;
    if (!edgeGeometries[edge.id])
      edgeGeometries[edge.id] = getEdgeGeometry(edge);
    const geom = edgeGeometries[edge.id];
    if (!geom) continue;

    let currentTargetSpeed = car.baseSpeed;
    let carAhead = null;
    let minDiff = Infinity;

    for (let j = 0; j < State.cars.length; j++) {
      if (i !== j) {
        const other = State.cars[j];
        if (
          other.edgeId === car.edgeId &&
          other.direction === car.direction &&
          other.lane === car.lane
        ) {
          const diff = other.progress - car.progress;
          if (diff > 0 && diff < minDiff) {
            minDiff = diff;
            carAhead = other;
          }
        }
      }
    }

    let isForcedStop = false;

    if (carAhead) {
      const absoluteDist = minDiff * geom.logicalLength;
      if (absoluteDist < SIM_CONFIG.SAFE_GAP) {
        currentTargetSpeed = 0;
        isForcedStop = true;
      } else if (absoluteDist < SIM_CONFIG.SAFE_GAP * 3) {
        const slowFactor =
          (absoluteDist - SIM_CONFIG.SAFE_GAP) / (SIM_CONFIG.SAFE_GAP * 2);
        const safeFollowSpeed =
          carAhead.speed + (car.baseSpeed - carAhead.speed) * slowFactor;
        currentTargetSpeed = Math.min(currentTargetSpeed, safeFollowSpeed);
      }
    }

    const targetNodeId = car.direction === "out" ? edge.to : edge.from;
    const targetNode = getNode(targetNodeId);
    const distToEnd = (1 - car.progress) * geom.logicalLength;
    let isRedLight = false;

    if (targetNode && targetNode.ctrl === "signalized") {
      const hasLight = (targetNode.lights || []).includes(edge.id);
      if (
        hasLight &&
        (targetNode.activeGreenEdge !== edge.id || targetNode.ai?.inAllRed)
      ) {
        isRedLight = true;
      }
    } else if (targetNode && targetNode.ctrl === "uncontrolled") {
      let occupancy = 0;
      State.cars.forEach((c) => {
        if (c.edgeId !== edge.id && c.progress > 0.8 && c.progress < 1.0) {
          const cEdge = getEdge(c.edgeId);
          if (cEdge) {
            const cTarget = c.direction === "out" ? cEdge.to : cEdge.from;
            if (cTarget === targetNodeId) occupancy++;
          }
        }
      });
      if (occupancy > 0 && distToEnd < SIM_CONFIG.STOP_LINE_DIST * 2) {
        currentTargetSpeed = Math.min(currentTargetSpeed, 10);
      }
    }

    // ──────────────────────────────────────────────────────────
    // FIX: Pedestrian Crosswalk Clearance
    // ──────────────────────────────────────────────────────────
    const stopPin = 32; // mathematically guarantees 9-units of clear space before the intersection

    // Only force braking if the car hasn't crossed the stop line yet!
    if (
      isRedLight &&
      distToEnd >= stopPin &&
      distToEnd < SIM_CONFIG.STOP_LINE_DIST
    ) {
      if (distToEnd <= stopPin + 0.5) {
        car.progress = 1 - stopPin / geom.logicalLength; // Pin to the stop line
        currentTargetSpeed = 0;
        isForcedStop = true;
      } else {
        // FORMULA: Linear Deceleration Curve
        // Target_Speed = Base_Speed * (Distance_Remaining / Total_Braking_Distance)
        const brakeFactor =
          (distToEnd - stopPin) / (SIM_CONFIG.STOP_LINE_DIST - stopPin);
        currentTargetSpeed *= brakeFactor;
      }
    }

    car.speed = Math.max(0, currentTargetSpeed);

    if (car.speed < 2 || isForcedStop) {
      car.isStopped = true;
      car.speed = 0;
      car.waitTime += dt;
      State.metrics.totalWaitTime += dt;
    } else {
      car.isStopped = false;
    }

    if (!car.isStopped && !isForcedStop) {
      // FORMULA: Kinematic Integration (Euler Method)
      // ΔProgress = (Velocity * ΔTime) / Logical_Road_Length
      car.progress += (car.speed * dt) / geom.logicalLength;

      // Prevent creeping past the line if light is red (only if they are behind it)
      if (isRedLight && distToEnd >= stopPin) {
        car.progress = Math.min(car.progress, 1 - stopPin / geom.logicalLength);
      }
    }

    if (car.progress >= 1) {
      if (targetNode) {
        targetNode.throughput = (targetNode.throughput || 0) + 1;
        targetNode.totalWait = (targetNode.totalWait || 0) + car.waitTime;
      }

      car.isStopped = false;
      car.waitTime = 0;

      let possibleNextEdges = State.edges.filter(
        (x) =>
          x.id !== edge.id &&
          ((x.from === targetNodeId && x.out > 0) ||
            (x.to === targetNodeId && x.inl > 0)),
      );

      if (targetNode && targetNode.banned_turns) {
        possibleNextEdges = possibleNextEdges.filter(
          (nextEdge) =>
            !targetNode.banned_turns.find(
              (bt) => bt.from === edge.id && bt.to === nextEdge.id,
            ),
        );
      }

      if (!possibleNextEdges.length) {
        State.metrics.totalThroughput++;
        State.cars.splice(i, 1);
      } else {
        const nextEdge =
          possibleNextEdges[
            Math.floor(Math.random() * possibleNextEdges.length)
          ];
        car.edgeId = nextEdge.id;
        car.progress = 0;
        car.baseSpeed = (nextEdge.spd / 50) * 60;

        if (nextEdge.from === targetNodeId && nextEdge.out > 0) {
          car.direction = "out";
          car.lane = Math.floor(Math.random() * nextEdge.out);
        } else {
          car.direction = "in";
          car.lane = Math.floor(Math.random() * nextEdge.inl);
        }
      }
    }
  }
}

// ─── Metrics Sampling ────────────────────────────────────────────────────────
function updateMetrics(dt) {
  State.metrics.lastSample += dt;
  if (State.metrics.lastSample < 1) return;
  State.metrics.lastSample = 0;

  const activeCars = State.cars.length;
  const avgWait =
    activeCars > 0
      ? State.cars.reduce((s, c) => s + c.waitTime, 0) / activeCars
      : 0;

  State.metrics.history.push({
    t: State.simulation.clock,
    throughput: State.metrics.totalThroughput,
    avgWait: avgWait,
  });

  const cutoff = State.simulation.clock - SIM_CONFIG.METRICS_WINDOW;
  while (State.metrics.history.length && State.metrics.history[0].t < cutoff) {
    State.metrics.history.shift();
  }
}

// ─── Inspector Live Stats ────────────────────────────────────────────────────
function updateInspectorLiveStats(forceUpdate = false) {
  const metricsEl = document.getElementById("metrics-panel");
  if (metricsEl && (State.simulation.isRunning || forceUpdate)) {
    const tp = State.metrics.totalThroughput;
    const activeCars = State.cars.length;
    const avgWait =
      activeCars > 0
        ? (State.cars.reduce((s, c) => s + c.waitTime, 0) / activeCars).toFixed(
            1,
          )
        : "0.0";
    const clock = Math.floor(State.simulation.clock);
    metricsEl.innerHTML = `<div>🕐 Sim time: <b>${clock}s</b></div><div>🚗 Throughput: <b>${tp}</b> cars</div><div>⏱ Avg wait: <b>${avgWait}s</b></div>`;
  }

  if (!State.interaction.selected || State.interaction.selected.type !== "node")
    return;
  if (!State.simulation.isRunning && !forceUpdate) return;

  const node = getNode(State.interaction.selected.id);
  if (!node) return;

  let occ = 0;
  State.cars.forEach((c) => {
    const e = getEdge(c.edgeId);
    if (
      e &&
      ((e.from === node.id && c.progress < 0.1) ||
        (e.to === node.id && c.progress > 0.9))
    )
      occ++;
  });
  const occEl = document.getElementById("occ-val");
  if (occEl && occEl.innerText != occ) occEl.innerText = occ;

  const aiEl = document.getElementById("ai-live-stats");
  if (!aiEl || node.ctrl !== "signalized") return;

  let html = "";

  if (node.ai?.inAllRed) {
    html += `<div style="color:#ff9900; margin-bottom:6px;"><b>⚠ ALL-RED: ${Math.max(0, SIM_CONFIG.ALL_RED_SEC - Math.floor(node.ai.allRedTimer || 0))}s clearance</b></div>`;
  }

  const activeEdge = node.activeGreenEdge
    ? getEdge(node.activeGreenEdge)
    : null;
  const activePrevN = activeEdge
    ? getNode(activeEdge.to === node.id ? activeEdge.from : activeEdge.to)
    : null;

  if (activePrevN && node.ai?.phaseDurations) {
    const totalGreen = Math.round(
      node.ai.phaseDurations[node.activeGreenEdge] || 0,
    );
    const timePassed = Math.round(node.ai.timeInPhase || 0);
    const timeRemaining = Math.max(0, totalGreen - timePassed);
    html += `<div style="color:#30d870; margin-bottom:6px;"><b>GO: ${timeRemaining}s</b> <span style="color:var(--color-text-secondary)">(${totalGreen}s from ${activePrevN.lbl})</span></div>`;
  } else if (!node.ai?.inAllRed) {
    html += `<div style="color:var(--color-text-secondary); margin-bottom:6px;">No active green phase</div>`;
  }

  if (node.lights) {
    const seen = new Set();
    node.lights.forEach((edgeId) => {
      if (seen.has(edgeId)) return;
      seen.add(edgeId);
      if (edgeId === node.activeGreenEdge) return;
      const e = getEdge(edgeId);
      if (!e) return;
      const prevN = getNode(e.to === node.id ? e.from : e.to);
      const stats = node.edgeStats?.[edgeId] ?? { maxWait: 0 };
      const allocatedGreen = node.ai?.phaseDurations?.[edgeId]
        ? Math.round(node.ai.phaseDurations[edgeId])
        : "?";
      html += `<div>• ${prevN?.lbl ?? "?"}: wait <b>${Math.floor(stats.maxWait)}s</b> <span style="color:#718096">(next green: ${allocatedGreen}s)</span></div>`;
    });
  }

  if (html === "") html = "No traffic data recorded yet.";
  if (aiEl.innerHTML !== html) aiEl.innerHTML = html;
}
