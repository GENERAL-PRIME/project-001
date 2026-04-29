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
      // 1. Initialize the Predictive AI Memory
      if (!node.ai || !node.ai.phaseDurations) {
        node.ai = {
          timeInPhase: 0,
          phaseQueue: [...node.lights],
          currentPhaseIndex: 0,
          historicalVolume: {},
          phaseDurations: {},
          memory: {},
        };

        const evenSplit = (node.cycle || 120) / node.lights.length;
        node.lights.forEach((id) => {
          node.ai.historicalVolume[id] = 1;
          node.ai.phaseDurations[id] = evenSplit;
        });
      }

      if (node.ai.phaseQueue.length !== node.lights.length) {
        node.ai.phaseQueue = [...node.lights];
        node.ai.currentPhaseIndex = 0;
      }

      node.activeGreenEdge = node.ai.phaseQueue[node.ai.currentPhaseIndex];
      const currentGreenDuration = node.ai.phaseDurations[node.activeGreenEdge];

      node.ai.timeInPhase += dt;
      if (!node.edgeStats) node.edgeStats = {};

      // 2. THE SCHEDULE TRIGGER & LEARNING EVENT
      if (node.ai.timeInPhase >= currentGreenDuration) {
        const nextPhaseIndex =
          (node.ai.currentPhaseIndex + 1) % node.ai.phaseQueue.length;
        const nextEdgeId = node.ai.phaseQueue[nextPhaseIndex];

        let carsWaiting = 0;
        State.cars.forEach((c) => {
          if (c.edgeId === nextEdgeId && c.isStopped) carsWaiting++;
        });

        node.ai.historicalVolume[nextEdgeId] =
          node.ai.historicalVolume[nextEdgeId] * 0.8 + carsWaiting * 0.2;
        if (node.ai.historicalVolume[nextEdgeId] < 0.5)
          node.ai.historicalVolume[nextEdgeId] = 0.5;

        // --- THE BUG WAS HERE: FIXED VARIABLE NAMES ---
        let totalLearnedVolume = 0;
        node.lights.forEach((id) => {
          totalLearnedVolume += node.ai.historicalVolume[id] || 1;
        });

        node.lights.forEach((id) => {
          const proportion =
            (node.ai.historicalVolume[id] || 1) / totalLearnedVolume;
          node.ai.phaseDurations[id] = Math.max(
            4,
            proportion * (node.cycle || 120),
          );
          node.ai.memory[id] = node.ai.phaseDurations[id];
        });
        // ----------------------------------------------

        node.ai.currentPhaseIndex = nextPhaseIndex;
        node.activeGreenEdge = node.ai.phaseQueue[node.ai.currentPhaseIndex];
        node.ai.timeInPhase = 0;
      }

      // 3. CALCULATE PREDETERMINED COUNTDOWNS FOR THE HUD
      node.lights.forEach((edgeId) => {
        let stoppedCars = 0;
        State.cars.forEach((car) => {
          if (car.edgeId === edgeId && car.isStopped) stoppedCars++;
        });

        let timeUntilGreen = 0;
        if (node.activeGreenEdge !== edgeId) {
          const currentIndex = node.ai.phaseQueue.indexOf(node.activeGreenEdge);
          const targetIndex = node.ai.phaseQueue.indexOf(edgeId);

          timeUntilGreen += Math.max(
            0,
            node.ai.phaseDurations[node.activeGreenEdge] - node.ai.timeInPhase,
          );

          let idx = (currentIndex + 1) % node.ai.phaseQueue.length;
          while (idx !== targetIndex) {
            timeUntilGreen += node.ai.phaseDurations[node.ai.phaseQueue[idx]];
            idx = (idx + 1) % node.ai.phaseQueue.length;
          }
        }

        node.edgeStats[edgeId] = {
          cars: stoppedCars,
          maxWait: timeUntilGreen,
        };
      });
    }
  });
}

function updateCars(dt) {
  for (let i = State.cars.length - 1; i >= 0; i--) {
    const car = State.cars[i];
    const edge = getEdge(car.edgeId);
    if (!edge) {
      State.cars.splice(i, 1);
      continue;
    }

    if (car.progress < 1) car.progress += car.speed * dt * 60;

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
        car.progress = 0.98;
        car.isStopped = true;
        continue;
      }
    }

    if (car.progress >= 1) {
      const targetNodeId = car.direction === "out" ? edge.to : edge.from;
      const targetNode = getNode(targetNodeId);

      car.isStopped = false;

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
      car.isStopped = false;
    }
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

  // 2. Live update the AI metrics in the properties tab
  const aiEl = document.getElementById("ai-live-stats");
  if (aiEl && node.ctrl === "signalized") {
    let html = "";

    // Render the Active Green Light (Go Time Countdown)
    const activeEdge = node.activeGreenEdge
      ? getEdge(node.activeGreenEdge)
      : null;
    const activePrevN = activeEdge
      ? getNode(activeEdge.to === node.id ? activeEdge.from : activeEdge.to)
      : null;

    if (activePrevN && node.ai && node.ai.phaseDurations) {
      const totalGreen = Math.round(
        node.ai.phaseDurations[node.activeGreenEdge] || 0,
      );
      const timePassed = Math.round(node.ai.timeInPhase || 0);
      const timeRemaining = Math.max(0, totalGreen - timePassed);

      html += `<div style="color:#30d870; margin-bottom:6px;"><b>GO: ${timeRemaining}s left</b> <span style="color:var(--color-text-secondary)">(Total: ${totalGreen}s from ${activePrevN.lbl})</span></div>`;
    }

    // Render the Red Lights (Wait Countdowns & Allocated Future Green Time)
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

          // Grab the green time the AI has scheduled for this road's next turn
          const allocatedGreen =
            node.ai && node.ai.phaseDurations && node.ai.phaseDurations[edgeId]
              ? Math.round(node.ai.phaseDurations[edgeId])
              : "?";

          html += `<div>• From ${prevN ? prevN.lbl : "?"}: Wait <b>${Math.floor(stats.maxWait)}s</b> <span style="color:#718096">(Next Green: ${allocatedGreen}s)</span></div>`;
        }
      });
    }

    if (html === "") html = "No traffic data recorded yet.";

    // Only update the DOM if the string actually changed (saves processing power)
    if (aiEl.innerHTML !== html) aiEl.innerHTML = html;
  }
}
