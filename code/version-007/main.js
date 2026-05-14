// main.js — UI management, event listeners, and the main animation loop.
// Handles:
//   - Modal dialogs for creating/editing roads and intersections
//   - Inspector panel for viewing node/road details
//   - User input handling (mouse, keyboard, wheel)
//   - Event listeners and mode management
//   - Main animation loop

// ─── Modal: Road ──────────────────────────────────────────────────────────────
function showModal(type) {
  if (type === "road") {
    // FIX: Pre-calculate visual distance to use as a default logical baseline
    let defaultLen = 100;
    if (State.interaction.pendingEdge) {
      const nA = getNode(State.interaction.pendingEdge.from);
      const nB = getNode(State.interaction.pendingEdge.to);
      if (nA && nB) {
        const dx = nB.x - nA.x,
          dy = nB.y - nA.y;
        defaultLen = Math.round(Math.sqrt(dx * dx + dy * dy));
      }
    }

    document.getElementById("mb").innerHTML = `
      <h4>Configure Road</h4>
      <div class="mf"><label>OUTGOING LANES (→)</label><input type="number" id="mo1" min="0" max="6" value="2"></div>
      <div class="mf"><label>INCOMING LANES (←)</label><input type="number" id="mo2" min="0" max="6" value="2"></div>
      <div class="mf"><label>SPEED LIMIT (km/h)</label><input type="number" id="mo3" min="10" max="120" value="50"></div>
      <div class="mf"><label>LOGICAL LENGTH (m)</label><input type="number" id="mo4" min="10" max="10000" value="${defaultLen}"></div>
      <div class="ma"><button onclick="mCancel()">CANCEL</button><button class="ok" onclick="mOk()">CREATE</button></div>`;
  }
  document.getElementById("mo").classList.add("vis");
}

// ─── Modal: Intersection ──────────────────────────────────────────────────────
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

  let lightsHTML = "";
  if (inEdges.length > 0) {
    lightsHTML += `<div style="max-height:120px; overflow-y:auto; border:1px solid var(--color-border-secondary); padding:8px; margin-bottom:12px; border-radius:4px; background:var(--color-background-secondary)">`;
    inEdges.forEach((ie) => {
      const prevN = getNode(ie.to === node.id ? ie.from : ie.to);
      if (!prevN) return;
      const hasLight = node.lights.includes(ie.id);
      lightsHTML += `<label style="display:flex; align-items:center; gap:8px; margin-bottom:6px; font-size:11px; cursor:pointer;">
                <input type="checkbox" class="light-cb" data-edge="${ie.id}" ${
                  hasLight ? "checked" : ""
                }>
                <span style="color:var(--color-text-primary)">Traffic Light facing <b>${
                  prevN.lbl
                }</b></span>
            </label>`;
    });
    lightsHTML += `</div>`;
  } else {
    lightsHTML += `<div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:12px;">Connect incoming roads to assign lights.</div>`;
  }

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
        // Lane width info for narrow↔broad road visibility
        const ieLanes = ie.to === node.id ? ie.out : ie.inl;
        const oeLanes = oe.from === node.id ? oe.out : oe.inl;
        const widthTag =
          ieLanes !== oeLanes
            ? `<span style="font-size:9px; padding:1px 4px; border-radius:3px; background:rgba(245,197,24,0.15); color:#f5c518; margin-left:2px;">${ieLanes}→${oeLanes} lanes</span>`
            : `<span style="font-size:9px; color:var(--color-text-tertiary); margin-left:2px;">${ieLanes} lane${ieLanes !== 1 ? "s" : ""}</span>`;
        turnsHTML += `<label style="display:flex; align-items:center; gap:8px; margin-bottom:6px; font-size:11px; cursor:pointer;">
                    <input type="checkbox" class="turn-cb" data-from="${ie.id}" data-to="${oe.id}" ${
                      isBanned ? "" : "checked"
                    }>
                    <span style="color:var(--color-text-primary)">From <b>${
                      prevN.lbl
                    }</b> to <b>${
                      nextN.lbl
                    }</b> <i style="color:var(--color-text-tertiary)">(${tType})</i>${widthTag}</span>
                </label>`;
      });
    });
    turnsHTML += `</div>`;
  } else {
    turnsHTML += `<div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:12px;">Connect multiple roads to configure turns.</div>`;
  }

  const isSignalized = node.ctrl === "signalized";
  document.getElementById("mb").innerHTML = `
        <h4>Configure Intersection (${node.lbl})</h4>
        <div class="mf"><label>LABEL</label><input type="text" id="mn1" value="${node.lbl}"></div>
        <div class="mf"><label>CONTROL TYPE</label>
           <select id="mn2" onchange="
             const sig = this.value === 'signalized';
             document.getElementById('mn-cycle-row').style.display = sig ? '' : 'none';
             document.getElementById('mn-lights-row').style.display = sig ? '' : 'none';
           ">
             <option value="signalized" ${
               node.ctrl === "signalized" ? "selected" : ""
             }>Signalized (Traffic Lights)</option>
             <option value="uncontrolled" ${
               node.ctrl === "uncontrolled" ? "selected" : ""
             }>Uncontrolled (Give Way)</option>
           </select>
        </div>
        <div class="mf" id="mn-cycle-row" style="display:${isSignalized ? "" : "none"}"><label>CYCLE LENGTH (SEC)</label><input type="number" id="mn3" min="10" max="240" value="${
          node.cycle
        }"></div>
        <div class="mf" id="mn-lights-row" style="display:${isSignalized ? "" : "none"}"><label>ASSIGN TRAFFIC LIGHTS</label>${lightsHTML}</div>
        <div class="mf"><label>ALLOWED TURNS</label>${turnsHTML}</div>
        <div class="ma"><button onclick="mCancel()">CANCEL</button><button class="ok" onclick="mOkNode()">SAVE</button></div>`;
  document.getElementById("mo").classList.add("vis");
}

