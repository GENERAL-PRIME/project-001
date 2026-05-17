// areas.js — Multi-area management: storage, switching, and inter-area portal links.
// An "area" is one complete traffic_map (nodes + edges).  A "portal" is a link
// between a dangling edge-end in one area and a dangling edge-end in another.
// Cars that reach a portal exit are teleported into the partner area.

// ─── STORAGE KEYS ─────────────────────────────────────────────────────────────
const AREAS_KEY = "trafficAreas_v6";
const PORTALS_KEY = "trafficPortals_v6";
const ACTIVE_KEY = "trafficActiveArea_v6";

// ─── RUNTIME STATE ────────────────────────────────────────────────────────────
// All areas: Map<areaId, AreaRecord>
//   AreaRecord = { id, name, nodes, edges, nextId, nodeCount }
let Areas = new Map();

// Portal links: array of PortalLink
//   PortalLink = { id, a: {areaId, nodeId, edgeId}, b: {areaId, nodeId, edgeId} }
let Portals = [];

// Id of the area currently loaded into State
let ActiveAreaId = null;

// Increments for generating area & portal ids
let _nextAreaId = 1;
let _nextPortalId = 1;

// ─── AREA CRUD ────────────────────────────────────────────────────────────────
/**
 * Creates a brand-new blank area and returns its id.
 * @param {string} name
 * @returns {string} areaId
 */
function createArea(name) {
  const id = "area_" + _nextAreaId++;
  Areas.set(id, {
    id,
    name: name || `Area ${Areas.size + 1}`,
    nodes: [],
    edges: [],
    nextId: 1,
    nodeCount: 0,
  });
  saveAreas();
  return id;
}

/**
 * Renames an area.
 * @param {string} areaId
 * @param {string} newName
 */
function renameArea(areaId, newName) {
  const area = Areas.get(areaId);
  if (!area) return;
  area.name = newName.trim() || area.name;
  saveAreas();
}

/**
 * Deletes an area and all portals that reference it.
 * @param {string} areaId
 */
function deleteArea(areaId) {
  if (Areas.size <= 1) {
    alert("Cannot delete the only area. Create another first.");
    return;
  }
  Areas.delete(areaId);
  Portals = Portals.filter(
    (p) => p.a.areaId !== areaId && p.b.areaId !== areaId,
  );
  saveAreas();
  savePortals();

  if (ActiveAreaId === areaId) {
    // Switch to the first remaining area
    switchArea(Areas.keys().next().value);
  } else {
    rebuildAreaDropdown();
  }
}

// ─── SNAPSHOT: commit live State into the active area record ──────────────────
/**
 * Saves the live State (nodes, edges, nextId, nodeCount) into Areas map.
 * Must be called before switching away from an area.
 */
function snapshotActiveArea() {
  if (!ActiveAreaId) return;
  const area = Areas.get(ActiveAreaId);
  if (!area) return;
  area.nodes = State.nodes.map((n) => deepClone(n));
  area.edges = State.edges.map((e) => deepClone(e));
  area.nextId = State.nextId;
  area.nodeCount = State.nodeCount;
}

// ─── SWITCH AREA ──────────────────────────────────────────────────────────────
/**
 * Commits current area, loads target area into State, rebuilds UI.
 * @param {string} areaId
 */
function switchArea(areaId) {
  if (!Areas.has(areaId)) return;

  // 1. Stop simulation and commit current area
  if (State.simulation.isRunning) toggleSim();
  snapshotActiveArea();
  saveAreas();

  // 2. Load target area into live State
  const area = Areas.get(areaId);
  ActiveAreaId = areaId;

  State.nodes = area.nodes.map((n) => deepClone(n));
  State.edges = area.edges.map((e) => deepClone(e));
  State.nextId = area.nextId;
  State.nodeCount = area.nodeCount;
  State.cars = [];

  sanitizeState();

  // 3. Persist active area id
  try {
    localStorage.setItem(ACTIVE_KEY, areaId);
  } catch (e) {}

  // 4. Rebuild UI
  State.interaction.selected = null;
  hideInspector();
  rebuildAreaDropdown();
  updatePortalBadges();
}

// ─── DANGLING-NODE DETECTION ──────────────────────────────────────────────────
/**
 * Returns nodes that have exactly one connected edge (exit/entry portals).
 * @param {string} [areaId] defaults to ActiveAreaId
 * @returns {Array<{node, edge}>}
 */
