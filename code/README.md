# TrafficGraph: Interactive AI Traffic Simulator (Version-005)

TrafficGraph is a lightweight, browser-based traffic simulation engine built entirely in Vanilla JavaScript and HTML5 Canvas.

It allows users to dynamically build road networks, configure intersections, and watch as a built-in **Predictive AI** automatically sculpts traffic light schedules in real-time to minimize wait times and dissolve bottlenecks.

## ✨ Key Features

- **Interactive Canvas Builder:** Pan, zoom, and build complex road networks with a click-and-drag interface.
- **Predictive AI Traffic Controller:** Traffic lights do not use static timers. Intersections act as independent agents that learn historical traffic volume (using an Exponential Moving Average) and dynamically slice their cycle length to build highly optimized, predetermined schedules.
- **Speed-Weighted Routing:** The AI respects road speed limits (km/h), naturally prioritizing high-speed corridors to prevent dangerous braking cascades.
- **Dynamic Geometry Engine:** Automatically calculates Left, Right, Straight, and U-Turns using vector math, allowing users to legally ban specific turns at any intersection.
- **Data Persistence:** The map state and the AI's "Learned Memory" are automatically saved to your browser's local storage and can be exported/imported as JSON files.

---

## 📂 Project Architecture

The application was refactored from a monolithic script into a clean, modular architecture. There are no build tools required (no Webpack or Node.js).

- **`index.html`**: The main entry point containing the UI toolbar, the canvas wrapper, and the configuration modals.
- **`style.css`**: Contains all styling, CSS variables, and layout rules for the inspector panels and HUDs.
- **`state.js`**: The central data store. Manages the global `State` object (nodes, edges, cars, camera) and handles `localStorage` saving, JSON exporting, and data sanitization.
- **`math.js`**: The geometry engine. Handles world-to-screen coordinate translations and calculates turning angles.
- **`render.js`**: The visual engine. Loops through the `State` arrays to draw the grid, roads, lane markings, cars, and live UI overlays (like the HUD countdown timers).
- **`simulation.js`**: The physics and AI brain. Handles car spawning, movement physics, red-light braking, and the Predictive Scheduling AI that calculates green times.
- **`main.js`**: The bridge. Handles all user input (mouse clicks, scrolling, zooming), manages the properties modals (Inspector, Edit Road, Edit Node), and runs the `requestAnimationFrame` game loop.

---

## 🎮 How to Use

Open `index.html` in any modern web browser to start.

### The Toolbar

- **PAN:** Click and drag the background to move around. Scroll to zoom in and out.
- **SELECT:** Click an intersection (Node) or a road (Edge) to open the Properties Inspector.
- **+ NODE:** Click anywhere on the grid to place a new intersection.
- **+ ROAD:** Click a starting Node, then click a destination Node to draw a road. You will be prompted to define the incoming/outgoing lanes and the speed limit.
- **DELETE:** Click a Node or Road to instantly remove it from the map.

### Simulation Controls

- **▶ SIMULATE / ■ STOP:** Toggles the physics engine. Stopping the simulation automatically saves the AI's learned memory.
- **DENSITY:** Controls the maximum number of cars allowed on the map simultaneously.
- **SPEED:** A Time-Warp multiplier. `0.5x` runs the physics in slow motion, `2.0x` runs the physics and AI learning twice as fast.

---

## 🧠 How the AI Works

This simulator uses a **Predictive Scheduling Algorithm** inspired by professional traffic engineering.

1. **Learning:** When a traffic light switches, the intersection counts the cars left waiting. It blends this with its historical knowledge using an Exponential Moving Average (`80% Past + 20% Present`).
2. **Speed Weighting:** The AI looks at the speed limit of the incoming roads. A 100 km/h road gets its traffic volume artificially multiplied by `2.0` compared to a 50 km/h road, prioritizing high-speed flow.
3. **Scheduling:** The intersection takes its total Cycle Length (e.g., 120s) and distributes it proportionally based on the weighted historical volume.
4. **Execution:** Cars are given a predetermined wait time. If a queue grows faster than the AI expected, the AI will learn from this "mistake" and allocate a longer green light in the next cycle.

## 🚀 Installation & Setup

Because this project is built in Vanilla JS, there are no dependencies to install.

1. Clone or download the repository.
   ```bash
    git clone https://github.com/GENERAL-PRIME/project-001.git
   ```
2. Ensure all `.js` files and the `.css` file are in the same directory as `index.html`.
3. Double-click `index.html` to open it in your browser.
4. Click **SAMPLE MAP** in the top right to load a pre-built testing environment.

## 🧹 Managing AI Memory (Save States)

Because the AI stores its learned traffic patterns directly inside the map's data, your exported `.json` files act as a snapshot of the AI's "brain."

**IF you want to keep the AI's learned patterns:**

- Simply click **EXPORT** in the UI.
- When you **IMPORT** this file later, the AI will remember all its historical traffic data and continue predicting schedules exactly where it left off.

**ELSE IF you want a completely clean slate (Keep the roads, wipe the brain):**

- If you want to test a new traffic scenario on the exact same physical map, you must scrub the AI's memory. Otherwise, it will carry over its old assumptions into your new test.
- You can instantly wipe the memory using the included Node.js cleaner script:
  1. Ensure you have [Node.js](https://nodejs.org/) installed on your machine.
  2. Click **EXPORT** in the UI and save your map as `traffic_map_backup.json` in your project folder.
  3. Open your terminal in that folder and run the cleaning script:
     ```bash
     node clean_map.js
     ```
  4. The script will safely strip out all `historicalVolume`, timers, and phase schedules, generating a new file called `traffic_map_clean.json`.
  5. Click **IMPORT** in the UI and upload `traffic_map_clean.json`. Your roads and properties will load perfectly, but the AI will begin learning from scratch!