function showMoEdge(id) {
  const edge = getEdge(id);
  if (!edge) return;
  State.interaction.pendingEditEdge = edge;
  const fromNode = getNode(edge.from);
  const toNode = getNode(edge.to);
  const geom = getEdgeGeometry(edge);

  // FIX: Load existing logical length into modal
  const defaultLen = edge.len || (geom ? Math.round(geom.length) : 100);

  const mb = document.getElementById("mb");
  mb.innerHTML = `
        <h4>Edit Road (${fromNode?.lbl} → ${toNode?.lbl})</h4>
        <div class="mf"><label>OUTGOING LANES (→)</label><input type="number" id="me1" min="0" max="6" value="${edge.out}"></div>
        <div class="mf"><label>INCOMING LANES (←)</label><input type="number" id="me2" min="0" max="6" value="${edge.inl}"></div>
        <div class="mf"><label>SPEED LIMIT (km/h)</label><input type="number" id="me3" min="10" max="120" value="${edge.spd}"></div>
        <div class="mf"><label>LOGICAL LENGTH (m)</label><input type="number" id="me4" min="10" max="10000" value="${defaultLen}"></div>
        <div class="ma"><button onclick="mCancel()">CANCEL</button><button class="ok" onclick="mOkEditEdge()">SAVE</button></div>
    `;
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
    lightsHTML += `</span></div>
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

  // FIX: Display decoupled lengths in inspector
  const logicalLen = edge.len || (geom ? Math.round(geom.length) : "?");

  document.getElementById("pt").textContent = "ROAD SEGMENT";
  document.getElementById("pc").innerHTML = `
        <div class="pr"><span class="pk">ROAD ID</span><span class="pv">${edge.id}</span></div>
        <div class="pr"><span class="pk">FROM → TO</span><span class="pv">${fromNode?.lbl} → ${toNode?.lbl}</span></div>
        <div class="pr"><span class="pk">OUTGOING LANES</span><span class="pv">${edge.out}</span></div>
        <div class="pr"><span class="pk">INCOMING LANES</span><span class="pv">${edge.inl}</span></div>
        <div class="pr"><span class="pk">SPEED LIMIT</span><span class="pv">${edge.spd} km/h</span></div>
        <div class="pr"><span class="pk">VISUAL LENGTH</span><span class="pv">${geom ? Math.round(geom.length) : "?"} px</span></div>
        <div class="pr"><span class="pk">LOGICAL LENGTH</span><span class="pv" style="color:var(--color-text-info);font-weight:bold">${logicalLen} m</span></div>
        <button onclick="showMoEdge(${edge.id})" style="margin-top:10px; width:100%; padding:6px; background:transparent; color:var(--color-text-info); border:1px solid var(--color-border-info); border-radius:4px; cursor:pointer; font-size:10px; font-weight:bold;">EDIT PROPERTIES</button>
    `;
}

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

  if (!State.simulation.isRunning) {
    State.cars = [];
    saveState();
    if (State.interaction.selected?.type === "node")
      inspectIntersection(State.interaction.selected.id);
  }
}

// ─── Modal Save Handlers ──────────────────────────────────────────────────────
function mOk() {
  if (!State.interaction.pendingEdge) return;
  const out = Math.max(0, parseInt(document.getElementById("mo1").value) || 0);
  const inl = Math.max(0, parseInt(document.getElementById("mo2").value) || 0);
  const spd = parseInt(document.getElementById("mo3").value) || 50;
  const len = parseInt(document.getElementById("mo4").value) || 100; // FIX: Saving Logical Length

  if (out + inl > 0)
    State.edges.push({
      id: State.nextId++,
      from: State.interaction.pendingEdge.from,
      to: State.interaction.pendingEdge.to,
      out,
      inl,
      spd,
      len,
    });
  State.interaction.pendingEdge = null;
  hideModal();
  saveState();
}

function mOkNode() {
  if (!State.interaction.pendingNode) return;
  const n = State.interaction.pendingNode;
  const prevCtrl = n.ctrl;

  n.lbl = document.getElementById("mn1").value;
  n.ctrl = document.getElementById("mn2").value;
  n.cycle = parseInt(document.getElementById("mn3").value) || 120;

  if (n.ctrl === "uncontrolled") {
    // Switching to uncontrolled: strip all traffic-light & AI state
    n.lights = [];
    delete n.ai;
    delete n.edgeStats;
    delete n.activeGreenEdge;
    delete n.phaseTimer;
  } else {
    // Switching to (or staying) signalized: ensure lights array exists
    n.lights = [];
    document.querySelectorAll(".light-cb").forEach((cb) => {
      if (cb.checked) n.lights.push(parseInt(cb.getAttribute("data-edge")));
    });
    // Reset AI so it re-initialises cleanly on next sim tick
    if (prevCtrl !== n.ctrl) {
      delete n.ai;
      delete n.edgeStats;
      delete n.activeGreenEdge;
    }
  }

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

function mOkEditEdge() {
  if (!State.interaction.pendingEditEdge) return;
  const edge = State.interaction.pendingEditEdge;

  const newOut = Math.max(
    0,
    parseInt(document.getElementById("me1").value) || 0,
  );
  const newInl = Math.max(
    0,
    parseInt(document.getElementById("me2").value) || 0,
  );
  const newSpd = parseInt(document.getElementById("me3").value) || 50;
  const newLen = parseInt(document.getElementById("me4").value) || 100; // FIX: Appyling updated Logical Length

  if (newOut + newInl === 0) {
    alert(
      "A road must have at least one lane. To delete it entirely, use the DELETE tool.",
    );
    return;
  }

  edge.out = newOut;
  edge.inl = newInl;
  edge.spd = newSpd;
  edge.len = newLen;

  State.cars.forEach((car) => {
    if (car.edgeId === edge.id) {
      if (car.direction === "out" && car.lane >= newOut)
        car.lane = Math.max(0, newOut - 1);
      if (car.direction === "in" && car.lane >= newInl)
        car.lane = Math.max(0, newInl - 1);
    }
  });

  const savedId = edge.id;
  State.interaction.pendingEditEdge = null;
  hideModal();
  if (
    State.interaction.selected?.type === "edge" &&
    State.interaction.selected.id === savedId
  )
    inspectRoad(savedId);
  saveState();
}

function mCancel() {
  State.interaction.pendingEdge = null;
  State.interaction.pendingNode = null;
  State.interaction.pendingEditEdge = null;
  State.interaction.pendingNewNode = null;
  hideModal();
}

function addNode(x, y) {
  // Show a modal asking for node type before committing
  const defaultLbl =
    String.fromCharCode(65 + (State.nodeCount % 26)) +
    (State.nodeCount >= 26 ? String(Math.floor(State.nodeCount / 26)) : "");
  State.interaction.pendingNewNode = { x, y };

  document.getElementById("mb").innerHTML = `
    <h4>New Intersection</h4>
    <div class="mf"><label>LABEL</label><input type="text" id="nn-lbl" value="${defaultLbl}" maxlength="4"></div>
    <div class="mf"><label>CONTROL TYPE</label>
      <select id="nn-ctrl" onchange="
        document.getElementById('nn-cycle-row').style.display =
          this.value === 'signalized' ? '' : 'none';
      ">
        <option value="signalized">Signalized (Traffic Lights)</option>
        <option value="uncontrolled">Uncontrolled (Give Way)</option>
      </select>
    </div>
    <div class="mf" id="nn-cycle-row"><label>CYCLE LENGTH (SEC)</label>
      <input type="number" id="nn-cycle" min="10" max="240" value="120">
    </div>
    <div class="ma">
      <button onclick="mCancel()">CANCEL</button>
      <button class="ok" onclick="mOkNewNode()">PLACE NODE</button>
    </div>`;
  document.getElementById("mo").classList.add("vis");
}

function mOkNewNode() {
  const pending = State.interaction.pendingNewNode;
  if (!pending) return;

  const lbl = (document.getElementById("nn-lbl").value || "?").trim();
  const ctrl = document.getElementById("nn-ctrl").value;
  const cycle = parseInt(document.getElementById("nn-cycle")?.value) || 120;

  State.nodeCount++;
  State.nodes.push({
    id: State.nextId++,
    x: pending.x,
    y: pending.y,
    lbl,
    ctrl,
    cycle,
    banned_turns: [],
    lights: ctrl === "signalized" ? [] : undefined,
  });

  // Normalise: uncontrolled nodes should not carry a lights array
  const newNode = State.nodes[State.nodes.length - 1];
  if (newNode.ctrl === "uncontrolled") delete newNode.lights;

  State.interaction.pendingNewNode = null;
  hideModal();
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
  State.nodes.forEach((n) => {
    if (n.lights) n.lights = n.lights.filter((l) => l !== id);
    if (n.banned_turns)
      n.banned_turns = n.banned_turns.filter(
        (bt) => bt.from !== id && bt.to !== id,
      );
    if (n.ai && n.ai.memory && n.ai.memory[id]) delete n.ai.memory[id];
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
  let nid = 1;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      State.nodes.push({
        id: nid++,
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
        id: nid++,
        from: State.nodes[r * 3 + c].id,
        to: State.nodes[r * 3 + c + 1].id,
        out: 2,
        inl: 2,
        spd: 60,
      });
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 3; c++)
      State.edges.push({
        id: nid++,
        from: State.nodes[r * 3 + c].id,
        to: State.nodes[(r + 1) * 3 + c].id,
        out: 2,
        inl: 1,
        spd: 40,
      });
  State.edges.push({
    id: nid++,
    from: State.nodes[0].id,
    to: State.nodes[4].id,
    out: 1,
    inl: 1,
    spd: 30,
  });
  State.edges.push({
    id: nid++,
    from: State.nodes[4].id,
    to: State.nodes[8].id,
    out: 1,
    inl: 1,
    spd: 30,
  });
  State.nextId = nid;
  saveState();
}

// ─── Input Listeners ──────────────────────────────────────────────────────────
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
        } else State.interaction.routeFromNode = null;
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

// Attach mouseup to document, not cv, so releasing the mouse anywhere
// (e.g. over the density/speed sliders in the toolbar) always clears the
// drag state. Previously, releasing outside cv left isDragging=true,
// which caused the camera to keep panning and ate slider drag events.
document.addEventListener("mouseup", () => {
  State.interaction.isDragging = false;
});
cv.addEventListener("mouseleave", () => {
  // Do NOT clear isDragging here — the document mouseup above handles it.
  // Clearing it on mouseleave broke panning when the cursor briefly left the canvas edge.
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

// function spawnEmergencyVehicle() {
//   if (!State.edges.length) return;
//   const edge = State.edges[Math.floor(Math.random() * State.edges.length)];
//   const availableDirs = [];
//   if (edge.out > 0) availableDirs.push("out");
//   if (edge.inl > 0) availableDirs.push("in");
//   if (!availableDirs.length) return;
//   const dir = availableDirs[Math.floor(Math.random() * availableDirs.length)];
//   const maxLanes = dir === "out" ? edge.out : edge.inl;

//   State.cars.push({
//     id: State.nextId++,
//     edgeId: edge.id,
//     direction: dir,
//     lane: Math.floor(Math.random() * maxLanes),
//     progress: 0,
//     speed: (edge.spd / 50) * 1.5 * 60,
//     color: CONFIG.COLORS.emergency,
//     isEmergency: true,
//     isStopped: false,
//     waitTime: 0,
//     tripTime: 0,
//   });
// }

// ─── MAIN ANIMATION LOOP ──────────────────────────────────────────────────────
function frame(timestamp) {
  requestAnimationFrame(frame);
  resizeCanvas();

  const rawDt = Math.min((timestamp - State.simulation.lastTime) / 1000, 0.05);
  State.simulation.lastTime = timestamp;

  ctx.fillStyle = CONFIG.COLORS.bg;
  ctx.fillRect(0, 0, cv.width, cv.height);

  drawGrid();
  drawRoads();
  drawIntersections();
  if (typeof drawTrafficLights === "function") drawTrafficLights();
  drawInteractionOverlays();

  if (State.simulation.isRunning) {
    const speedMultiplier = parseFloat(
      document.getElementById("sim-speed")?.value || 1.0,
    );
    State.simulation.accumulator += rawDt * speedMultiplier;

    const maxSubSteps = 8;
    let steps = 0;
    while (
      State.simulation.accumulator >= SIM_CONFIG.FIXED_STEP &&
      steps < maxSubSteps
    ) {
      const dt = SIM_CONFIG.FIXED_STEP;
      State.simulation.clock += dt;
      State.simulation.accumulator -= dt;
      steps++;

      if (typeof updateTrafficLights === "function") updateTrafficLights(dt);
      if (typeof updateCars === "function") updateCars(dt);
      if (typeof spawnCars === "function") spawnCars();
      if (typeof updateMetrics === "function") updateMetrics(dt);
    }
    if (State.simulation.accumulator > SIM_CONFIG.FIXED_STEP * maxSubSteps) {
      State.simulation.accumulator = 0;
    }
    if (typeof updateInspectorLiveStats === "function")
      updateInspectorLiveStats();
  }

  if (typeof drawCars === "function") drawCars();
  if (typeof drawSimulationClock === "function") drawSimulationClock();
}

loadState();
setMode("pan");
requestAnimationFrame(frame);
