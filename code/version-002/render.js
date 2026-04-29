// render.js

function resizeCanvas() {
  const rect = wp.getBoundingClientRect();
  cv.width = rect.width;
  cv.height = rect.height;
}

function drawGrid() {
  const s = 50,
    [wx0, wy0] = screenToWorld(0, 0),
    [wx1, wy1] = screenToWorld(cv.width, cv.height);
  ctx.strokeStyle = CONFIG.COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.floor(wx0 / s) * s; x < wx1; x += s) {
    const [sx1, sy1] = worldToScreen(x, wy0),
      [sx2, sy2] = worldToScreen(x, wy1);
    ctx.moveTo(sx1, sy1);
    ctx.lineTo(sx2, sy2);
  }
  for (let y = Math.floor(wy0 / s) * s; y < wy1; y += s) {
    const [sx1, sy1] = worldToScreen(wx0, y),
      [sx2, sy2] = worldToScreen(wx1, y);
    ctx.moveTo(sx1, sy1);
    ctx.lineTo(sx2, sy2);
  }
  ctx.stroke();
}

function drawArrow(wx, wy, ux, uy, color) {
  const size = 5.5 * State.camera.zoom,
    [sx, sy] = worldToScreen(wx, wy),
    px = -uy,
    py = ux;
  ctx.beginPath();
  ctx.moveTo(sx + ux * size, sy + uy * size);
  ctx.lineTo(
    sx - ux * size * 0.7 + px * size * 0.55,
    sy - uy * size * 0.7 + py * size * 0.55,
  );
  ctx.lineTo(sx - ux * size * 0.2, sy - uy * size * 0.2);
  ctx.lineTo(
    sx - ux * size * 0.7 - px * size * 0.55,
    sy - uy * size * 0.7 - py * size * 0.55,
  );
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawRoads() {
  State.edges.forEach((edge) => {
    const geom = getEdgeGeometry(edge);
    if (!geom) return;

    const isSelected =
      State.interaction.selected?.type === "edge" &&
      State.interaction.selected.id === edge.id;
    const rW = edge.out * CONFIG.LANE_WIDTH,
      lW = edge.inl * CONFIG.LANE_WIDTH;

    const corners = [
      [geom.A.x + rW * geom.px, geom.A.y + rW * geom.py],
      [geom.B.x + rW * geom.px, geom.B.y + rW * geom.py],
      [geom.B.x - lW * geom.px, geom.B.y - lW * geom.py],
      [geom.A.x - lW * geom.px, geom.A.y - lW * geom.py],
    ];

    ctx.beginPath();
    const [startX, startY] = worldToScreen(corners[0][0], corners[0][1]);
    ctx.moveTo(startX, startY);
    for (let i = 1; i < 4; i++) {
      const [x, y] = worldToScreen(corners[i][0], corners[i][1]);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = isSelected ? "#1a2c18" : CONFIG.COLORS.road;
    ctx.fill();
    if (isSelected) {
      ctx.strokeStyle = CONFIG.COLORS.select;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const drawLine = (off, col, dash) => {
      const [sx, sy] = worldToScreen(
        geom.A.x + off * geom.px,
        geom.A.y + off * geom.py,
      );
      const [ex, ey] = worldToScreen(
        geom.B.x + off * geom.px,
        geom.B.y + off * geom.py,
      );
      ctx.beginPath();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      if (dash) ctx.setLineDash(dash);
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    drawLine(0, CONFIG.COLORS.divider, [6, 5]);
    for (let i = 1; i < edge.out; i++)
      drawLine(i * CONFIG.LANE_WIDTH, CONFIG.COLORS.laneLine, [4, 6]);
    for (let i = 1; i < edge.inl; i++)
      drawLine(-i * CONFIG.LANE_WIDTH, CONFIG.COLORS.laneLine, [4, 6]);
    drawLine(rW, CONFIG.COLORS.roadEdge, null);
    drawLine(-lW, CONFIG.COLORS.roadEdge, null);

    if (State.camera.zoom > 0.28) {
      const segments = Math.max(1, Math.floor(geom.length / CONFIG.ARROW_GAP));
      for (let s = 0; s < segments; s++) {
        const t = (s + 0.5) / segments;
        for (let i = 0; i < edge.out; i++)
          drawArrow(
            geom.A.x +
              t * geom.length * geom.ux +
              (i + 0.5) * CONFIG.LANE_WIDTH * geom.px,
            geom.A.y +
              t * geom.length * geom.uy +
              (i + 0.5) * CONFIG.LANE_WIDTH * geom.py,
            geom.ux,
            geom.uy,
            CONFIG.COLORS.outArrow,
          );
        for (let i = 0; i < edge.inl; i++)
          drawArrow(
            geom.B.x +
              t * geom.length * -geom.ux +
              (i + 0.5) * CONFIG.LANE_WIDTH * -geom.px,
            geom.B.y +
              t * geom.length * -geom.uy +
              (i + 0.5) * CONFIG.LANE_WIDTH * -geom.py,
            -geom.ux,
            -geom.uy,
            CONFIG.COLORS.inArrow,
          );
      }
    }
  });
}

function drawTrafficLights() {
  State.nodes.forEach((node) => {
    if (node.ctrl !== "signalized" || !node.lights || node.lights.length === 0)
      return;

    node.lights.forEach((edgeId) => {
      const edge = getEdge(edgeId);
      if (!edge) return;
      const geom = getEdgeGeometry(edge);
      if (!geom) return;

      const isGreen = node.activeGreenEdge === edge.id;
      const color = isGreen ? "#30d870" : "#ff3333";

      let wx, wy, ux, uy, totalWidth;
      const stopLineOffset = CONFIG.NODE_RADIUS * 1.4;

      if (edge.to === node.id) {
        totalWidth = edge.out * CONFIG.LANE_WIDTH;
        const laneCenterOffset = totalWidth / 2;
        wx = geom.B.x - geom.ux * stopLineOffset + laneCenterOffset * geom.px;
        wy = geom.B.y - geom.uy * stopLineOffset + laneCenterOffset * geom.py;
        ux = geom.ux;
        uy = geom.uy;
      } else {
        totalWidth = edge.inl * CONFIG.LANE_WIDTH;
        const laneCenterOffset = totalWidth / 2;
        wx = geom.A.x + geom.ux * stopLineOffset - laneCenterOffset * geom.px;
        wy = geom.A.y + geom.uy * stopLineOffset - laneCenterOffset * geom.py;
        ux = -geom.ux;
        uy = -geom.uy;
      }

      const [sx, sy] = worldToScreen(wx, wy);

      // 1. Draw the physical light bar
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.atan2(uy, ux));

      const barWidth = 5 * State.camera.zoom;
      const barLength = totalWidth * State.camera.zoom * 0.9;

      ctx.fillStyle = "#111";
      ctx.fillRect(-barWidth / 2, -barLength / 2, barWidth, barLength);

      ctx.fillStyle = color;
      ctx.shadowBlur = 8 * State.camera.zoom;
      ctx.shadowColor = color;
      ctx.fillRect(
        -barWidth / 2 + 1,
        -barLength / 2 + 1,
        barWidth - 2,
        barLength - 2,
      );
      ctx.restore();

      // 2. NEW: Draw the HUD Data Box (if zoomed in enough)
      if (State.camera.zoom > 0.4 && node.edgeStats && node.edgeStats[edgeId]) {
        const stats = node.edgeStats[edgeId];
        const carsInQueue = stats.cars;
        const waitTime = Math.floor(stats.maxWait);
        const goTime = Math.floor(node.ai ? node.ai.timeInPhase : 0);

        // Push the text box slightly upstream from the physical light bar
        const hudX = sx - ux * (26 * State.camera.zoom);
        const hudY = sy - uy * (26 * State.camera.zoom);

        ctx.font = `bold ${Math.round(8 * State.camera.zoom)}px monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        // Draw dark semi-transparent panel
        const boxW = 52 * State.camera.zoom;
        const boxH = 24 * State.camera.zoom;
        ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
        ctx.fillRect(hudX - boxW / 2, hudY - boxH / 2, boxW, boxH);

        // Cars Queue Label
        ctx.fillStyle = "#ffffff";
        ctx.fillText(
          `CARS: ${carsInQueue}`,
          hudX,
          hudY - 5 * State.camera.zoom,
        );

        // Wait/Go Timers Label
        if (isGreen) {
          ctx.fillStyle = "#30d870";
          ctx.fillText(`GO: ${goTime}s`, hudX, hudY + 5 * State.camera.zoom);
        } else {
          ctx.fillStyle = "#ff3333";
          ctx.fillText(
            `WAIT: ${waitTime}s`,
            hudX,
            hudY + 5 * State.camera.zoom,
          );
        }
      }
    });
  });
}

function drawIntersections() {
  State.nodes.forEach((node) => {
    const [sx, sy] = worldToScreen(node.x, node.y),
      radius = CONFIG.NODE_RADIUS * State.camera.zoom;
    const isSelected =
      State.interaction.selected?.type === "node" &&
      State.interaction.selected.id === node.id;
    const isRoutingTarget = State.interaction.routeFromNode === node.id;

    if (isSelected || isRoutingTarget) {
      ctx.beginPath();
      ctx.arc(sx, sy, radius * 1.85, 0, Math.PI * 2);
      ctx.strokeStyle = isRoutingTarget
        ? CONFIG.COLORS.select
        : CONFIG.COLORS.text;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.3;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fillStyle = CONFIG.COLORS.nodeBg;
    ctx.fill();
    ctx.strokeStyle =
      isSelected || isRoutingTarget
        ? CONFIG.COLORS.select
        : CONFIG.COLORS.nodeBorder;
    ctx.lineWidth = isSelected || isRoutingTarget ? 2 : 1.5;
    ctx.stroke();

    ctx.strokeStyle = CONFIG.COLORS.nodeBorder + "55";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx - radius * 0.5, sy);
    ctx.lineTo(sx + radius * 0.5, sy);
    ctx.moveTo(sx, sy - radius * 0.5);
    ctx.lineTo(sx, sy + radius * 0.5);
    ctx.stroke();

    if (State.camera.zoom > 0.42 && node.lbl) {
      ctx.fillStyle = CONFIG.COLORS.text;
      ctx.font = `600 ${Math.max(7, Math.round(9 * State.camera.zoom))}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(node.lbl, sx, sy);
    }
  });
}

function drawCars() {
  State.cars.forEach((car) => {
    const geom = getEdgeGeometry(getEdge(car.edgeId));
    if (!geom) return;

    const offset = (car.lane + 0.5) * CONFIG.LANE_WIDTH;
    let wx, wy, ux, uy;

    if (car.direction === "out") {
      wx = geom.A.x + car.progress * geom.length * geom.ux + offset * geom.px;
      wy = geom.A.y + car.progress * geom.length * geom.uy + offset * geom.py;
      ux = geom.ux;
      uy = geom.uy;
    } else {
      wx = geom.B.x + car.progress * geom.length * -geom.ux + offset * -geom.px;
      wy = geom.B.y + car.progress * geom.length * -geom.uy + offset * -geom.py;
      ux = -geom.ux;
      uy = -geom.uy;
    }

    const [sx, sy] = worldToScreen(wx, wy);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(Math.atan2(uy, ux));

    ctx.beginPath();
    ctx.rect(
      (-CONFIG.CAR_LENGTH * State.camera.zoom) / 2,
      (-CONFIG.CAR_WIDTH * State.camera.zoom) / 2,
      CONFIG.CAR_LENGTH * State.camera.zoom,
      CONFIG.CAR_WIDTH * State.camera.zoom,
    );
    ctx.fillStyle = car.isStopped ? "#ff3333" : car.color;
    ctx.fill();
    ctx.beginPath();
    ctx.rect(
      ((CONFIG.CAR_LENGTH * State.camera.zoom) / 2) * 0.1,
      -((CONFIG.CAR_WIDTH * State.camera.zoom) / 2) * 0.65,
      ((CONFIG.CAR_LENGTH * State.camera.zoom) / 2) * 0.75,
      ((CONFIG.CAR_WIDTH * State.camera.zoom) / 2) * 1.3,
    );
    ctx.fillStyle = "rgba(200,230,255,0.28)";
    ctx.fill();
    ctx.restore();
  });
}

function drawInteractionOverlays() {
  if (
    State.interaction.routeFromNode !== null &&
    State.interaction.hoverCoords
  ) {
    const fromNode = getNode(State.interaction.routeFromNode);
    if (fromNode) {
      const [sx, sy] = worldToScreen(fromNode.x, fromNode.y);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(
        State.interaction.hoverCoords[0],
        State.interaction.hoverCoords[1],
      );
      ctx.strokeStyle = CONFIG.COLORS.select + "80";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}