function getDanglingNodes(areaId) {
  const area = areaId
    ? Areas.get(areaId)
    : { nodes: State.nodes, edges: State.edges };
  if (!area) return [];

  return area.nodes
    .map((node) => {
      const connected = area.edges.filter(
        (e) => e.from === node.id || e.to === node.id,
      );
      return connected.length === 1 ? { node, edge: connected[0] } : null;
    })
    .filter(Boolean);
}

// ─── PORTAL CRUD ──────────────────────────────────────────────────────────────
/**
 * Links two dangling endpoints across areas.
 * @param {{areaId,nodeId,edgeId}} endpointA
 * @param {{areaId,nodeId,edgeId}} endpointB
 * @returns {string} portalId
 */
function createPortal(endpointA, endpointB) {
  // Remove any existing portals that use these endpoints
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

/**
 * Removes a portal by id.
 * @param {string} portalId
 */
function deletePortal(portalId) {
  Portals = Portals.filter((p) => p.id !== portalId);
  savePortals();
  updatePortalBadges();
}

function _endpointMatches(ep, target) {
  return (
    ep.areaId === target.areaId &&
    ep.nodeId === target.nodeId &&
    ep.edgeId === target.edgeId
  );
}

/**
 * Finds the portal (if any) for a given dangling node/edge in a given area.
 * @param {string} areaId
 * @param {number} nodeId
 * @param {number} edgeId
 * @returns {PortalLink|null}
 */
function getPortalForEndpoint(areaId, nodeId, edgeId) {
  return (
    Portals.find(
      (p) =>
        _endpointMatches(p.a, { areaId, nodeId, edgeId }) ||
        _endpointMatches(p.b, { areaId, nodeId, edgeId }),
    ) || null
  );
}

/**
 * Given a portal and the "from" endpoint, returns the other endpoint.
 */
function getOtherEndpoint(portal, fromAreaId, fromNodeId) {
  if (portal.a.areaId === fromAreaId && portal.a.nodeId === fromNodeId)
    return portal.b;
  return portal.a;
}

// ─── PERSISTENCE ──────────────────────────────────────────────────────────────
function saveAreas() {
  try {
    const serialisable = {};
    Areas.forEach((area, id) => {
      serialisable[id] = area;
    });
    localStorage.setItem(
      AREAS_KEY,
      JSON.stringify({
        areas: serialisable,
        nextAreaId: _nextAreaId,
      }),
    );
  } catch (e) {
    console.error("Failed to save areas:", e);
  }
}

function savePortals() {
  try {
    localStorage.setItem(
      PORTALS_KEY,
      JSON.stringify({
        portals: Portals,
        nextPortalId: _nextPortalId,
      }),
    );
  } catch (e) {
    console.error("Failed to save portals:", e);
  }
}

function loadAreas() {
  try {
    const raw = localStorage.getItem(AREAS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      _nextAreaId = parsed.nextAreaId || 1;
      Object.values(parsed.areas || {}).forEach((area) => {
        Areas.set(area.id, area);
      });
    }
  } catch (e) {
    console.error("Failed to load areas:", e);
  }

  try {
    const raw = localStorage.getItem(PORTALS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      _nextPortalId = parsed.nextPortalId || 1;
      Portals = parsed.portals || [];
    }
  } catch (e) {
    console.error("Failed to load portals:", e);
  }
}

// ─── BOOTSTRAP ────────────────────────────────────────────────────────────────
/**
 * Called once on startup.  Migrates any existing trafficMapSave_v6 into Area 1,
 * then loads or creates the active area.
 */
function initAreas() {
  loadAreas();

  // Migration: if no areas exist yet, import the old single-map save
  if (Areas.size === 0) {
    const oldSave =
      getFromStorage("trafficMapSave_v6") || getFromStorage("trafficMapSave");
    const id = "area_" + _nextAreaId++;
    const migratedArea = {
      id,
      name: "Area 1",
      nodes: oldSave && Array.isArray(oldSave.nodes) ? oldSave.nodes : [],
      edges: oldSave && Array.isArray(oldSave.edges) ? oldSave.edges : [],
      nextId: (oldSave && oldSave.nextId) || 1,
      nodeCount: (oldSave && oldSave.nodeCount) || 0,
    };
    Areas.set(id, migratedArea);
    saveAreas();
  }

  // Determine which area to load
  let targetId = null;
  try {
    targetId = localStorage.getItem(ACTIVE_KEY);
  } catch (e) {}
  if (!targetId || !Areas.has(targetId)) {
    targetId = Areas.keys().next().value;
  }

  // Load it (without calling switchArea which would call toggleSim/hideInspector before DOM ready)
  const area = Areas.get(targetId);
  ActiveAreaId = targetId;
  State.nodes = area.nodes.map((n) => deepClone(n));
  State.edges = area.edges.map((e) => deepClone(e));
  State.nextId = area.nextId;
  State.nodeCount = area.nodeCount;
  sanitizeState();
}

// ─── UI: AREA DROPDOWN ────────────────────────────────────────────────────────
/**
 * Rebuilds the area dropdown to reflect current Areas map.
 * Also updates portal badge counts on dangling nodes.
 */
function rebuildAreaDropdown() {
  const dropdown = document.getElementById("area-select");
  if (!dropdown) return;
  dropdown.innerHTML = "";
  Areas.forEach((area, id) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = area.name;
    if (id === ActiveAreaId) opt.selected = true;
    dropdown.appendChild(opt);
  });
}

