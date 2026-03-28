import fs from "fs";
try {
  fs.appendFileSync("/tmp/test_start.log", `${new Date().toISOString()} - Test process started\n`);
  console.log("Test process started");
} catch (e) {
  console.error(e);
}
