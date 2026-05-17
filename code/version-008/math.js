// math.js — Pure coordinate math and geometry helpers with detailed documentation.

// ─── COORDINATE TRANSFORMATIONS ───────────────────────────────────────────────
/**
 * Converts world coordinates to screen (canvas) coordinates
 * @param {number} wx - World X
 * @param {number} wy - World Y
 * @returns {Array} [screenX, screenY]
 */
const worldToScreen = (wx, wy) => [
  (wx - State.camera.x) * State.camera.zoom + cv.width / 2,
  (wy - State.camera.y) * State.camera.zoom + cv.height / 2,
];

/**
 * Converts screen (canvas) coordinates to world coordinates
 * @param {number} sx - Screen X
 * @param {number} sy - Screen Y
 * @returns {Array} [worldX, worldY]
 */
const screenToWorld = (sx, sy) => [
  (sx - cv.width / 2) / State.camera.zoom + State.camera.x,
  (sy - cv.height / 2) / State.camera.zoom + State.camera.y,
];

// ─── EDGE GEOMETRY ────────────────────────────────────────────────────────────
/**
 * Calculates edge geometry including unit vectors and logical length
 * @param {Object} edge
 * @returns {Object|null} Geometry object with A, B, length, logicalLength, unit vectors, etc.
 */
function getEdgeGeometry(edge) {
  if (!edge) return null;

  const nodeA = getNode(edge.from);
  const nodeB = getNode(edge.to);

  if (!nodeA || !nodeB) return null;

  const dx = nodeB.x - nodeA.x;
  const dy = nodeB.y - nodeA.y;
  const length = Math.sqrt(dx * dx + dy * dy);

  if (length < 1) return null;

  // Separate visual length (pixels) from physics length (meters)
  const logicalLength = edge.len || length;

  return {
    A: nodeA,
    B: nodeB,
    length, // Used for Canvas Rendering
    logicalLength, // Used for Simulation Physics & Queue Capacity
    ux: dx / length, // Unit vector X
    uy: dy / length, // Unit vector Y
    px: -dy / length, // Perpendicular vector X
    py: dx / length, // Perpendicular vector Y
  };
}

// ─── TURN CLASSIFICATION ──────────────────────────────────────────────────────
/**
 * Classifies the type of turn between two edges at a node
 * @param {Object} edgeIn - Incoming edge
 * @param {Object} edgeOut - Outgoing edge
 * @param {Object} node - Intersection node
 * @returns {string} "U-Turn", "Right Turn", "Left Turn", or "Straight"
 */
function calculateTurnType(edgeIn, edgeOut, node) {
  const prevNode = getNode(edgeIn.to === node.id ? edgeIn.from : edgeIn.to);
  const nextNode = getNode(
    edgeOut.from === node.id ? edgeOut.to : edgeOut.from,
  );

  if (!prevNode || !nextNode) return "Unknown";

  const angle1 = Math.atan2(node.y - prevNode.y, node.x - prevNode.x);
  const angle2 = Math.atan2(nextNode.y - node.y, nextNode.x - node.x);

  let angleDiff = angle2 - angle1;
  angleDiff = normalizeAngle(angleDiff);

  const degrees = angleDiff * (180 / Math.PI);

  // Classify turn by angle difference
  if (degrees > 135 || degrees < -135) return "U-Turn";
  if (degrees > 25) return "Right Turn";
  if (degrees < -25) return "Left Turn";
  return "Straight";
}
