// Runs a SonarQube analysis in Docker and fails when anything is open.
// Needs a running SonarQube (for example: docker run -d --name sonarqube -p 9009:9000 sonarqube:community)
// and SONAR_TOKEN (plus SONAR_HOST_URL if it is not http://localhost:9009) in the environment or .env.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

function env(name, fallback) {
  if (process.env[name]) return process.env[name];
  if (existsSync(".env")) {
    const line = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith(`${name}=`));
    if (line) return line.slice(name.length + 1).trim();
  }
  return fallback;
}

const host = env("SONAR_HOST_URL", "http://localhost:9009");
const token = env("SONAR_TOKEN");
if (!token) {
  console.error("Set SONAR_TOKEN (a SonarQube analysis token) in .env or the environment.");
  process.exit(1);
}
const dockerHost = host.replace("localhost", "host.docker.internal");

// Docker from its usual install locations by absolute path, not from whatever PATH the shell has.
const docker = ["/usr/local/bin/docker", "/opt/homebrew/bin/docker", "/usr/bin/docker"].find((p) => existsSync(p));
if (!docker) {
  console.error("Docker was not found in /usr/local/bin, /opt/homebrew/bin or /usr/bin.");
  process.exit(1);
}
const startedAt = Date.now();
execFileSync(
  docker,
  ["run", "--rm", "-e", `SONAR_HOST_URL=${dockerHost}`, "-e", `SONAR_TOKEN=${token}`, "-v", `${process.cwd()}:/usr/src`, "sonarsource/sonar-scanner-cli"],
  { stdio: ["ignore", "ignore", "inherit"] },
);

const auth = { Authorization: `Bearer ${token}` };
const get = async (path) => (await fetch(`${host}${path}`, { headers: auth })).json();

// Wait until the server has processed the report submitted above (not an older one).
for (let i = 0; i < 90; i++) {
  const { tasks = [] } = await get("/api/ce/activity?component=coderimpact&ps=1");
  const latest = tasks[0];
  if (latest && Date.parse(latest.submittedAt) >= startedAt - 1000 && latest.status !== "PENDING" && latest.status !== "IN_PROGRESS") break;
  await new Promise((r) => setTimeout(r, 2000));
}

const issues = await get("/api/issues/search?componentKeys=coderimpact&resolved=false&ps=500");
const hotspots = await get("/api/hotspots/search?projectKey=coderimpact&status=TO_REVIEW&ps=500");
for (const i of issues.issues ?? []) console.log(`${i.component.split(":")[1]}:${i.line ?? "-"}  ${i.rule}  ${i.message}`);
for (const h of hotspots.hotspots ?? []) console.log(`${h.component.split(":")[1]}:${h.line ?? "-"}  hotspot  ${h.message}`);
const total = (issues.total ?? 0) + (hotspots.paging?.total ?? 0);
console.log(`SonarQube: ${issues.total ?? 0} issues, ${hotspots.paging?.total ?? 0} hotspots to review`);
process.exit(total === 0 ? 0 : 1);