// ─── UI: PORTAL MANAGER MODAL ─────────────────────────────────────────────────
function openPortalManager() {
  // Commit current state before inspecting dangling nodes across areas
  snapshotActiveArea();

  // Collect all dangling nodes across all areas
  const allDangling = [];
  Areas.forEach((area, areaId) => {
    const nodes = area.nodes;
    const edges = area.edges;
    nodes.forEach((node) => {
      const connected = edges.filter(
        (e) => e.from === node.id || e.to === node.id,
      );
      if (connected.length === 1) {
        const edge = connected[0];
        const portal = getPortalForEndpoint(areaId, node.id, edge.id);
        allDangling.push({ areaId, areaName: area.name, node, edge, portal });
      }
    });
  });

  if (allDangling.length === 0) {
    alert(
      "No dangling nodes found.\n\nA dangling node is an intersection connected to only one road. Add nodes with a single road in different areas to create portals between them.",
    );
    return;
  }

  // Build modal HTML
  let html = `<h4>PORTAL LINKS</h4>`;
  html += `<p style="font-size:10px;color:var(--color-text-secondary);margin-bottom:12px;line-height:1.5;">
    Portals connect dangling roads between areas. Cars leaving one will appear at the other.<br>
    A dangling node has exactly <b>one</b> connected road.
  </p>`;

  // Show existing portals
  if (Portals.length > 0) {
    html += `<div style="margin-bottom:14px;">`;
    html += `<span class="pk" style="display:block;margin-bottom:6px;">ACTIVE PORTALS</span>`;
    Portals.forEach((p) => {
      const aA = Areas.get(p.a.areaId);
      const aB = Areas.get(p.b.areaId);
      const nA = aA?.nodes.find((n) => n.id === p.a.nodeId);
      const nB = aB?.nodes.find((n) => n.id === p.b.nodeId);
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

  // New portal form
  html += `<span class="pk" style="display:block;margin-bottom:6px;">CREATE NEW PORTAL</span>`;

  const makeEndpointOptions = (selectId) => {
    let opts = `<select id="${selectId}" style="width:100%;padding:6px 8px;font:inherit;font-size:11px;background:var(--color-background-secondary);border:1px solid var(--color-border-secondary);color:var(--color-text-primary);border-radius:4px;outline:none;">`;
    opts += `<option value="">— select endpoint —</option>`;
    allDangling.forEach((d, idx) => {
      const linked = d.portal ? " 🔗" : "";
      opts += `<option value="${idx}">${d.areaName} · Node ${d.node.lbl}${linked}</option>`;
    });
    opts += `</select>`;
    return opts;
  };

  html += `
    <div class="mf" style="margin-bottom:8px;">
      <label>ENDPOINT A</label>
      ${makeEndpointOptions("portal-ep-a")}
    </div>
    <div class="mf" style="margin-bottom:14px;">
      <label>ENDPOINT B</label>
      ${makeEndpointOptions("portal-ep-b")}
    </div>`;

  html += `<div class="ma">
    <button onclick="hideModal()">CANCEL</button>
    <button class="ok" onclick="_confirmCreatePortal()">LINK</button>
  </div>`;

  // Stash dangling list for confirm handler
  window._portalDanglingCache = allDangling;

  document.getElementById("mb").innerHTML = html;
  document.getElementById("mo").classList.add("vis");
}

function _confirmCreatePortal() {
  const dangling = window._portalDanglingCache || [];
  const idxA = parseInt(document.getElementById("portal-ep-a").value);
  const idxB = parseInt(document.getElementById("portal-ep-b").value);

  if (isNaN(idxA) || isNaN(idxB) || idxA === idxB) {
    alert("Please select two different endpoints.");
    return;
  }

  const dA = dangling[idxA];
  const dB = dangling[idxB];

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

// ─── PORTAL BADGE: visual indicator on canvas dangling nodes ──────────────────
/**
 * Draws a small "⇄" glyph near dangling nodes that have an active portal.
 * Called from the render loop after drawIntersections().
 */
function drawPortalIndicators() {
  const dangling = getDanglingNodes();
  dangling.forEach(({ node, edge }) => {
    const portal = getPortalForEndpoint(ActiveAreaId, node.id, edge.id);
    if (!portal) return;

    const [sx, sy] = worldToScreen(node.x, node.y);
    const r = CONFIG.NODE_RADIUS * State.camera.zoom;

    // Pulsing ring
    ctx.beginPath();
    ctx.arc(sx, sy, r * 2.2, 0, Math.PI * 2);
    ctx.strokeStyle = "#a855f7";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label badge
    if (State.camera.zoom > 0.35) {
      const partner = getOtherEndpoint(portal, ActiveAreaId, node.id);
      const partnerArea = Areas.get(partner.areaId);
      const partnerNode = partnerArea?.nodes.find(
        (n) => n.id === partner.nodeId,
      );
      const label = partnerArea
        ? `⇄ ${partnerArea.name}${partnerNode ? " · " + partnerNode.lbl : ""}`
        : "⇄";

      ctx.font = `bold ${Math.max(8, Math.round(9 * Math.min(State.camera.zoom, 1)))}px monospace`;
      const tw = ctx.measureText(label).width;
      const bx = sx - tw / 2 - 4;
      const by = sy - r * 2.8 - 14;
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

/**
 * Updates the portal count badge in the toolbar (if element exists).
 */
function updatePortalBadges() {
  rebuildAreaDropdown();
  const badge = document.getElementById("portal-count");
  if (badge) badge.textContent = Portals.length > 0 ? Portals.length : "";
}

// ─── INTER-AREA CAR TRANSFER ──────────────────────────────────────────────────
/**
 * Queued cross-area car transfers: [{targetAreaId, car}]
 * Processed at end of each simulation step to avoid mid-loop mutation.
 */
let _pendingTransfers = [];

/**
 * Called by updateCars when a car reaches a dangling node that has a portal.
 * @param {Object} car
 * @param {number} targetNodeId
 * @param {Object} edge
 */
function schedulePortalTransfer(car, targetNodeId, edge) {
  const portal = getPortalForEndpoint(ActiveAreaId, targetNodeId, edge.id);
  if (!portal) return false;

  const dest = getOtherEndpoint(portal, ActiveAreaId, targetNodeId);
  _pendingTransfers.push({
    targetAreaId: dest.areaId,
    edgeId: dest.edgeId,
    nodeId: dest.nodeId,
    speed: car.baseSpeed,
    color: car.color,
    isEmergency: car.isEmergency || false,
  });
  return true; // signal: remove this car from active area
}

/**
 * Flush pending transfers into their target areas.
 * Cars entering the active area are injected into State.cars.
 * Cars entering other areas are injected into that area's saved record.
 */
function flushPortalTransfers() {
  if (_pendingTransfers.length === 0) return;

  const batch = _pendingTransfers.splice(0);
  batch.forEach(
    ({ targetAreaId, edgeId, nodeId, speed, color, isEmergency }) => {
      if (targetAreaId === ActiveAreaId) {
        // Inject directly into live simulation
        const edge = getEdge(edgeId);
        if (!edge) return;
        const dir = edge.from === nodeId ? "out" : "in";
        const maxLanes = dir === "out" ? edge.out : edge.inl;
        State.cars.push({
          id: State.nextId++,
          edgeId,
          direction: dir,
          lane: Math.floor(Math.random() * Math.max(1, maxLanes)),
          progress: 0,
          baseSpeed: speed,
          speed: 0,
          color,
          isEmergency,
          isStopped: false,
          waitTime: 0,
          tripTime: 0,
          fromPortal: true, // cosmetic flag for potential future use
        });
      } else {
        // Inject into dormant area's car queue (best-effort; area will pick up on next switch)
        const area = Areas.get(targetAreaId);
        if (!area) return;
        const edge = area.edges.find((e) => e.id === edgeId);
        if (!edge) return;
        const dir = edge.from === nodeId ? "out" : "in";
        const maxLanes = dir === "out" ? edge.out : edge.inl;
        if (!area.pendingCars) area.pendingCars = [];
        area.pendingCars.push({
          id: area.nextId++,
          edgeId,
          direction: dir,
          lane: Math.floor(Math.random() * Math.max(1, maxLanes)),
          progress: 0,
          baseSpeed: speed,
          speed: 0,
          color,
          isEmergency,
          isStopped: false,
          waitTime: 0,
          tripTime: 0,
          fromPortal: true,
        });
      }
    },
  );
}
