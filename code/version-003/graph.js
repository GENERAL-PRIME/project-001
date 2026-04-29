export class Graph {
  constructor() {
    this.nodes = [];
    this.edges = [];
  }

  addNode(x, y) {
    const node = {
      id: "N" + this.nodes.length,
      x,
      y,
      type: "traffic_light",
      capacity: 50,

      ports: {
        N: { incoming: [], outgoing: [] },
        E: { incoming: [], outgoing: [] },
        S: { incoming: [], outgoing: [] },
        W: { incoming: [], outgoing: [] },
      },
    };

    this.nodes.push(node);
    return node;
  }

  addEdge(n1, n2) {
    const edge = {
      id: "R" + this.edges.length,

      from: n1.id,
      to: n2.id,

      directionType: "two_way",

      lanes: [
        {
          id: "L1",
          flow: `${n1.id}->${n2.id}`,
          type: "straight",
          vehicles: [],
        },
        {
          id: "L2",
          flow: `${n2.id}->${n1.id}`,
          type: "straight",
          vehicles: [],
        },
      ],

      speedLimit: 50,
      length: this.distance(n1, n2),
    };

    this.edges.push(edge);
    return edge;
  }

  deleteNode(node) {
    this.nodes = this.nodes.filter((n) => n !== node);
    this.edges = this.edges.filter(
      (e) => e.from !== node.id && e.to !== node.id,
    );
  }

  deleteEdge(edge) {
    this.edges = this.edges.filter((e) => e !== edge);
  }

  getNodeAt(x, y) {
    return this.nodes.find((n) => Math.hypot(n.x - x, n.y - y) < 10);
  }

  distance(n1, n2) {
    return Math.hypot(n1.x - n2.x, n1.y - n2.y);
  }
}
