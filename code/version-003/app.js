import { Graph } from "./graph.js";
import { Renderer } from "./renderer.js";
import { saveGraph, loadGraph } from "./storage.js";

const canvas = document.getElementById("canvas");
function resizeCanvas() {
  const toolbar = document.getElementById("toolbar");
  const toolbarWidth = toolbar.offsetWidth;

  canvas.width = window.innerWidth - toolbarWidth;
  canvas.height = window.innerHeight;

  renderer.draw();
}

// run once
resizeCanvas();

// run on resize
window.addEventListener("resize", resizeCanvas);

const graph = new Graph();
const renderer = new Renderer(canvas, graph);

let mode = "addNode";
let selectedNode = null;
let selectedElement = null;

// ---------- BUTTONS ----------
document.getElementById("addNode").onclick = () => (mode = "addNode");
document.getElementById("addEdge").onclick = () => (mode = "addEdge");
document.getElementById("select").onclick = () => (mode = "select");
document.getElementById("delete").onclick = () => (mode = "delete");

document.getElementById("save").onclick = () => saveGraph(graph);
document.getElementById("load").onclick = () => {
  loadGraph(graph);
  renderer.draw();
};

// ---------- CANVAS ----------
canvas.addEventListener("click", (e) => {
  const x = e.offsetX;
  const y = e.offsetY;

  const node = graph.getNodeAt(x, y);
  const edge = getEdgeAt(x, y);

  if (mode === "addNode") {
    graph.addNode(x, y);
  } else if (mode === "addEdge" && node) {
    if (!selectedNode) {
      selectedNode = node;
    } else {
      graph.addEdge(selectedNode, node);
      selectedNode = null;
    }
  } else if (mode === "select") {
    if (node) {
      selectedElement = node;
      showNodeProperties(node);
    } else if (edge) {
      selectedElement = edge;
      showEdgeProperties(edge);
    }
  } else if (mode === "delete") {
    if (node) graph.deleteNode(node);
    else if (edge) graph.deleteEdge(edge);
  }

  renderer.draw();
});

// ---------- EDGE DETECTION ----------
function getEdgeAt(x, y) {
  return graph.edges.find((e) => {
    const n1 = graph.nodes.find((n) => n.id === e.from);
    const n2 = graph.nodes.find((n) => n.id === e.to);

    return pointToLineDistance(x, y, n1, n2) < 6;
  });
}

function pointToLineDistance(px, py, n1, n2) {
  const A = px - n1.x;
  const B = py - n1.y;
  const C = n2.x - n1.x;
  const D = n2.y - n1.y;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = dot / lenSq;

  param = Math.max(0, Math.min(1, param));

  const xx = n1.x + param * C;
  const yy = n1.y + param * D;

  return Math.hypot(px - xx, py - yy);
}

// ---------- NODE PROPERTIES ----------
function showNodeProperties(node) {
  document.getElementById("properties").innerHTML = `
    <h3>${node.id}</h3>

    <label>Type</label>
    <select id="type">
      <option ${node.type === "traffic_light" ? "selected" : ""}>traffic_light</option>
      <option ${node.type === "stop" ? "selected" : ""}>stop</option>
    </select>

    <label>Capacity</label>
    <input id="capacity" type="number" value="${node.capacity}">
  `;

  document.getElementById("type").onchange = (e) =>
    (node.type = e.target.value);

  document.getElementById("capacity").oninput = (e) =>
    (node.capacity = +e.target.value);
}

// ---------- EDGE PROPERTIES ----------
function showEdgeProperties(edge) {
  const dir1 = `${edge.from}->${edge.to}`;
  const dir2 = `${edge.to}->${edge.from}`;

  document.getElementById("properties").innerHTML = `
    <h3>${edge.id}</h3>

    <label>Road Type</label>
    <select id="dirType">
      <option ${edge.directionType === "two_way" ? "selected" : ""}>two_way</option>
      <option ${edge.directionType === dir1 ? "selected" : ""}>${dir1}</option>
      <option ${edge.directionType === dir2 ? "selected" : ""}>${dir2}</option>
    </select>

    <button id="addLane">+ Add Lane</button>

    ${edge.lanes
      .map(
        (lane, i) => `
      <div class="laneBox">
        <b>Lane ${i + 1}</b>

        <select data-i="${i}" class="laneFlow">
          <option ${lane.flow === dir1 ? "selected" : ""}>${dir1}</option>
          <option ${lane.flow === dir2 ? "selected" : ""}>${dir2}</option>
        </select>

        <select data-i="${i}" class="laneType">
          <option ${lane.type === "straight" ? "selected" : ""}>straight</option>
          <option ${lane.type === "left" ? "selected" : ""}>left</option>
          <option ${lane.type === "right" ? "selected" : ""}>right</option>
        </select>

        <button data-i="${i}" class="removeLane">X</button>
      </div>
    `,
      )
      .join("")}
  `;

  document.getElementById("dirType").onchange = (e) => {
    edge.directionType = e.target.value;
    applyDirectionRules(edge);
    showEdgeProperties(edge);
  };

  document.getElementById("addLane").onclick = () => {
    edge.lanes.push({
      id: "L" + Date.now(),
      flow: dir1,
      type: "straight",
      vehicles: [],
    });
    showEdgeProperties(edge);
  };

  document.querySelectorAll(".removeLane").forEach((btn) => {
    btn.onclick = (e) => {
      const i = e.target.dataset.i;
      edge.lanes.splice(i, 1);
      showEdgeProperties(edge);
    };
  });

  document.querySelectorAll(".laneFlow").forEach((el) => {
    el.onchange = (e) => {
      const i = e.target.dataset.i;
      edge.lanes[i].flow = e.target.value;
    };
  });

  document.querySelectorAll(".laneType").forEach((el) => {
    el.onchange = (e) => {
      const i = e.target.dataset.i;
      edge.lanes[i].type = e.target.value;
    };
  });
}

// ---------- DIRECTION RULES ----------
function applyDirectionRules(edge) {
  const dir1 = `${edge.from}->${edge.to}`;
  const dir2 = `${edge.to}->${edge.from}`;

  if (edge.directionType === dir1) {
    edge.lanes = edge.lanes.filter((l) => l.flow === dir1);
  } else if (edge.directionType === dir2) {
    edge.lanes = edge.lanes.filter((l) => l.flow === dir2);
  } else if (edge.directionType === "two_way") {
    const has1 = edge.lanes.some((l) => l.flow === dir1);
    const has2 = edge.lanes.some((l) => l.flow === dir2);

    if (!has1)
      edge.lanes.push({
        id: "L" + Date.now(),
        flow: dir1,
        type: "straight",
        vehicles: [],
      });

    if (!has2)
      edge.lanes.push({
        id: "L" + Date.now(),
        flow: dir2,
        type: "straight",
        vehicles: [],
      });
  }
}

// ---------- INIT ----------
renderer.draw();
