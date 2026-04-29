// math.js
const worldToScreen = (wx, wy) => [
  (wx - State.camera.x) * State.camera.zoom + cv.width / 2,
  (wy - State.camera.y) * State.camera.zoom + cv.height / 2,
];

const screenToWorld = (sx, sy) => [
  (sx - cv.width / 2) / State.camera.zoom + State.camera.x,
  (sy - cv.height / 2) / State.camera.zoom + State.camera.y,
];

function getEdgeGeometry(edge) {
  const nodeA = getNode(edge.from);
  const nodeB = getNode(edge.to);
  if (!nodeA || !nodeB) return null;

  const dx = nodeB.x - nodeA.x;
  const dy = nodeB.y - nodeA.y;
  const length = Math.sqrt(dx * dx + dy * dy);

  if (length < 1) return null;
  return {
    A: nodeA,
    B: nodeB,
    length,
    ux: dx / length,
    uy: dy / length,
    px: -dy / length,
    py: dx / length,
  };
}

function calculateTurnType(edgeIn, edgeOut, node) {
  const prevNode = getNode(edgeIn.to === node.id ? edgeIn.from : edgeIn.to);
  const nextNode = getNode(
    edgeOut.from === node.id ? edgeOut.to : edgeOut.from,
  );
  if (!prevNode || !nextNode) return "Unknown";

  const angle1 = Math.atan2(node.y - prevNode.y, node.x - prevNode.x);
  const angle2 = Math.atan2(nextNode.y - node.y, nextNode.x - node.x);

  let angleDiff = angle2 - angle1;
  while (angleDiff <= -Math.PI) angleDiff += 2 * Math.PI;
  while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;

  const degrees = angleDiff * (180 / Math.PI);

  if (degrees > 135 || degrees < -135) return "U-Turn";
  if (degrees > 25) return "Right Turn";
  if (degrees < -25) return "Left Turn";
  return "Straight";
}
