export function saveGraph(graph) {
  localStorage.setItem("trafficGraph", JSON.stringify(graph));
  alert("Saved!");
}

export function loadGraph(graph) {
  const data = localStorage.getItem("trafficGraph");
  if (!data) {
    alert("No saved data");
    return;
  }

  const parsed = JSON.parse(data);
  graph.nodes = parsed.nodes;
  graph.edges = parsed.edges;
}
