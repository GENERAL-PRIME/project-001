// main.js

// --- UI & MODAL MANAGEMENT ---
function showModal(type) {
  const mb = document.getElementById("mb");
  if (type === "road") {
    mb.innerHTML = `
            <h4>Configure Road</h4>
            <div class="mf"><label>OUTGOING LANES (→)</label><input type="number" id="mo1" min="0" max="6" value="2"></div>
            <div class="mf"><label>INCOMING LANES (←)</label><input type="number" id="mo2" min="0" max="6" value="2"></div>
            <div class="mf"><label>SPEED LIMIT</label><input type="number" id="mo3" min="10" max="120" value="50"></div>
            <div class="ma"><button onclick="mCancel()">CANCEL</button><button class="ok" onclick="mOk()">CREATE</button></div>`;
  }
  document.getElementById("mo").classList.add("vis");
}

function showMoNode(id) {
  const node = getNode(id);
  if (!node) return;
  State.interaction.pendingNode = node;
  node.banned_turns = node.banned_turns || [];
  node.lights = node.lights || [];

  const inEdges = State.edges.filter(
    (e) => (e.to === node.id && e.out > 0) || (e.from === node.id && e.inl > 0),
  );
  const outEdges = State.edges.filter(
    (e) => (e.from === node.id && e.out > 0) || (e.to === node.id && e.inl > 0),
  );

  // 1. Traffic Lights Configuration HTML
  let lightsHTML = "";
  if (inEdges.length > 0) {
    lightsHTML += `<div style="max-height:120px; overflow-y:auto; border:1px solid var(--color-border-secondary); padding:8px; margin-bottom:12px; border-radius:4px; background:var(--color-background-secondary)">`;
    inEdges.forEach((ie) => {
      const prevN = getNode(ie.to === node.id ? ie.from : ie.to);
      if (!prevN) return;
      const hasLight = node.lights.includes(ie.id);
      lightsHTML += `<label style="display:flex; align-items:center; gap:8px; margin-bottom:6px; font-size:11px; cursor:pointer;">
                <input type="checkbox" class="light-cb" data-edge="${ie.id}" ${hasLight ? "checked" : ""}>
                <span style="color:var(--color-text-primary)">Traffic Light facing <b>${prevN.lbl}</b></span>
            </label>`;
    });
    lightsHTML += `</div>`;
  } else {
    lightsHTML += `<div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:12px;">Connect incoming roads to assign lights.</div>`;
  }

  // 2. Allowed Turns HTML
  let turnsHTML = "";
  if (inEdges.length > 0 && outEdges.length > 0) {
    turnsHTML += `<div style="max-height:200px; overflow-y:auto; border:1px solid var(--color-border-secondary); padding:8px; margin-bottom:12px; border-radius:4px; background:var(--color-background-secondary)">`;
    inEdges.forEach((ie) => {
      outEdges.forEach((oe) => {
        if (ie.id === oe.id) return;
        const prevN = getNode(ie.to === node.id ? ie.from : ie.to);
        const nextN = getNode(oe.from === node.id ? oe.to : oe.from);
        if (!prevN || !nextN) return;

        const tType = calculateTurnType(ie, oe, node);
        const isBanned = node.banned_turns.find(
          (bt) => bt.from === ie.id && bt.to === oe.id,
        );
        turnsHTML += `<label style="display:flex; align-items:center; gap:8px; margin-bottom:6px; font-size:11px; cursor:pointer;">
                    <input type="checkbox" class="turn-cb" data-from="${ie.id}" data-to="${oe.id}" ${isBanned ? "" : "checked"}>
                    <span style="color:var(--color-text-primary)">From <b>${prevN.lbl}</b> to <b>${nextN.lbl}</b> <i style="color:var(--color-text-tertiary)">(${tType})</i></span>
                </label>`;
      });
    });
    turnsHTML += `</div>`;
  } else {
    turnsHTML += `<div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:12px;">Connect multiple roads to configure turns.</div>`;
  }

  document.getElementById("mb").innerHTML = `
        <h4>Configure Intersection (${node.lbl})</h4>
        <div class="mf"><label>LABEL</label><input type="text" id="mn1" value="${node.lbl}"></div>
        <div class="mf"><label>CONTROL TYPE</label>
           <select id="mn2">
             <option value="signalized" ${node.ctrl === "signalized" ? "selected" : ""}>Signalized</option>
             <option value="uncontrolled" ${node.ctrl === "uncontrolled" ? "selected" : ""}>Uncontrolled</option>
           </select>
        </div>
        <div class="mf"><label>CYCLE LENGTH (SEC)</label><input type="number" id="mn3" min="10" max="240" value="${node.cycle}"></div>
        
        <div class="mf"><label>ASSIGN TRAFFIC LIGHTS</label>${lightsHTML}</div>
        <div class="mf"><label>ALLOWED TURNS</label>${turnsHTML}</div>
        
        <div class="ma"><button onclick="mCancel()">CANCEL</button><button class="ok" onclick="mOkNode()">SAVE</button></div>`;
  document.getElementById("mo").classList.add("vis");
}

