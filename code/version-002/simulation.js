// simulation.js

function spawnCars() {
  if (!State.simulation.isRunning || !State.edges.length) return;
  const targetCount = Math.min(
    parseInt(document.getElementById("dn").value) *
      Math.max(1, State.edges.length),
    220,
  );

  while (State.cars.length < targetCount) {
    const edge = State.edges[Math.floor(Math.random() * State.edges.length)];
    const availableDirs = [];
    if (edge.out > 0) availableDirs.push("out");
    if (edge.inl > 0) availableDirs.push("in");
    if (!availableDirs.length) continue;

    const dir = availableDirs[Math.floor(Math.random() * availableDirs.length)];
    const maxLanes = dir === "out" ? edge.out : edge.inl;

    State.cars.push({
      id: State.nextId++,
      edgeId: edge.id,
      direction: dir,
      lane: Math.floor(Math.random() * maxLanes),
      progress: Math.random(),
      speed: (0.05 + Math.random() * 0.1) * (edge.spd / 50),
      color:
        CONFIG.COLORS.cars[
          Math.floor(Math.random() * CONFIG.COLORS.cars.length)
        ],
      isStopped: false,
      waitTime: 0,
    });
  }
  while (State.cars.length > targetCount) State.cars.pop();
}

function updateTrafficLights(dt) {
  State.nodes.forEach((node) => {
    if (node.ctrl === "signalized" && node.lights && node.lights.length > 0) {
      if (!node.ai) node.ai = { timeInPhase: 0, minGreen: 4, memory: {} };
      node.ai.timeInPhase += dt;

      if (!node.edgeStats) node.edgeStats = {};

      if (node.ai.timeInPhase < node.ai.minGreen) {
        node.lights.forEach((edgeId) => updateEdgeStats(node, edgeId));
        return;
      }

      const incomingEdges = node.lights
        .map((id) => getEdge(id))
        .filter((e) => e);
      if (incomingEdges.length === 0) return;

      if (!node.activeGreenEdge) node.activeGreenEdge = incomingEdges[0].id;

      let bestEdgeId = node.activeGreenEdge;
      let highestPressure = -1;

      incomingEdges.forEach((edge) => {
        const stats = updateEdgeStats(node, edge.id);

        if (!node.ai.memory[edge.id]) node.ai.memory[edge.id] = 1.0;
        node.ai.memory[edge.id] =
          node.ai.memory[edge.id] * 0.995 + stats.waitPenalty * 0.005;

        const pressure =
          stats.stoppedCars * 10 +
          stats.approachingCars * 3 +
          stats.waitPenalty * node.ai.memory[edge.id];

        if (pressure > highestPressure) {
          highestPressure = pressure;
          bestEdgeId = edge.id;
        }
      });

      if (bestEdgeId !== node.activeGreenEdge && highestPressure > 20) {
        node.activeGreenEdge = bestEdgeId;
        node.ai.timeInPhase = 0;
      }
    }
  });
}

function updateEdgeStats(node, edgeId) {
  let stoppedCars = 0;
  let approachingCars = 0;
  let waitPenalty = 0;
  let maxWaitTime = 0;

  State.cars.forEach((car) => {
    if (car.edgeId === edgeId) {
      if (car.isStopped) {
        stoppedCars++;
        waitPenalty += car.waitTime;
        if (car.waitTime > maxWaitTime) maxWaitTime = car.waitTime;
      } else {
        approachingCars++;
      }
    }
  });

  node.edgeStats[edgeId] = { cars: stoppedCars, maxWait: maxWaitTime };
  return { stoppedCars, approachingCars, waitPenalty };
}

