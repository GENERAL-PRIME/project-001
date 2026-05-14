// ⚠️ DEPRECATED: This file is legacy and has been replaced by modular structure.
// New architecture uses:
//   - state.js   — Global state management
//   - math.js    — Coordinate transformations and geometry
//   - render.js  — Canvas drawing
//   - simulation.js — Traffic physics and AI
//   - main.js    — UI and interaction
//   - utils.js   — Common utilities and validation
//
// This file can be safely deleted. The HTML has been updated to load
// the modular scripts instead.

window.TF = (function () {
  const cv = document.getElementById("cv"),
    ctx = cv.getContext("2d"),
    wp = document.getElementById("wp");
  let nodes = [],
    edges = [],
    cars = [],
    nid = 1,
    nc = 0;
  let vx = 0,
    vy = 0,
    vz = 1;
  let mode = "pan",
    drag = false,
    dox = 0,
    doy = 0,
    dvx = 0,
    dvy = 0;
  let rfrom = null,
    sel = null,
    hov = null,
    simOn = false,
    lastT = 0,
    pend = null,
    pendNode = null;

  // Visual Configuration
  const LW = 14,
    NR = 18,
    CL = 10,
    CW = 5.5,
    AG = 200; // AG=200 reduces the frequency of road arrows
  const C = {
    bg: "#080d16",
    gr: "#0d1522",
    rd: "#111b2b",
    re: "#1c2e44",
    div: "rgba(255,210,50,0.4)",
    ln: "rgba(255,255,255,0.14)",
    nb: "#091c30",
    nbr: "#1a90b8",
    ng: "#2ec4e8",
    oa: "#30d870",
    ia: "#ff6535",
    sl: "#f5c518",
    cc: [
      "#ff6b35",
      "#ffd166",
      "#06d6a0",
      "#4fc9e8",
      "#ef476f",
      "#c39be8",
      "#f9cb42",
      "#2dde8a",
    ],
  };

  // Coordinate Math
  const w2s = (wx, wy) => [
    (wx - vx) * vz + cv.width / 2,
    (wy - vy) * vz + cv.height / 2,
  ];
  const s2w = (sx, sy) => [
    (sx - cv.width / 2) / vz + vx,
    (sy - cv.height / 2) / vz + vy,
  ];
  const gn = (id) => nodes.find((n) => n.id === id);
  const ge = (id) => edges.find((e) => e.id === id);

  // --- SAVE & LOAD LOGIC ---
  function saveState() {
    const data = { nodes, edges, nid, nc };
    localStorage.setItem("trafficMapSave", JSON.stringify(data));
  }

  function loadState() {
    const saved = localStorage.getItem("trafficMapSave");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        nodes = data.nodes || [];
        edges = data.edges || [];
        nid = data.nid || 1;
        nc = data.nc || 0;
      } catch (e) {
        console.error("Failed to load map save", e);
      }
    }
  }

  function exportMap() {
    const data = JSON.stringify({ nodes, edges, nid, nc }, null, 2);
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
        nodes = data.nodes || [];
        edges = data.edges || [];
        nid = data.nid || 1;
        nc = data.nc || 0;
        cars = [];
        saveState();
      } catch (err) {
        alert("Invalid map file!");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  // --- TURN CLASSIFICATION MATH ---
  function getTurnType(e1, e2, n) {
    const prevNode = gn(e1.to === n.id ? e1.from : e1.to);
    const nextNode = gn(e2.from === n.id ? e2.to : e2.from);
    if (!prevNode || !nextNode) return "Unknown";

    const dx1 = n.x - prevNode.x;
    const dy1 = n.y - prevNode.y;
    const angle1 = Math.atan2(dy1, dx1);

    const dx2 = nextNode.x - n.x;
    const dy2 = nextNode.y - n.y;
    const angle2 = Math.atan2(dy2, dx2);

    let angleDiff = angle2 - angle1;
    while (angleDiff <= -Math.PI) angleDiff += 2 * Math.PI;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    const degrees = angleDiff * (180 / Math.PI);

    if (degrees > 135 || degrees < -135) return "U-Turn";
    if (degrees > 25) return "Right Turn";
    if (degrees < -25) return "Left Turn";
    return "Straight";
  }

  function gm(e) {
    const A = gn(e.from),
      B = gn(e.to);
    if (!A || !B) return null;
    const dx = B.x - A.x,
      dy = B.y - A.y,
      l = Math.sqrt(dx * dx + dy * dy);
    if (l < 1) return null;
    return { A, B, l, ux: dx / l, uy: dy / l, px: -dy / l, py: dx / l };
  }
  function rsz() {
    const r = wp.getBoundingClientRect();
    cv.width = r.width;
    cv.height = r.height;
  }

  // --- DRAWING LOGIC ---
  function grid() {
    const s = 50,
      [wx0, wy0] = s2w(0, 0),
      [wx1, wy1] = s2w(cv.width, cv.height);
    ctx.strokeStyle = C.gr;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(wx0 / s) * s; x < wx1; x += s) {
      const [a, b] = w2s(x, wy0),
        [c, d] = w2s(x, wy1);
      ctx.moveTo(a, b);
      ctx.lineTo(c, d);
    }
    for (let y = Math.floor(wy0 / s) * s; y < wy1; y += s) {
      const [a, b] = w2s(wx0, y),
        [c, d] = w2s(wx1, y);
      ctx.moveTo(a, b);
      ctx.lineTo(c, d);
    }
    ctx.stroke();
  }

  function dEdge(e) {
    const g = gm(e);
    if (!g) return;
    const isSel = sel && sel.t === "edge" && sel.id === e.id;
    const rW = e.out * LW,
      lW = e.inl * LW;
    const co = [
      [g.A.x + rW * g.px, g.A.y + rW * g.py],
      [g.B.x + rW * g.px, g.B.y + rW * g.py],
      [g.B.x - lW * g.px, g.B.y - lW * g.py],
      [g.A.x - lW * g.px, g.A.y - lW * g.py],
    ];
    ctx.beginPath();
    const [x0, y0] = w2s(co[0][0], co[0][1]);
    ctx.moveTo(x0, y0);
    for (let i = 1; i < 4; i++) {
      const [x, y] = w2s(co[i][0], co[i][1]);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = isSel ? "#1a2c18" : C.rd;
    ctx.fill();
    if (isSel) {
      ctx.strokeStyle = C.sl;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    const ll = (off, col, ds) => {
      const [sx, sy] = w2s(g.A.x + off * g.px, g.A.y + off * g.py),
        [ex, ey] = w2s(g.B.x + off * g.px, g.B.y + off * g.py);
      ctx.beginPath();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ds ? ctx.setLineDash(ds) : ctx.setLineDash([]);
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    ll(0, C.div, [6, 5]);
    for (let i = 1; i < e.out; i++) ll(i * LW, C.ln, [4, 6]);
    for (let i = 1; i < e.inl; i++) ll(-i * LW, C.ln, [4, 6]);
    ll(rW, C.re, null);
    ll(-lW, C.re, null);

    // ARROW DRAWING
    if (vz > 0.28) {
      const n = Math.max(1, Math.floor(g.l / AG));
      for (let s = 0; s < n; s++) {
        const t = (s + 0.5) / n;
        for (let i = 0; i < e.out; i++) {
          const o = (i + 0.5) * LW;
          arw(
            g.A.x + t * g.l * g.ux + o * g.px,
            g.A.y + t * g.l * g.uy + o * g.py,
            g.ux,
            g.uy,
            C.oa,
          );
        }
        for (let i = 0; i < e.inl; i++) {
          const o = (i + 0.5) * LW;
          arw(
            g.B.x + t * g.l * -g.ux + o * -g.px,
            g.B.y + t * g.l * -g.uy + o * -g.py,
            -g.ux,
            -g.uy,
            C.ia,
          );
        }
      }
    }
  }

  function arw(wx, wy, ux, uy, col) {
    const sz = 5.5 * vz,
      [sx, sy] = w2s(wx, wy),
      px = -uy,
      py = ux;
    ctx.beginPath();
    ctx.moveTo(sx + ux * sz, sy + uy * sz);
    ctx.lineTo(
      sx - ux * sz * 0.7 + px * sz * 0.55,
      sy - uy * sz * 0.7 + py * sz * 0.55,
    );
    ctx.lineTo(sx - ux * sz * 0.2, sy - uy * sz * 0.2);
    ctx.lineTo(
      sx - ux * sz * 0.7 - px * sz * 0.55,
      sy - uy * sz * 0.7 - py * sz * 0.55,
    );
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
  }

  function dNode(n) {
    const [sx, sy] = w2s(n.x, n.y),
      r = NR * vz;
    const isSel = sel && sel.t === "node" && sel.id === n.id,
      rf = rfrom === n.id;
    if (isSel || rf) {
      ctx.beginPath();
      ctx.arc(sx, sy, r * 1.85, 0, Math.PI * 2);
      ctx.strokeStyle = rf ? C.sl : C.ng;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.3;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = C.nb;
    ctx.fill();
    ctx.strokeStyle = isSel || rf ? C.sl : C.nbr;
    ctx.lineWidth = isSel || rf ? 2 : 1.5;
    ctx.stroke();
    ctx.strokeStyle = C.nbr + "55";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx - r * 0.5, sy);
    ctx.lineTo(sx + r * 0.5, sy);
    ctx.moveTo(sx, sy - r * 0.5);
    ctx.lineTo(sx, sy + r * 0.5);
    ctx.stroke();

    if (vz > 0.42 && n.lbl) {
      ctx.fillStyle = C.ng;
      ctx.font = `600 ${Math.max(7, Math.round(9 * vz))}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(n.lbl, sx, sy);
    }
  }

  function dCar(c) {
    const e = ge(c.eid);
    if (!e) return;
    const g = gm(e);
    if (!g) return;
    const o = (c.lane + 0.5) * LW;
    let wx, wy, ux, uy;
    if (c.dir === "out") {
      wx = g.A.x + c.t * g.l * g.ux + o * g.px;
      wy = g.A.y + c.t * g.l * g.uy + o * g.py;
      ux = g.ux;
      uy = g.uy;
    } else {
      wx = g.B.x + c.t * g.l * -g.ux + o * -g.px;
      wy = g.B.y + c.t * g.l * -g.uy + o * -g.py;
      ux = -g.ux;
      uy = -g.uy;
    }
    const [sx, sy] = w2s(wx, wy),
      hl = (CL * vz) / 2,
      hw = (CW * vz) / 2;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(Math.atan2(uy, ux));

    // Draw car body (Red if stopped)
    ctx.beginPath();
    ctx.rect(-hl, -hw, hl * 2, hw * 2);
    ctx.fillStyle = c.isStopped ? "#ff3333" : c.col;
    ctx.fill();

    ctx.beginPath();
    ctx.rect(hl * 0.1, -hw * 0.65, hl * 0.75, hw * 1.3);
    ctx.fillStyle = "rgba(200,230,255,0.28)";
    ctx.fill();
    ctx.restore();
  }

  function spawn() {
    if (!simOn || !edges.length) return;
    const tgt = Math.min(
      parseInt(document.getElementById("dn").value) * Math.max(1, edges.length),
      220,
    );
    while (cars.length < tgt) {
      const e = edges[Math.floor(Math.random() * edges.length)];
      const ds = [];
      if (e.out > 0) ds.push("out");
      if (e.inl > 0) ds.push("in");
      if (!ds.length) continue;
      const dir = ds[Math.floor(Math.random() * ds.length)],
        ml = dir === "out" ? e.out : e.inl;
      cars.push({
        id: nid++,
        eid: e.id,
        dir,
        lane: Math.floor(Math.random() * ml),
        t: Math.random(),
        spd: (0.05 + Math.random() * 0.1) * (e.spd / 50),
        col: C.cc[Math.floor(Math.random() * C.cc.length)],
        isStopped: false,
      });
    }
    while (cars.length > tgt) cars.pop();
  }

  // --- TRAFFIC ENGINE (LIGHTS & TURN RULES) ---
  function tick(dt) {
    nodes.forEach((n) => {
      if (n.ctrl === "signalized") {
        n.phaseTimer = (n.phaseTimer || 0) + dt;
        const inEdges = edges
          .filter(
            (e) =>
              (e.to === n.id && e.out > 0) || (e.from === n.id && e.inl > 0),
          )
          .map((e) => e.id);

        if (inEdges.length > 0) {
          const phaseDuration = (n.cycle || 120) / inEdges.length;
          const currentPhaseIndex = Math.floor(
            (n.phaseTimer % (n.cycle || 120)) / phaseDuration,
          );
          n.activeGreenEdge = inEdges[currentPhaseIndex];
        }
      }
    });

    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i],
        e = ge(c.eid);
      if (!e) {
        cars.splice(i, 1);
        continue;
      }

      if (c.t < 1) {
        c.t += c.spd * dt * 60;
      }

      if (c.t >= 1) {
        const tgtNodeId = c.dir === "out" ? e.to : e.from;
        const n = gn(tgtNodeId);

        // Stop at red lights
        if (n && n.ctrl === "signalized" && n.activeGreenEdge !== e.id) {
          c.t = 0.98;
          c.isStopped = true;
          continue;
        }
        c.isStopped = false;

        // Gather potential turns
        let nextEdges = edges.filter(
          (x) =>
            x.id !== e.id &&
            ((x.from === tgtNodeId && x.out > 0) ||
              (x.to === tgtNodeId && x.inl > 0)),
        );

        // Filter out Banned Turns defined in the UI
        if (n && n.banned_turns) {
          nextEdges = nextEdges.filter((nextEdge) => {
            const isBanned = n.banned_turns.find(
              (bt) => bt.from === e.id && bt.to === nextEdge.id,
            );
            return !isBanned;
          });
        }

        if (!nextEdges.length) {
          cars.splice(i, 1);
        } else {
          const ne = nextEdges[Math.floor(Math.random() * nextEdges.length)];
          c.eid = ne.id;
          c.t = 0;
          if (ne.from === tgtNodeId && ne.out > 0) {
            c.dir = "out";
            c.lane = Math.floor(Math.random() * ne.out);
          } else {
            c.dir = "in";
            c.lane = Math.floor(Math.random() * ne.inl);
          }
        }
      } else {
        c.isStopped = false;
      }
    }
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    rsz();
    const dt = Math.min((ts - lastT) / 1000, 0.05);
    lastT = ts;
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, cv.width, cv.height);
    grid();
    edges.forEach(dEdge);
    nodes.forEach(dNode);
    if (simOn) {
      tick(dt);
      spawn();
    }
    cars.forEach(dCar);

    // Draw line when connecting nodes
    if (rfrom !== null && hov) {
      const fn = gn(rfrom);
      if (fn) {
        const [sx, sy] = w2s(fn.x, fn.y);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(hov[0], hov[1]);
        ctx.strokeStyle = C.sl + "80";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Live Occupancy Tracker
    if (sel && sel.t === "node" && simOn) {
      let occ = 0;
      cars.forEach((c) => {
        const e = ge(c.eid);
        if (e) {
          if (e.from === sel.id && c.t < 0.1) occ++;
          if (e.to === sel.id && c.t > 0.9) occ++;
        }
      });
      const el = document.getElementById("occ-val");
      if (el && el.innerText != occ) el.innerText = occ;
    }
  }

  // INITIAL STARTUP
  loadState();
  requestAnimationFrame(frame);

  // --- INTERACTION EVENT LISTENERS ---
  function pNode(wx, wy) {
    for (const n of nodes) {
      const dx = n.x - wx,
        dy = n.y - wy;
      if (dx * dx + dy * dy < NR * NR * 2.8) return n.id;
    }
    return null;
  }
  function pEdge(wx, wy) {
    for (const e of edges) {
      const g = gm(e);
      if (!g) continue;
      const ax = wx - g.A.x,
        ay = wy - g.A.y,
        t = (ax * g.ux + ay * g.uy) / g.l;
      if (t < -0.05 || t > 1.05) continue;
      const d = ax * g.px + ay * g.py;
      if (d > -e.inl * LW - 8 && d < e.out * LW + 8) return e.id;
    }
    return null;
  }
  cv.addEventListener("mousedown", (ev) => {
    const [wx, wy] = s2w(ev.offsetX, ev.offsetY);
    if (mode === "pan") {
      drag = true;
      dox = ev.offsetX;
      doy = ev.offsetY;
      dvx = vx;
      dvy = vy;
    } else if (mode === "node") {
      if (pNode(wx, wy) === null) addN(wx, wy);
    } else if (mode === "road") {
      const nn = pNode(wx, wy);
      if (nn !== null) {
        if (rfrom === null) {
          rfrom = nn;
          uHint();
        } else if (rfrom !== nn) {
          const dup = edges.find(
            (x) =>
              (x.from === rfrom && x.to === nn) ||
              (x.from === nn && x.to === rfrom),
          );
          if (!dup) {
            pend = { from: rfrom, to: nn };
            rfrom = null;
            showMoRoad();
          } else rfrom = null;
        }
      }
    } else if (mode === "sel") {
      const nn = pNode(wx, wy);
      if (nn !== null) doSel("node", nn);
      else {
        const ee = pEdge(wx, wy);
        if (ee !== null) doSel("edge", ee);
        else {
          sel = null;
          hidePn();
        }
      }
    } else if (mode === "del") {
      const nn = pNode(wx, wy);
      if (nn !== null) delN(nn);
      else {
        const ee = pEdge(wx, wy);
        if (ee !== null) delE(ee);
      }
    }
  });
  cv.addEventListener("mousemove", (ev) => {
    hov = [ev.offsetX, ev.offsetY];
    if (drag && mode === "pan") {
      vx = dvx - (ev.offsetX - dox) / vz;
      vy = dvy - (ev.offsetY - doy) / vz;
    }
    const [wx, wy] = s2w(ev.offsetX, ev.offsetY),
      on = pNode(wx, wy) !== null,
      oe = pEdge(wx, wy) !== null;
    cv.style.cursor =
      mode === "pan"
        ? drag
          ? "grabbing"
          : "grab"
        : mode === "node"
          ? on
            ? "not-allowed"
            : "crosshair"
          : mode === "road"
            ? on
              ? "pointer"
              : "crosshair"
            : mode === "del"
              ? on || oe
                ? "pointer"
                : "default"
              : "default";
  });
  cv.addEventListener("mouseup", () => {
    drag = false;
  });
  cv.addEventListener("mouseleave", () => {
    drag = false;
    hov = null;
  });
  cv.addEventListener(
    "wheel",
    (ev) => {
      ev.preventDefault();
      const [wx, wy] = s2w(ev.offsetX, ev.offsetY),
        f = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
      vz = Math.max(0.1, Math.min(5, vz * f));
      vx = wx - (ev.offsetX - cv.width / 2) / vz;
      vy = wy - (ev.offsetY - cv.height / 2) / vz;
    },
    { passive: false },
  );
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      rfrom = null;
      hideMo();
      uHint();
    }
  });

  function addN(x, y) {
    const lbl =
      String.fromCharCode(65 + (nc % 26)) +
      (nc >= 26 ? String(Math.floor(nc / 26)) : "");
    nc++;
    nodes.push({
      id: nid++,
      x,
      y,
      lbl,
      ctrl: "signalized",
      cycle: 120,
      banned_turns: [],
    });
    saveState();
  }
  function delN(id) {
    nodes = nodes.filter((n) => n.id !== id);
    const eids = new Set(
      edges.filter((e) => e.from === id || e.to === id).map((e) => e.id),
    );
    edges = edges.filter((e) => !eids.has(e.id));
    cars = cars.filter((c) => !eids.has(c.eid));
    if (sel && sel.t === "node" && sel.id === id) {
      sel = null;
      hidePn();
    }
    saveState();
  }
  function delE(id) {
    edges = edges.filter((e) => e.id !== id);
    cars = cars.filter((c) => c.eid !== id);
    if (sel && sel.t === "edge" && sel.id === id) {
      sel = null;
      hidePn();
    }
    saveState();
  }

  // --- UI MODALS & EDITORS ---
  function showMoRoad() {
    const mb = document.getElementById("mb");
    mb.innerHTML = `
    <h4>Configure Road</h4>
    <div class="mf"><label>OUTGOING LANES (→)</label><input type="number" id="mo1" min="0" max="6" value="2"></div>
    <div class="mf"><label>INCOMING LANES (←)</label><input type="number" id="mo2" min="0" max="6" value="2"></div>
    <div class="mf"><label>SPEED LIMIT</label><input type="number" id="mo3" min="10" max="120" value="50"></div>
    <div class="ma"><button onclick="TF.mCancel()">CANCEL</button><button class="ok" onclick="TF.mOk()">CREATE ROAD</button></div>
  `;
    document.getElementById("mo").classList.add("vis");
  }

  // DYNAMIC ROUTING UI
  function showMoNode(id) {
    const n = gn(id);
    if (!n) return;
    pendNode = n;
    n.banned_turns = n.banned_turns || [];

    // Generate Matrix of all incoming to outgoing paths
    const inEdges = edges.filter(
      (e) => (e.to === n.id && e.out > 0) || (e.from === n.id && e.inl > 0),
    );
    const outEdges = edges.filter(
      (e) => (e.from === n.id && e.out > 0) || (e.to === n.id && e.inl > 0),
    );

    let turnsHTML = "";
    if (inEdges.length > 0 && outEdges.length > 0) {
      turnsHTML += `<div style="max-height:160px; overflow-y:auto; border:1px solid var(--color-border-secondary); padding:8px; margin-bottom:12px; border-radius:4px; background:var(--color-background-secondary)">`;

      inEdges.forEach((ie) => {
        outEdges.forEach((oe) => {
          if (ie.id === oe.id) return; // Hide standard U-Turns for simplicity

          const prevN = gn(ie.to === n.id ? ie.from : ie.to);
          const nextN = gn(oe.from === n.id ? oe.to : oe.from);
          if (!prevN || !nextN) return;

          const tType = getTurnType(ie, oe, n);
          const isBanned = n.banned_turns.find(
            (bt) => bt.from === ie.id && bt.to === oe.id,
          );
          const checked = isBanned ? "" : "checked";

          turnsHTML += `<label style="display:flex; align-items:center; gap:8px; margin-bottom:6px; font-size:11px; cursor:pointer;">
          <input type="checkbox" class="turn-cb" data-from="${ie.id}" data-to="${oe.id}" ${checked}>
          <span style="color:var(--color-text-primary)">From <b>${prevN.lbl}</b> to <b>${nextN.lbl}</b> <i style="color:var(--color-text-tertiary)">(${tType})</i></span>
        </label>`;
        });
      });
      turnsHTML += `</div>`;
    } else {
      turnsHTML += `<div style="font-size:10px; color:var(--color-text-tertiary); margin-bottom:12px;">Connect multiple roads to this intersection to configure turn rules.</div>`;
    }

    const mb = document.getElementById("mb");
    mb.innerHTML = `
    <h4>Configure Intersection (${n.lbl})</h4>
    <div class="mf"><label>LABEL</label><input type="text" id="mn1" value="${n.lbl}"></div>
    <div class="mf"><label>CONTROL TYPE</label>
       <select id="mn2">
         <option value="signalized" ${n.ctrl === "signalized" ? "selected" : ""}>Signalized (Traffic Lights)</option>
         <option value="uncontrolled" ${n.ctrl === "uncontrolled" ? "selected" : ""}>Uncontrolled</option>
       </select>
    </div>
    <div class="mf"><label>CYCLE LENGTH (SEC)</label><input type="number" id="mn3" min="10" max="240" value="${n.cycle}"></div>
    
    <div class="mf"><label>ALLOWED TURNS</label>
        ${turnsHTML}
    </div>
    
    <div class="ma"><button onclick="TF.mCancel()">CANCEL</button><button class="ok" onclick="TF.mOkNode()">SAVE</button></div>
  `;
    document.getElementById("mo").classList.add("vis");
  }

  function hideMo() {
    document.getElementById("mo").classList.remove("vis");
  }

  function mOk() {
    if (!pend) return;
    const out = Math.max(
      0,
      parseInt(document.getElementById("mo1").value) || 0,
    );
    const inl = Math.max(
      0,
      parseInt(document.getElementById("mo2").value) || 0,
    );
    const spd = parseInt(document.getElementById("mo3").value) || 50;
    if (out + inl > 0)
      edges.push({ id: nid++, from: pend.from, to: pend.to, out, inl, spd });
    pend = null;
    hideMo();
    saveState();
  }

  function mOkNode() {
    if (!pendNode) return;
    pendNode.lbl = document.getElementById("mn1").value;
    pendNode.ctrl = document.getElementById("mn2").value;
    pendNode.cycle = parseInt(document.getElementById("mn3").value) || 120;

    // Save checkbox states back into the banned_turns array
    pendNode.banned_turns = [];
    document.querySelectorAll(".turn-cb").forEach((cb) => {
      if (!cb.checked) {
        pendNode.banned_turns.push({
          from: parseInt(cb.getAttribute("data-from")),
          to: parseInt(cb.getAttribute("data-to")),
        });
      }
    });

    const savedId = pendNode.id;
    pendNode = null;
    hideMo();
    if (sel && sel.t === "node" && sel.id === savedId) doSel("node", savedId);
    saveState();
  }

  function mCancel() {
    pend = null;
    pendNode = null;
    hideMo();
  }
  function setMode(m) {
    mode = m;
    rfrom = null;
    document
      .querySelectorAll('.tb[id^="m-"]')
      .forEach((b) => b.classList.remove("on"));
    const el = document.getElementById("m-" + m);
    if (el) el.classList.add("on");
    uHint();
  }
  function uHint() {
    const h = {
      pan: "PAN: drag  ·  ZOOM: scroll",
      sel: "SELECT: click node or road to inspect",
      node: "ADD NODE: click empty space to place intersection",
      road: rfrom
        ? "ADD ROAD: click destination node  (Esc = cancel)"
        : "ADD ROAD: click source node first",
      del: "DELETE: click a node or road to remove",
    };
    document.getElementById("ht").textContent = h[mode] || "";
  }

  function doSel(t, id) {
    sel = { t, id };
    document.getElementById("pn").classList.add("vis");
    const pt = document.getElementById("pt"),
      pc = document.getElementById("pc");
    if (t === "node") {
      const n = gn(id),
        ce = edges.filter((e) => e.from === id || e.to === id);
      let occ = 0;
      cars.forEach((c) => {
        const e = ge(c.eid);
        if (e && ((e.from === id && c.t < 0.1) || (e.to === id && c.t > 0.9)))
          occ++;
      });

      pt.textContent = "INTERSECTION";
      pc.innerHTML = `
      <div class="pr"><span class="pk">ID & LABEL</span><span class="pv">${n.id} : ${n.lbl}</span></div>
      <div class="pr"><span class="pk">CONTROL LOGIC</span><span class="pv" style="text-transform:capitalize;">${n.ctrl.replace("_", " ")}</span></div>
      <div class="pr"><span class="pk">CYCLE LENGTH</span><span class="pv">${n.cycle} seconds</span></div>
      <div class="pr"><span class="pk">TOPOLOGY (ROADS)</span><span class="pv">${ce.length}</span></div>
      <div class="pr"><span class="pk">DYNAMIC STATE (CARS)</span><span class="pv" id="occ-val" style="color:var(--color-text-info); font-weight:bold;">${occ}</span></div>
      <button onclick="TF.showMoNode(${n.id})" style="margin-top:10px; width:100%; padding:6px; background:transparent; color:var(--color-text-info); border:1px solid var(--color-border-info); border-radius:4px; cursor:pointer; font-size:10px; font-weight:bold; letter-spacing:1px;">EDIT PROPERTIES</button>
    `;
    } else {
      const e = ge(id),
        fN = gn(e.from),
        tN = gn(e.to),
        g = gm(e);
      pt.textContent = "ROAD SEGMENT";
      pc.innerHTML = `
      <div class="pr"><span class="pk">ROAD ID</span><span class="pv">${e.id}</span></div>
      <div class="pr"><span class="pk">FROM → TO</span><span class="pv">${fN?.lbl || "?"} → ${tN?.lbl || "?"}</span></div>
      <div class="pr"><span class="pk">OUTGOING LANES</span><span class="pv">${e.out}</span></div>
      <div class="pr"><span class="pk">INCOMING LANES</span><span class="pv">${e.inl}</span></div>
      <div class="pr"><span class="pk">SPEED LIMIT</span><span class="pv">${e.spd} u/s</span></div>
    `;
    }
  }

  function hidePn() {
    document.getElementById("pn").classList.remove("vis");
  }
  function toggleSim() {
    simOn = !simOn;
    const b = document.getElementById("sb");
    b.textContent = simOn ? "■ STOP" : "▶ SIMULATE";
    b.classList.toggle("stop", simOn);
    if (!simOn) cars = [];
  }
  function loadSample() {
    clearAll();
    const sp = 180,
      lb = "ABCDEFGHI";
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        nodes.push({
          id: nid++,
          x: (c - 1) * sp,
          y: (r - 1) * sp,
          lbl: lb[r * 3 + c],
          ctrl: "signalized",
          cycle: 120,
          banned_turns: [],
        });
    nc = 9;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 2; c++)
        edges.push({
          id: nid++,
          from: nodes[r * 3 + c].id,
          to: nodes[r * 3 + c + 1].id,
          out: 2,
          inl: 2,
          spd: 60,
        });
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < 3; c++)
        edges.push({
          id: nid++,
          from: nodes[r * 3 + c].id,
          to: nodes[(r + 1) * 3 + c].id,
          out: 2,
          inl: 1,
          spd: 40,
        });
    edges.push({
      id: nid++,
      from: nodes[0].id,
      to: nodes[4].id,
      out: 1,
      inl: 1,
      spd: 30,
    });
    edges.push({
      id: nid++,
      from: nodes[4].id,
      to: nodes[8].id,
      out: 1,
      inl: 1,
      spd: 30,
    });
    edges.push({
      id: nid++,
      from: nodes[2].id,
      to: nodes[4].id,
      out: 1,
      inl: 1,
      spd: 30,
    });
    edges.push({
      id: nid++,
      from: nodes[6].id,
      to: nodes[4].id,
      out: 1,
      inl: 1,
      spd: 30,
    });
    saveState();
  }
  function clearAll() {
    nodes = [];
    edges = [];
    cars = [];
    sel = null;
    rfrom = null;
    nc = 0;
    hidePn();
    uHint();
    saveState();
  }

  setMode("pan");
  uHint();
  return {
    setMode,
    toggleSim,
    loadSample,
    clearAll,
    mOk,
    mCancel,
    showMoNode,
    mOkNode,
    exportMap,
    importMap,
  };
})();
