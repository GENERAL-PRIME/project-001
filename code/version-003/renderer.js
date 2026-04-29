export class Renderer {
  constructor(canvas, graph) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.graph = graph;
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw edges
    this.graph.edges.forEach((e) => {
      const n1 = this.graph.nodes.find((n) => n.id === e.from);
      const n2 = this.graph.nodes.find((n) => n.id === e.to);

      ctx.beginPath();
      ctx.moveTo(n1.x, n1.y);
      ctx.lineTo(n2.x, n2.y);
      ctx.strokeStyle = "#555";
      ctx.lineWidth = 4;
      ctx.stroke();
    });

    // Draw nodes
    this.graph.nodes.forEach((n) => {
      ctx.beginPath();
      ctx.arc(n.x, n.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = "red";
      ctx.fill();

      ctx.fillStyle = "black";
      ctx.fillText(n.id, n.x + 10, n.y);
    });
  }
}