function hideModal() {
  document.getElementById("mo").classList.remove("vis");
}
function hideInspector() {
  document.getElementById("pn").classList.remove("vis");
}

function inspectIntersection(id) {
  State.interaction.selected = { type: "node", id };
  document.getElementById("pn").classList.add("vis");
  const node = getNode(id);
  const connectedEdges = State.edges.filter(
    (e) => e.from === id || e.to === id,
  );

  let lightsHTML = "";

  if (node.ctrl === "signalized") {
    lightsHTML = `<div class="pr" style="margin-top: 10px;"><span class="pk">TRAFFIC LIGHTS FACING</span><span class="pv" style="font-size: 11px;">`;
    if (!node.lights || node.lights.length === 0) {
      lightsHTML += `None Configured`;
    } else {
      node.lights.forEach((eId) => {
        const e = getEdge(eId);
        if (e) {
          const prevN = getNode(e.to === node.id ? e.from : e.to);
          if (prevN) lightsHTML += `• Traffic from ${prevN.lbl}<br>`;
        }
      });
    }
    lightsHTML += `</span></div>`;

    // NEW: Container for live updating AI stats
    lightsHTML += `
        <div class="pr" style="margin-top: 10px; border-top: 1px solid var(--color-border-tertiary); padding-top: 8px;">
            <span class="pk" style="color: #f5c518;">LIVE AI METRICS</span>
            <span class="pv" id="ai-live-stats" style="font-size: 11px; color: var(--color-text-secondary); display:block; margin-top:4px; line-height: 1.4;">
                Waiting for data...
            </span>
        </div>`;
  }

  document.getElementById("pt").textContent = "INTERSECTION";
  document.getElementById("pc").innerHTML = `
        <div class="pr"><span class="pk">ID & LABEL</span><span class="pv">${node.id} : ${node.lbl}</span></div>
        <div class="pr"><span class="pk">CONTROL LOGIC</span><span class="pv" style="text-transform:capitalize;">${node.ctrl}</span></div>
        <div class="pr"><span class="pk">TOPOLOGY (ROADS)</span><span class="pv">${connectedEdges.length}</span></div>
        ${lightsHTML}
        <div class="pr" style="margin-top: 10px;"><span class="pk">CARS IN BOX</span><span class="pv" id="occ-val" style="color:var(--color-text-info); font-weight:bold;">0</span></div>
        <button onclick="showMoNode(${node.id})" style="margin-top:10px; width:100%; padding:6px; background:transparent; color:var(--color-text-info); border:1px solid var(--color-border-info); border-radius:4px; cursor:pointer; font-size:10px; font-weight:bold;">EDIT PROPERTIES</button>
    `;

  // Trigger immediate update to populate the box immediately upon clicking
  if (typeof updateInspectorLiveStats === "function")
    updateInspectorLiveStats(true);
}

function inspectRoad(id) {
  State.interaction.selected = { type: "edge", id };
  document.getElementById("pn").classList.add("vis");
  const edge = getEdge(id);
  const fromNode = getNode(edge.from);
  const toNode = getNode(edge.to);
  const geom = getEdgeGeometry(edge);

  document.getElementById("pt").textContent = "ROAD SEGMENT";
  document.getElementById("pc").innerHTML = `
        <div class="pr"><span class="pk">ROAD ID</span><span class="pv">${edge.id}</span></div>
        <div class="pr"><span class="pk">FROM → TO</span><span class="pv">${fromNode?.lbl} → ${toNode?.lbl}</span></div>
        <div class="pr"><span class="pk">OUTGOING LANES</span><span class="pv">${edge.out}</span></div>
        <div class="pr"><span class="pk">INCOMING LANES</span><span class="pv">${edge.inl}</span></div>
        <div class="pr"><span class="pk">SPEED LIMIT</span><span class="pv">${edge.spd} u/s</span></div>
        <div class="pr"><span class="pk">PHYSICAL LENGTH</span><span class="pv">${geom ? Math.round(geom.length) : "?"} units</span></div>
    `;
}

