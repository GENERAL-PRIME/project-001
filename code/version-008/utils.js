// utils.js — Shared utility functions, validation, and helpers

/**
 * Validates that a value is a valid number
 * @param {*} value - Value to validate
 * @param {number} min - Minimum allowed value (optional)
 * @param {number} max - Maximum allowed value (optional)
 * @returns {boolean}
 */
function isValidNumber(value, min = -Infinity, max = Infinity) {
  return (
    typeof value === "number" && !isNaN(value) && value >= min && value <= max
  );
}

/**
 * Validates that a value is a valid non-negative integer
 * @param {*} value
 * @param {number} max - Maximum allowed value (optional)
 * @returns {boolean}
 */
function isValidId(value, max = Infinity) {
  return Number.isInteger(value) && value > 0 && value <= max;
}

/**
 * Validates that coordinates are valid world coordinates
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function areValidCoordinates(x, y) {
  return isValidNumber(x) && isValidNumber(y);
}

/**
 * Clamps a value between min and max
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculates Euclidean distance between two points
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {number}
 */
function distance(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculates squared distance (faster, no sqrt)
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {number}
 */
function distanceSquared(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

/**
 * Finds the closest point on a line segment to a given point
 * @param {number} px - Point X
 * @param {number} py - Point Y
 * @param {number} x1 - Line start X
 * @param {number} y1 - Line start Y
 * @param {number} x2 - Line end X
 * @param {number} y2 - Line end Y
 * @returns {Object} { x, y, distance, t (0-1 paramter) }
 */
function closestPointOnSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0)
    return { x: x1, y: y1, distance: distance(px, py, x1, y1), t: 0 };

  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = clamp(t, 0, 1);

  const x = x1 + t * dx;
  const y = y1 + t * dy;
  const dist = distance(px, py, x, y);

  return { x, y, distance: dist, t };
}

/**
 * Normalizes an angle to the (-π, π] range using a closed-form expression.
 * Safe for NaN and ±Infinity (returns 0 for non-finite inputs, avoiding the
 * infinite loop that the previous while-loop implementation could produce).
 * @param {number} angle - Angle in radians
 * @returns {number}
 */
function normalizeAngle(angle) {
  if (!isFinite(angle)) return 0;
  // Closed-form: shift into [0, 2π), then map to (-π, π]
  return angle - 2 * Math.PI * Math.floor((angle + Math.PI) / (2 * Math.PI));
}

/**
 * Calculates angle between two points
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {number} Angle in radians
 */
function angleToPoint(x1, y1, x2, y2) {
  return Math.atan2(y2 - y1, x2 - x1);
}

/**
 * Converts JSON string to object with error handling
 * @param {string} jsonStr
 * @returns {Object|null}
 */
function safeJsonParse(jsonStr) {
  try {
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("JSON parse error:", error);
    return null;
  }
}

/**
 * Safely retrieves value from localStorage
 * @param {string} key
 * @param {*} defaultValue
 * @returns {*}
 */
function getFromStorage(key, defaultValue = null) {
  try {
    const item = localStorage.getItem(key);
    return item ? safeJsonParse(item) : defaultValue;
  } catch (error) {
    console.error("Storage access error:", error);
    return defaultValue;
  }
}

/**
 * Safely saves value to localStorage
 * @param {string} key
 * @param {*} value
 * @returns {boolean} Success
 */
function saveToStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error("Storage write error:", error);
    return false;
  }
}

/**
 * Deep clones an object
 * @param {Object} obj
 * @returns {Object}
 */
function deepClone(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (error) {
    console.error("Clone error:", error);
    return null;
  }
}

/**
 * Triggers a file download
 * @param {string} filename
 * @param {string} content
 * @param {string} mimeType
 */
function downloadFile(filename, content, mimeType = "text/plain") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Formats seconds to readable time string
 * @param {number} seconds
 * @returns {string} "1m 23s" format
 */
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

/**
 * Debounce function execution
 * @param {Function} func
 * @param {number} delay
 * @returns {Function}
 */
function debounce(func, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), delay);
  };
}

/**
 * Gets all edges connected to a node (incoming + outgoing)
 * @param {number} nodeId
 * @returns {Array}
 */
function getConnectedEdges(nodeId) {
  return State.edges.filter((e) => e.from === nodeId || e.to === nodeId);
}

/**
 * Gets all incoming edges to a node
 * @param {number} nodeId
 * @returns {Array}
 */
function getIncomingEdges(nodeId) {
  return State.edges.filter((e) => e.to === nodeId);
}

/**
 * Gets all outgoing edges from a node
 * @param {number} nodeId
 * @returns {Array}
 */
function getOutgoingEdges(nodeId) {
  return State.edges.filter((e) => e.from === nodeId);
}

/**
 * Validates an edge object
 * @param {Object} edge
 * @returns {boolean}
 */
function isValidEdge(edge) {
  return (
    edge &&
    isValidId(edge.id) &&
    isValidId(edge.from) &&
    isValidId(edge.to) &&
    isValidNumber(edge.out, 0, 6) &&
    isValidNumber(edge.inl, 0, 6) &&
    isValidNumber(edge.spd, 10, 120)
  );
}

/**
 * Validates a node object
 * @param {Object} node
 * @returns {boolean}
 */
function isValidNode(node) {
  return (
    node &&
    isValidId(node.id) &&
    areValidCoordinates(node.x, node.y) &&
    typeof node.lbl === "string" &&
    ["signalized", "uncontrolled"].includes(node.ctrl) &&
    isValidNumber(node.cycle, 10, 240)
  );
}

/**
 * Validates a car object
 * @param {Object} car
 * @returns {boolean}
 */
function isValidCar(car) {
  return (
    car &&
    isValidId(car.id) &&
    isValidId(car.edgeId) &&
    ["in", "out"].includes(car.direction) &&
    isValidNumber(car.progress, 0, 1) &&
    isValidNumber(car.speed, 0) &&
    isValidNumber(car.waitTime, 0)
  );
}
