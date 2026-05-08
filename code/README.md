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

## Algorithmic Deep Dive: Adaptive Proportional Scheduling

Unlike traditional actuated signals that reactively extend green times based on immediate gap-outs (e.g., induction loops), TrafficGraph employs a **Predictive Proportional Allocation Algorithm**. Intersections act as independent decentralized agents, calculating predetermined phase schedules using a four-step computational pipeline at the boundary of every signal cycle.

### Step 1: Demand Observation & Smoothing (EMA)

At the conclusion of a green phase, the controller samples the physical queue length ($Q$)—the exact number of vehicles completely stopped at the approach line. To prevent the system from overreacting to anomalous traffic platoons, this live data is passed through an **Exponential Moving Average (EMA)** filter.

$$V_{learned} = (V_{historical} \times \alpha) + (Q_{current} \times \beta)$$

- $\alpha$ (History Weight) = `0.8`
- $\beta$ (Current Weight) = `0.2`
- _Result:_ The algorithm maintains a smoothed, persistent memory of demand ($V_{learned}$) for every incoming road, ensuring stable schedule transitions.

### Step 2: Kinematic Priority Weighting

Traffic networks contain roads of varying classifications. Stopping a 100 km/h arterial flow causes significantly more network latency and collision risk than stopping a 30 km/h residential street. The algorithm inherently understands this by applying a **Speed Weighting Multiplier** ($W_{speed}$) relative to a 50 km/h baseline.

$$V_{weighted} = V_{learned} \times \left( \frac{\text{Speed Limit}}{50} \right)$$

- _Result:_ An approach with a 100 km/h speed limit will exert mathematically double the "pressure" on the intersection controller compared to a 50 km/h road with the exact same volume of waiting cars.

### Step 3: Proportional Cycle Slicing

Once the weighted demand ($V_{weighted}$) is calculated for all active approaches, the controller calculates the total active pressure ($P_{total} = \sum V_{weighted}$). It then deducts the mandatory safety clearance intervals from the total User-Defined Cycle Length (e.g., 120s) to find the total allocatable green time ($T_{allocatable}$).

The green time allocated to a specific phase ($T_{green}$) is calculated strictly proportionally:

$$T_{green} = \max \left( MIN\_GREEN, \left( \frac{V_{weighted}}{P_{total}} \right) \times T_{allocatable} \right)$$

- _Result:_ The algorithm guarantees that the intersection cycle exactly matches the user's defined cycle length, preventing clock-drift between adjacent intersections, while dynamically stretching the green slices to favor heavy, high-speed traffic.

### Step 4: State Machine Execution

With the duration calculated, the controller hands the schedule over to a strict kinematic state machine. The transition sequence enforces safety intervals to prevent simulated side-impact collisions:

1.  **Green Phase:** Executes for the dynamically calculated $T_{green}$ duration.
2.  **Yellow Phase:** Static duration (`4.0s`). Approaching vehicles calculate their stopping distance; if they cannot safely stop, they clear the intersection.
3.  **All-Red Clearance:** Static duration (`1.5s`). All approaches are held at red to guarantee the physical intersection box is completely evacuated before the next phase index is triggered.

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