// --- GLOBAL ACTIONS ---
function setMode(newMode) {
  State.interaction.mode = newMode;
  State.interaction.routeFromNode = null;
  document
    .querySelectorAll('.tb[id^="m-"]')
    .forEach((b) => b.classList.remove("on"));
  const btn = document.getElementById("m-" + newMode);
  if (btn) btn.classList.add("on");
  updateUIHint();
}

function updateUIHint() {
  const hints = {
    pan: "PAN: drag  ·  ZOOM: scroll",
    sel: "SELECT: click node or road to inspect",
    node: "ADD NODE: click empty space",
    road: State.interaction.routeFromNode
      ? "ADD ROAD: click destination (Esc = cancel)"
      : "ADD ROAD: click source first",
    del: "DELETE: click a node or road to remove",
  };
  document.getElementById("ht").textContent =
    hints[State.interaction.mode] || "";
}

function toggleSim() {
  State.simulation.isRunning = !State.simulation.isRunning;
  const btn = document.getElementById("sb");
  btn.textContent = State.simulation.isRunning ? "■ STOP" : "▶ SIMULATE";
  btn.classList.toggle("stop", State.simulation.isRunning);
  if (!State.simulation.isRunning) State.cars = [];
}

function mOk() {
  if (!State.interaction.pendingEdge) return;
  const out = Math.max(0, parseInt(document.getElementById("mo1").value) || 0);
  const inl = Math.max(0, parseInt(document.getElementById("mo2").value) || 0);
  const spd = parseInt(document.getElementById("mo3").value) || 50;
  if (out + inl > 0)
    State.edges.push({
      id: State.nextId++,
      from: State.interaction.pendingEdge.from,
      to: State.interaction.pendingEdge.to,
      out,
      inl,
      spd,
    });
  State.interaction.pendingEdge = null;
  hideModal();
  saveState();
}

function mOkNode() {
  if (!State.interaction.pendingNode) return;
  const n = State.interaction.pendingNode;
  n.lbl = document.getElementById("mn1").value;
  n.ctrl = document.getElementById("mn2").value;
  n.cycle = parseInt(document.getElementById("mn3").value) || 120;

  // Read Light Checkboxes
  n.lights = [];
  document.querySelectorAll(".light-cb").forEach((cb) => {
    if (cb.checked) n.lights.push(parseInt(cb.getAttribute("data-edge")));
  });

  // Read Turn Checkboxes
  n.banned_turns = [];
  document.querySelectorAll(".turn-cb").forEach((cb) => {
    if (!cb.checked)
      n.banned_turns.push({
        from: parseInt(cb.getAttribute("data-from")),
        to: parseInt(cb.getAttribute("data-to")),
      });
  });

  const savedId = n.id;
  State.interaction.pendingNode = null;
  hideModal();
  if (
    State.interaction.selected?.type === "node" &&
    State.interaction.selected.id === savedId
  )
    inspectIntersection(savedId);
  saveState();
}

function mCancel() {
  State.interaction.pendingEdge = null;
  State.interaction.pendingNode = null;
  hideModal();
}

function addNode(x, y) {
  const lbl =
    String.fromCharCode(65 + (State.nodeCount % 26)) +
    (State.nodeCount >= 26 ? String(Math.floor(State.nodeCount / 26)) : "");
  State.nodeCount++;
  State.nodes.push({
    id: State.nextId++,
    x,
    y,
    lbl,
    ctrl: "signalized",
    cycle: 120,
    banned_turns: [],
    lights: [],
  });
  saveState();
}

