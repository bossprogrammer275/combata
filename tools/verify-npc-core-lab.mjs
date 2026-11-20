import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "artifacts", "npc-core-lab");
const PORT = 4177;
const BASE = `http://127.0.0.1:${PORT}/`;
const server = spawn(process.execPath, ["server.js"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "ignore", "pipe"],
});

let browser = null;
let page = null;
let serverError = "";
const failures = [];
const clipResults = [];

server.stderr?.on("data", (chunk) => { serverError += chunk.toString(); });

async function waitForServer() {
  for (let i = 0; i < 180; i++) {
    try {
      const response = await fetch(BASE + "npc-lab.html");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("NPC Core Lab server did not become ready. " + serverError);
}

function check(name, passed, detail = "") {
  if (passed) console.log("PASS " + name + (detail ? " · " + detail : ""));
  else {
    failures.push({ name, detail });
    console.error("FAIL " + name + (detail ? " · " + detail : ""));
  }
}

try {
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });
  await waitForServer();

  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--enable-webgl", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader", "--disable-dev-shm-usage"],
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on("pageerror", (error) => failures.push({ name: "pageerror", detail: error.message }));
  page.on("requestfailed", (request) => failures.push({
    name: "request failed",
    detail: request.url() + " " + (request.failure()?.errorText || "")
  }));

  const response = await page.goto(BASE + "npc-lab.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  check("NPC Core Lab page loaded", !!response && response.ok(), String(response?.status()));

  await page.waitForFunction(() => {
    const status = document.getElementById("rigStatus")?.textContent?.trim();
    return status === "Verified skinned rig" || status === "Verification failed";
  }, null, { timeout: 180000 });

  const rigStatus = (await page.locator("#rigStatus").textContent())?.trim() || "";
  const rigNote = (await page.locator("#rigNote").textContent())?.trim() || "";
  const rig = await page.evaluate(() => ({
    status: document.getElementById("rigStatus")?.textContent?.trim() || "",
    skinnedMeshes: document.getElementById("skinCount")?.textContent?.trim() || "",
    uniqueBones: document.getElementById("boneCount")?.textContent?.trim() || "",
    requiredBodyBones: document.getElementById("requiredBones")?.textContent?.trim() || "",
    sourceHeight: document.getElementById("modelHeight")?.textContent?.trim() || "",
    materials: document.getElementById("materialCount")?.textContent?.trim() || "",
    textures: document.getElementById("textureCount")?.textContent?.trim() || "",
    baseTakes: document.getElementById("baseTakes")?.textContent?.trim() || "",
    note: document.getElementById("rigNote")?.textContent?.trim() || ""
  }));

  check("base Idle.fbx candidate passes humanoid rig gate", rigStatus === "Verified skinned rig", rigNote);
  if (rigStatus !== "Verified skinned rig") throw new Error("Base rig validation failed: " + rigNote);

  await page.waitForFunction(() => document.getElementById("selectedKey")?.textContent?.trim() === "idle");
  await page.screenshot({ path: path.join(OUT, "npc-core-idle.png"), fullPage: true });

  const keys = await page.locator("#clipSelect option").evaluateAll((options) =>
    options.map((option) => option.value).filter(Boolean)
  );
  check("manifest animation keys discovered", keys.length === 29, String(keys.length));
  const initialTracks = (await page.locator("#selectedTracks").textContent())?.trim() || "0";
  const initialMatches = (await page.locator("#selectedMatches").textContent())?.trim() || "0 / 0";
  const initialState = (await page.locator("#stateText").textContent())?.trim() || "";
  const initialMatch = initialMatches.match(/(\d+)\s*\/\s*(\d+)/);
  const idlePass = !!initialMatch && Number(initialMatch[1]) === Number(initialMatch[2]) && Number(initialMatch[2]) > 0
    && initialState.includes("all tracks resolved");
  clipResults.push({ key: "idle", tracks: initialTracks, matched: initialMatches, state: initialState, passed: idlePass });
  check("idle animation binds to the base rig", idlePass, initialMatches);

  for (const key of keys.filter((item) => item !== "idle")) {
    await page.locator('.clip[data-key="' + key + '"]').click();
    await page.waitForFunction((expected) => {
      const selected = document.getElementById("selectedKey")?.textContent?.trim();
      const state = document.getElementById("stateText")?.textContent?.trim() || "";
      return selected === expected || state.startsWith("Animation preview failed: " + expected);
    }, key, { timeout: 60000 });

    const selected = (await page.locator("#selectedKey").textContent())?.trim() || "";
    const trackCount = (await page.locator("#selectedTracks").textContent())?.trim() || "0";
    const matchText = (await page.locator("#selectedMatches").textContent())?.trim() || "0 / 0";
    const state = (await page.locator("#stateText").textContent())?.trim() || "";
    const parsed = matchText.match(/(\d+)\s*\/\s*(\d+)/);
    const passed = selected === key && !!parsed
      && Number(parsed[1]) === Number(parsed[2])
      && Number(parsed[2]) > 0
      && state.includes("all tracks resolved");
    clipResults.push({ key, tracks: trackCount, matched: matchText, state, passed });
    check("animation track binding: " + key, passed, matchText + " · " + state);
    if (!passed) {
      await page.screenshot({ path: path.join(OUT, "failure-" + key + ".png"), fullPage: true });
    }
  }

  const report = {
    modelId: "npc_core_001",
    rig,
    clipCount: keys.length,
    clips: clipResults,
    failures,
    passed: rigStatus === "Verified skinned rig" && clipResults.length === 29
      && clipResults.every((item) => item.passed) && failures.length === 0
  };
  await fs.writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log("NPC_CORE_LAB_REPORT " + JSON.stringify({
    passed: report.passed,
    rig: report.rig,
    clipsChecked: report.clips.length,
    clipsPassed: report.clips.filter((item) => item.passed).length,
    failures: failures.length
  }));
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  console.error("NPC Core Lab verification failed:", error);
  await fs.writeFile(path.join(OUT, "fatal-error.txt"), String(error?.stack || error) + "\n").catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  server.kill("SIGTERM");
}
