import fs from "fs";
try {
  fs.appendFileSync("/tmp/server_start.log", `${new Date().toISOString()} - No-import server started\n`);
} catch (e) {}
console.log("No-import server started");