function deleteNode(id) {
  State.nodes = State.nodes.filter((n) => n.id !== id);
  const edgesToRemove = new Set(
    State.edges.filter((e) => e.from === id || e.to === id).map((e) => e.id),
  );
  State.edges = State.edges.filter((e) => !edgesToRemove.has(e.id));
  State.cars = State.cars.filter((c) => !edgesToRemove.has(c.edgeId));
  if (
    State.interaction.selected?.type === "node" &&
    State.interaction.selected.id === id
  ) {
    State.interaction.selected = null;
    hideInspector();
  }
  saveState();
}

function deleteEdge(id) {
  State.edges = State.edges.filter((e) => e.id !== id);
  State.cars = State.cars.filter((c) => c.edgeId !== id);

  // Clean up phantom lights and rules if an edge is deleted
  State.nodes.forEach((n) => {
    if (n.lights) n.lights = n.lights.filter((l) => l !== id);
    if (n.banned_turns)
      n.banned_turns = n.banned_turns.filter(
        (bt) => bt.from !== id && bt.to !== id,
      );
  });

  if (
    State.interaction.selected?.type === "edge" &&
    State.interaction.selected.id === id
  ) {
    State.interaction.selected = null;
    hideInspector();
  }
  saveState();
}

function clearAll() {
  State.nodes = [];
  State.edges = [];
  State.cars = [];
  State.interaction.selected = null;
  State.interaction.routeFromNode = null;
  State.nodeCount = 0;
  hideInspector();
  updateUIHint();
  saveState();
}

function loadSample() {
  clearAll();
  const spacing = 180,
    labels = "ABCDEFGHI";
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      State.nodes.push({
        id: State.nextId++,
        x: (c - 1) * spacing,
        y: (r - 1) * spacing,
        lbl: labels[r * 3 + c],
        ctrl: "signalized",
        cycle: 120,
        banned_turns: [],
        lights: [],
      });
  State.nodeCount = 9;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 2; c++)
      State.edges.push({
        id: State.nextId++,
        from: State.nodes[r * 3 + c].id,
        to: State.nodes[r * 3 + c + 1].id,
        out: 2,
        inl: 2,
        spd: 60,
      });
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 3; c++)
      State.edges.push({
        id: State.nextId++,
        from: State.nodes[r * 3 + c].id,
        to: State.nodes[(r + 1) * 3 + c].id,
        out: 2,
        inl: 1,
        spd: 40,
      });
  const crossEdges = [
    [0, 4],
    [4, 8],
    [2, 4],
    [6, 4],
  ];
  crossEdges.forEach(([f, t]) =>
    State.edges.push({
      id: State.nextId++,
      from: State.nodes[f].id,
      to: State.nodes[t].id,
      out: 1,
      inl: 1,
      spd: 30,
    }),
  );
  saveState();
}

// --- INPUT LISTENERS ---
function getHoveredNode(wx, wy) {
  for (const n of State.nodes) {
    const dx = n.x - wx,
      dy = n.y - wy;
    if (dx * dx + dy * dy < CONFIG.NODE_RADIUS * CONFIG.NODE_RADIUS * 2.8)
      return n.id;
  }
  return null;
}

function getHoveredEdge(wx, wy) {
  for (const e of State.edges) {
    const geom = getEdgeGeometry(e);
    if (!geom) continue;
    const ax = wx - geom.A.x,
      ay = wy - geom.A.y,
      t = (ax * geom.ux + ay * geom.uy) / geom.length;
    if (t < -0.05 || t > 1.05) continue;
    const d = ax * geom.px + ay * geom.py;
    if (d > -e.inl * CONFIG.LANE_WIDTH - 8 && d < e.out * CONFIG.LANE_WIDTH + 8)
      return e.id;
  }
  return null;
}

