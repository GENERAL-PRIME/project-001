# TrafficGraph: Interactive AI Traffic Simulator (v6.0 - latest working)

## Overview & Executive Summary

**TrafficGraph** is a high-fidelity, browser-based traffic simulation and signal-control environment built entirely in Vanilla JavaScript and HTML5 Canvas. Designed with zero external dependencies, the system provides a robust sandbox for testing adaptive traffic control algorithms and modeling microscopic vehicle kinematics.

Unlike traditional static-timer simulations, TrafficGraph features decentralized, intersection-level AI agents that utilize predictive scheduling and historical demand-learning to dynamically optimize traffic flow, reduce bottlenecks, and minimize network-wide latency.

---

## System Architecture & Design Philosophy

The application is architected around a strict separation of concerns, decoupling the visual rendering engine from the underlying physics and decision-making logic.

- **`state.js`**: The central, globally accessible data store. It manages the topology (`nodes`, `edges`), entity tracking (`cars`), global configuration constants (`SIM_CONFIG`), and local storage persistence.
- **`simulation.js`**: The core computational engine. It executes the AI predictive scheduling, the microscopic car-following models, collision avoidance, and aggregate metric sampling within a fixed-step physics loop.
- **`math.js`**: A dedicated geometry module responsible for coordinate translations, vector mathematics, and the critical translation between visual canvas pixels and logical meters.
- **`render.js` & `main.js`**: The presentation and I/O layers. They handle user interaction, dynamic topology construction, DOM updates, and `requestAnimationFrame` looping.

---

## Predictive Adaptive Control (The AI Engine)

At the heart of the simulation is the signal control logic. Instead of relying on reactive, queue-clearing triggers, intersections act as independent agents utilizing an **Exponential Moving Average (EMA)** to predict future traffic demand based on historical patterns.

1. **Demand Learning:** At the conclusion of a green phase, the intersection evaluates the queue length of the _next_ scheduled approach. This live data is blended with the algorithm's historical memory (`80% Past / 20% Present`), establishing an updated `historicalVolume` profile that smooths out bursty, anomalous traffic spikes.
2. **Speed-Weighted Allocation:** To prevent dangerous, high-speed braking cascades, the AI applies a priority multiplier based on the approach road's speed limit. A 100 km/h corridor is mathematically weighted to exert twice the demand pressure of a 50 km/h street, ensuring high-speed arterials receive proportionally larger green-time allocations.
3. **Dynamic Slicing:** The aggregate weighted demand is used to proportionally divide the intersection's total configured Cycle Length, allocating a predetermined green duration for every incoming road while strictly maintaining minimum green-time constraints.

---

## Kinematic Modeling & Vehicle Dynamics

TrafficGraph v6 introduces a rigorous microscopic physics engine, moving away from simple percentage-based traversal to an absolute-distance kinematic model.

- **Decoupled Geometry (Visual vs. Logical Length):** The simulation separates the visual length of a road on the canvas from its logical, physical length. Users can draw a 50-pixel segment but configure it as a 5,000-meter highway. The physics engine utilizes this logical length to calculate exact travel times, braking distances, and spatial capacities.
- **Car-Following Model:** Vehicles possess spatial awareness. The simulation implements an Intelligent Driver Model (IDM) framework where cars continuously monitor the vehicle directly ahead. If the gap closes below the `SAFE_GAP` threshold, the trailing vehicle interpolates its speed to match the leader, realistically simulating queue spillback and dense traffic compression.
- **Absolute-Distance Braking:** Braking logic triggers at precise, logical distances from an intersection stop-line rather than arbitrary road percentages. Vehicles execute a smooth deceleration curve, coming to a complete stop exactly at the geometric stop-line.

---

## Core Capabilities & Safety Mechanisms

To accurately mirror real-world traffic engineering standards, the environment enforces several critical constraints:

- **Strict Signal Phasing:** Transitions are non-binary. The AI controller manages a strict state machine (`GREEN` → `YELLOW` → `ALL_RED`). The mandatory All-Red clearance interval ensures the intersection box is physically evacuated before conflicting approaches receive a green signal.
- **Unsignalized Yielding:** Intersections configured as `uncontrolled` utilize an occupancy-detection heuristic. Approaching vehicles dynamically scan the geometric bounds of the intersection; if cross-traffic is detected, they yield and reduce speed until the conflict zone is clear.
- **Watchdog Failsafes:** Each AI controller runs a background watchdog timer. If an intersection experiences a logical deadlock or remains in a single phase beyond the `WATCHDOG_TIMEOUT`, the AI gracefully degrades to a safe, fixed-time fallback schedule.
- **Live Network Analytics:** A background metrics engine continuously samples the network, providing a real-time HUD displaying the global Simulation Clock, total Network Throughput, and Rolling Average Wait Time.

---

## Deployment & Interaction

### Execution

The environment requires no build steps or local servers.

1. Clone the repository.
2. Open `index.html` in any modern web browser.
3. Click **SAMPLE MAP** to initialize a demonstration environment, or use the interactive toolbar to construct a custom topology.

### Managing AI Memory (Export/Import)

Because the intersection controllers store their learned demand patterns natively within the map data, saved files represent a snapshot of the AI's "brain."

- **Preserving Memory:** Clicking **EXPORT** saves the current topology alongside the AI's `historicalVolume`. Importing this file allows the simulation to resume with its learned optimizations fully intact.
- **Memory Scrubbing (Clean Slate):** To run a new simulation on an existing topology without the bias of previous traffic patterns, the AI memory must be scrubbed.
  1. Export the map to `traffic_map_backup.json`.
  2. Run the provided Node.js script: `node clean_map.js`
  3. Import the resulting `traffic_map_clean.json`. The physical map will load, but all AI agents will be reset to their baseline learning state.
