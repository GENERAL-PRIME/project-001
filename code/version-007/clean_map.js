const fs = require("fs");

// The names of your input and output files
const INPUT_FILE = "traffic_map_backup.json";
const OUTPUT_FILE = "traffic_map_clean.json";

try {
  // 1. Read the original JSON file
  console.log(`Reading map data from ${INPUT_FILE}...`);
  const rawData = fs.readFileSync(INPUT_FILE, "utf8");
  const mapData = JSON.parse(rawData);

  // 2. Iterate through all nodes and wipe the simulation memory
  let cleanedNodes = 0;
  if (mapData.nodes && Array.isArray(mapData.nodes)) {
    mapData.nodes.forEach((node) => {
      // Delete the AI brain and live stats
      delete node.ai;
      delete node.edgeStats;
      delete node.activeGreenEdge;

      // Delete legacy static timers if they exist
      delete node.phases;
      delete node.phaseTimer;

      cleanedNodes++;
    });
  }

  // 3. Write the pristine data to a new file
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(mapData, null, 2));

  console.log(
    `✅ Success! Wiped AI memory from ${cleanedNodes} intersections.`,
  );
  console.log(`✅ Clean map saved to: ${OUTPUT_FILE}`);
} catch (error) {
  console.error("❌ Error cleaning the map:", error.message);
}