cv.addEventListener("mousedown", (ev) => {
  const [wx, wy] = screenToWorld(ev.offsetX, ev.offsetY);
  if (State.interaction.mode === "pan") {
    State.interaction.isDragging = true;
    State.interaction.dragStartX = ev.offsetX;
    State.interaction.dragStartY = ev.offsetY;
    State.interaction.camStartX = State.camera.x;
    State.interaction.camStartY = State.camera.y;
  } else if (State.interaction.mode === "node") {
    if (getHoveredNode(wx, wy) === null) addNode(wx, wy);
  } else if (State.interaction.mode === "road") {
    const nodeId = getHoveredNode(wx, wy);
    if (nodeId !== null) {
      if (State.interaction.routeFromNode === null) {
        State.interaction.routeFromNode = nodeId;
        updateUIHint();
      } else if (State.interaction.routeFromNode !== nodeId) {
        const isDuplicate = State.edges.find(
          (e) =>
            (e.from === State.interaction.routeFromNode && e.to === nodeId) ||
            (e.from === nodeId && e.to === State.interaction.routeFromNode),
        );
        if (!isDuplicate) {
          State.interaction.pendingEdge = {
            from: State.interaction.routeFromNode,
            to: nodeId,
          };
          State.interaction.routeFromNode = null;
          showModal("road");
        } else {
          State.interaction.routeFromNode = null;
        }
      }
    }
  } else if (State.interaction.mode === "sel") {
    const nodeId = getHoveredNode(wx, wy);
    if (nodeId !== null) inspectIntersection(nodeId);
    else {
      const edgeId = getHoveredEdge(wx, wy);
      if (edgeId !== null) inspectRoad(edgeId);
      else {
        State.interaction.selected = null;
        hideInspector();
      }
    }
  } else if (State.interaction.mode === "del") {
    const nodeId = getHoveredNode(wx, wy);
    if (nodeId !== null) deleteNode(nodeId);
    else {
      const edgeId = getHoveredEdge(wx, wy);
      if (edgeId !== null) deleteEdge(edgeId);
    }
  }
});

cv.addEventListener("mousemove", (ev) => {
  State.interaction.hoverCoords = [ev.offsetX, ev.offsetY];
  if (State.interaction.isDragging && State.interaction.mode === "pan") {
    State.camera.x =
      State.interaction.camStartX -
      (ev.offsetX - State.interaction.dragStartX) / State.camera.zoom;
    State.camera.y =
      State.interaction.camStartY -
      (ev.offsetY - State.interaction.dragStartY) / State.camera.zoom;
  }
  const [wx, wy] = screenToWorld(ev.offsetX, ev.offsetY),
    onNode = getHoveredNode(wx, wy) !== null,
    onEdge = getHoveredEdge(wx, wy) !== null;
  cv.style.cursor =
    State.interaction.mode === "pan"
      ? State.interaction.isDragging
        ? "grabbing"
        : "grab"
      : State.interaction.mode === "node"
        ? onNode
          ? "not-allowed"
          : "crosshair"
        : State.interaction.mode === "road"
          ? onNode
            ? "pointer"
            : "crosshair"
          : State.interaction.mode === "del"
            ? onNode || onEdge
              ? "pointer"
              : "default"
            : "default";
});

cv.addEventListener("mouseup", () => {
  State.interaction.isDragging = false;
});
cv.addEventListener("mouseleave", () => {
  State.interaction.isDragging = false;
  State.interaction.hoverCoords = null;
});

cv.addEventListener(
  "wheel",
  (ev) => {
    ev.preventDefault();
    const [wx, wy] = screenToWorld(ev.offsetX, ev.offsetY),
      factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
    State.camera.zoom = Math.max(0.1, Math.min(5, State.camera.zoom * factor));
    State.camera.x = wx - (ev.offsetX - cv.width / 2) / State.camera.zoom;
    State.camera.y = wy - (ev.offsetY - cv.height / 2) / State.camera.zoom;
  },
  { passive: false },
);

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    State.interaction.routeFromNode = null;
    hideModal();
    updateUIHint();
  }
});

// --- MAIN ANIMATION LOOP ---
function frame(timestamp) {
  requestAnimationFrame(frame);
  resizeCanvas();

  const rawDt = Math.min((timestamp - State.simulation.lastTime) / 1000, 0.05);
  State.simulation.lastTime = timestamp;

  const speedSlider = document.getElementById("sim-speed");
  const speedMultiplier = speedSlider ? parseFloat(speedSlider.value) : 1.0;
  const simDt = rawDt * speedMultiplier;

  ctx.fillStyle = CONFIG.COLORS.bg;
  ctx.fillRect(0, 0, cv.width, cv.height);

  drawGrid();
  drawRoads();
  drawIntersections();
  drawTrafficLights();
  drawInteractionOverlays();

  if (State.simulation.isRunning) {
    updateTrafficLights(simDt);
    updateCars(simDt);
    spawnCars();
    updateInspectorLiveStats();
  }

  drawCars();
}

// INITIALIZATION
loadState();
setMode("pan");
requestAnimationFrame(frame);