function updateCars(dt) {
  for (let i = State.cars.length - 1; i >= 0; i--) {
    const car = State.cars[i];
    const edge = getEdge(car.edgeId);
    if (!edge) {
      State.cars.splice(i, 1);
      continue;
    }

    // Move forward if not at the intersection
    if (car.progress < 1) {
      car.progress += car.speed * dt * 60;
    }

    // --- NEW: RED LIGHT CHECK (Evaluated right at the stop line) ---
    if (car.progress >= 0.98) {
      const targetNodeId = car.direction === "out" ? edge.to : edge.from;
      const targetNode = getNode(targetNodeId);

      let isRedLight = false;
      if (targetNode && targetNode.ctrl === "signalized") {
        const hasLightAssigned = (targetNode.lights || []).includes(edge.id);
        if (hasLightAssigned && targetNode.activeGreenEdge !== edge.id) {
          isRedLight = true;
        }
      }

      if (isRedLight) {
        car.progress = 0.98; // Pin perfectly at the stop line
        car.isStopped = true;
        car.waitTime += dt; // Consistently accumulate wait time
        continue; // Skip the rest of the loop for this car
      }
    }

    // --- NEW: ROUTING LOGIC (Evaluated when crossing the intersection) ---
    if (car.progress >= 1) {
      const targetNodeId = car.direction === "out" ? edge.to : edge.from;
      const targetNode = getNode(targetNodeId);

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
        State.cars.splice(i, 1);
      } else {
        const nextEdge =
          possibleNextEdges[
            Math.floor(Math.random() * possibleNextEdges.length)
          ];
        car.edgeId = nextEdge.id;
        car.progress = 0;
        if (nextEdge.from === targetNodeId && nextEdge.out > 0) {
          car.direction = "out";
          car.lane = Math.floor(Math.random() * nextEdge.out);
        } else {
          car.direction = "in";
          car.lane = Math.floor(Math.random() * nextEdge.inl);
        }
      }
    } else if (car.progress < 0.98) {
      // Free moving cars
      car.isStopped = false;
      car.waitTime = 0;
    }
  }
}

function updateInspectorLiveStats() {
  if (
    State.interaction.selected &&
    State.interaction.selected.type === "node" &&
    State.simulation.isRunning
  ) {
    let occ = 0;
    State.cars.forEach((c) => {
      const e = getEdge(c.edgeId);
      if (
        e &&
        ((e.from === State.interaction.selected.id && c.progress < 0.1) ||
          (e.to === State.interaction.selected.id && c.progress > 0.9))
      )
        occ++;
    });
    const el = document.getElementById("occ-val");
    if (el && el.innerText != occ) el.innerText = occ;
  }
}
function updateInspectorLiveStats(forceUpdate = false) {
  // Only proceed if a node is selected, and only run if simulating (or forced by a click)
  if (!State.interaction.selected || State.interaction.selected.type !== "node")
    return;
  if (!State.simulation.isRunning && !forceUpdate) return;

  const node = getNode(State.interaction.selected.id);
  if (!node) return;

  // 1. Live update the "Cars In Box" counter
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

  // 2. NEW: Live update the AI metrics in the properties tab
  const aiEl = document.getElementById("ai-live-stats");
  if (aiEl && node.ctrl === "signalized") {
    let html = "";

    // Render the Active Green Light (Go Time)
    const goTime = node.ai ? Math.floor(node.ai.timeInPhase) : 0;
    const activeEdge = node.activeGreenEdge
      ? getEdge(node.activeGreenEdge)
      : null;
    const activePrevN = activeEdge
      ? getNode(activeEdge.to === node.id ? activeEdge.from : activeEdge.to)
      : null;

    if (activePrevN) {
      html += `<div style="color:#30d870; margin-bottom:6px;"><b>GO: ${goTime}s</b> (From ${activePrevN.lbl})</div>`;
    }

    // Render the Red Lights (Wait Times & Pain Multipliers)
    if (node.lights && node.lights.length > 0) {
      node.lights.forEach((edgeId) => {
        if (edgeId === node.activeGreenEdge) return; // Skip the green light

        const e = getEdge(edgeId);
        if (e) {
          const prevN = getNode(e.to === node.id ? e.from : e.to);
          const stats =
            node.edgeStats && node.edgeStats[edgeId]
              ? node.edgeStats[edgeId]
              : { maxWait: 0 };
          const memory =
            node.ai && node.ai.memory && node.ai.memory[edgeId]
              ? node.ai.memory[edgeId].toFixed(2)
              : "1.00";

          html += `<div>• From ${prevN ? prevN.lbl : "?"}: Wait <b>${Math.floor(stats.maxWait)}s</b> <span style="color:#718096">(Pain x${memory})</span></div>`;
        }
      });
    }

    if (html === "") html = "No traffic data recorded yet.";

    // Only update the DOM if the string actually changed (saves processing power)
    if (aiEl.innerHTML !== html) aiEl.innerHTML = html;
  }
}
