// Unattended 12-second player animation capture.
// Starts the real game through its existing ?autostart route, sends no input,
// records every Chromium compositor frame, and samples player/animation state
// on every requestAnimationFrame for the full 12-second window.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "artifacts", "player-idle-capture");
const FRAMES = path.join(OUT, "frames");
const PORT = 4176;
const BASE = `http://127.0.0.1:${PORT}/`;
const DURATION_MS = 12000;

const server = spawn(process.execPath, ["server.js"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "ignore", "pipe"],
});

let browser = null;
let context = null;
let page = null;
let cdp = null;
let failures = 0;
let frameCount = 0;
const frameWrites = [];
const errors = [];
let screencastError = null;

function check(name, ok, detail = "") {
  if (ok) console.log(`PASS ${name}${detail ? " · " + detail : ""}`);
  else {
    failures++;
    console.error(`FAIL ${name}${detail ? " · " + detail : ""}`);
  }
}

async function waitForServer() {
  for (let i = 0; i < 180; i++) {
    try {
      const response = await fetch(BASE + "api/scenes");
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Game server did not become ready");
}

async function writeFrame(event) {
  const index = ++frameCount;
  const filename = index.toString().padStart(5, "0") + ".jpg";
  const file = path.join(FRAMES, filename);
  frameWrites.push(fs.writeFile(file, Buffer.from(event.data, "base64")));
  frameWrites[frameWrites.length - 1].catch(error => {
    screencastError = error?.message || String(error);
  });
}

try {
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(FRAMES, { recursive: true });
  await waitForServer();

  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--enable-webgl", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=swiftshader"],
  });
  context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() => {
    // Skip only the one-time branding screen. The real game still boots,
    // loads the city, initializes physics and starts free roam as normal.
    localStorage.setItem("sc_has_launched", "1");
  });
  page = await context.newPage();
  page.on("pageerror", error => errors.push("pageerror: " + error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push("console: " + message.text());
  });
  page.on("requestfailed", request => {
    errors.push("request failed: " + request.url() + " " + request.failure()?.errorText);
  });

  const response = await page.goto(BASE + "?name=PLAYER_DIAGNOSTIC&autostart=1", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  check("real game page loaded", !!response && response.ok(), String(response?.status()));

  await page.waitForFunction(() => {
    const game = window.__game;
    return game?.state === "playing"
      && game.player?.char?._isBuilt === true
      && !!game.player?.char?._model;
  }, { timeout: 120000 });

  const startup = await page.evaluate(() => {
    const game = window.__game;
    const player = game.player;
    const character = player.char;
    return {
      gameState: game.state,
      firstPerson: player.firstPerson,
      input: { ...game.input },
      crouchKeyCount: game._crouchKeys?.size ?? 0,
      playerCrouched: player.crouched,
      playerOnGround: player.onGround,
      playerPosition: { x: player.pos.x, y: player.pos.y, z: player.pos.z },
      poseMode: character._poseMode,
      actionNames: Object.keys(character._actions || {}),
      modelReady: character._isBuilt,
    };
  });
  console.log("STARTUP " + JSON.stringify(startup));
  check("test begins in third-person free roam", startup.gameState === "playing" && !startup.firstPerson);
  check("no crouch input is held at startup", !startup.input.crouch && startup.crouchKeyCount === 0 && !startup.playerCrouched);
  check("player character has completed its real FBX build", startup.modelReady);

  cdp = await context.newCDPSession(page);
  cdp.on("Page.screencastFrame", event => {
    // Acknowledge immediately so Chromium can continue sending each frame.
    cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(error => {
      screencastError ||= error?.message || String(error);
    });
    void writeFrame(event);
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 58,
    maxWidth: 1280,
    maxHeight: 720,
    everyNthFrame: 1,
  });

  const timing = await page.evaluate(async duration => {
    const start = performance.now();
    const samples = [];
    window.__playerIdleSamples = samples;
    window.__playerIdleCaptureStart = start;

    await new Promise(resolve => {
      const sampleFrame = timestamp => {
        const game = window.__game;
        const player = game?.player;
        const character = player?.char;
        const actions = character?._actions || {};
        const weights = Object.fromEntries(Object.entries(actions).map(([name, action]) => [
          name,
          Number(action.getEffectiveWeight().toFixed(4)),
        ]));
        const sample = {
          t: Number((timestamp - start).toFixed(2)),
          gameState: game?.state || "missing",
          inputCrouch: !!game?.input?.crouch,
          crouchKeyCount: game?._crouchKeys?.size ?? 0,
          playerCrouched: !!player?.crouched,
          onGround: !!player?.onGround,
          firstPerson: !!player?.firstPerson,
          position: player ? {
            x: Number(player.pos.x.toFixed(3)),
            y: Number(player.pos.y.toFixed(3)),
            z: Number(player.pos.z.toFixed(3)),
          } : null,
          groundSpeed: player ? Number(Math.hypot(player._animationVelocityX || 0, player._animationVelocityZ || 0).toFixed(3)) : null,
          poseMode: character?._poseMode || "missing",
          modelY: character?._model ? Number(character._model.position.y.toFixed(4)) : null,
          weights,
        };
        samples.push(sample);
        if (timestamp - start >= duration) {
          window.__playerIdleCaptureEnd = timestamp;
          resolve();
        } else {
          requestAnimationFrame(sampleFrame);
        }
      };
      requestAnimationFrame(sampleFrame);
    });

    return {
      start,
      end: window.__playerIdleCaptureEnd,
      duration: window.__playerIdleCaptureEnd - start,
      sampleCount: samples.length,
    };
  }, DURATION_MS);

  await cdp.send("Page.stopScreencast");
  await Promise.all(frameWrites);

  const diagnostics = await page.evaluate(() => window.__playerIdleSamples || []);
  const modes = {};
  let transitions = 0;
  let priorMode = null;
  for (const sample of diagnostics) {
    modes[sample.poseMode] = (modes[sample.poseMode] || 0) + 1;
    if (priorMode !== null && sample.poseMode !== priorMode) transitions++;
    priorMode = sample.poseMode;
  }
  const crouchSamples = diagnostics.filter(sample =>
    sample.inputCrouch || sample.crouchKeyCount > 0 || sample.playerCrouched
      || sample.poseMode === "crouch" || sample.poseMode === "crouchWalk"
  );
  const movingSamples = diagnostics.filter(sample => (sample.groundSpeed || 0) > 0.25);
  const settledSamples = diagnostics.filter(sample => sample.t >= 700);
  const uncommandedAirSamples = settledSamples.filter(sample => !sample.onGround || sample.poseMode === "jump");
  const report = {
    status: "pending",
    durationMs: timing.duration,
    animationFrameSamples: timing.sampleCount,
    compositorScreenshots: frameCount,
    screenshotCadenceFps: Number((frameCount / (timing.duration / 1000)).toFixed(2)),
    poseCounts: modes,
    poseTransitions: transitions,
    crouchSampleCount: crouchSamples.length,
    movingSampleCount: movingSamples.length,
    settledSampleCount: settledSamples.length,
    uncommandedAirSampleCount: uncommandedAirSamples.length,
    startup,
    ending: diagnostics[diagnostics.length - 1] || null,
    browserErrors: errors,
    screencastError,
    firstSamples: diagnostics.slice(0, 12),
    lastSamples: diagnostics.slice(-12),
  };

  await fs.writeFile(path.join(OUT, "diagnostics.json"), JSON.stringify(diagnostics, null, 2));
  await fs.writeFile(path.join(OUT, "summary.json"), JSON.stringify(report, null, 2));
  await fs.writeFile(path.join(OUT, "browser-errors.txt"), errors.join("\n"));

  check("captured the complete 12-second observation window", timing.duration >= 11900, `${timing.duration.toFixed(0)} ms`);
  check("captured compositor screenshots throughout the observation", frameCount >= 5, `${frameCount} frames · ${report.screenshotCadenceFps} fps`);
  check("captured animation state during the observation", timing.sampleCount >= 5, `${timing.sampleCount} samples`);
  check("player starts grounded in the real game", startup.playerOnGround, JSON.stringify(startup));
  check("no crouch input appeared without touching controls", crouchSamples.length === 0, `${crouchSamples.length} crouch frames`);
  check("player did not flap between crouch and idle", !modes.crouch && !modes.crouchWalk, JSON.stringify(modes));
  check("player stays grounded without any movement or jump input after settling",
    settledSamples.length > 0 && uncommandedAirSamples.length === 0,
    `${uncommandedAirSamples.length}/${settledSamples.length} airborne or jump samples`);
  check("stationary player remains in idle after settling",
    settledSamples.length > 0 && settledSamples.every(sample => sample.poseMode === "idle"),
    JSON.stringify(modes));
  check("browser ran without JavaScript or network errors", errors.length === 0, `${errors.length} errors`);
  check("screencast frames were written without errors", !screencastError, screencastError || `${frameCount} images`);

  report.status = failures === 0 ? "passed" : "failed";
  report.failures = failures;
  await fs.writeFile(path.join(OUT, "summary.json"), JSON.stringify(report, null, 2));

  // Keep a handful of full-size reference frames outside the frame directory
  // so they are easy to preview without opening the full capture sequence.
  for (const second of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    const target = diagnostics.reduce((best, sample) =>
      Math.abs(sample.t - second * 1000) < Math.abs(best.t - second * 1000) ? sample : best,
      diagnostics[0]);
    if (!target) continue;
    const index = diagnostics.indexOf(target);
    const source = path.join(FRAMES, (Math.min(frameCount, Math.max(1, Math.round(second * report.screenshotCadenceFps) + 1))).toString().padStart(5, "0") + ".jpg");
    const destination = path.join(OUT, `second-${String(second).padStart(2, "0")}.jpg`);
    await fs.copyFile(source, destination).catch(() => {});
  }

  console.log("PLAYER IDLE CAPTURE " + JSON.stringify({
    status: report.status,
    durationMs: report.durationMs,
    animationFrameSamples: report.animationFrameSamples,
    compositorScreenshots: report.compositorScreenshots,
    screenshotCadenceFps: report.screenshotCadenceFps,
    poseCounts: report.poseCounts,
    poseTransitions: report.poseTransitions,
    crouchSampleCount: report.crouchSampleCount,
    movingSampleCount: report.movingSampleCount,
    browserErrors: report.browserErrors.length,
    failures: report.failures,
  }));
} catch (error) {
  failures++;
  console.error("PLAYER IDLE CAPTURE ERROR", error?.stack || error);
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, "failure.txt"), String(error?.stack || error)).catch(() => {});
} finally {
  if (cdp) await cdp.detach().catch(() => {});
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  server.kill("SIGTERM");
  await new Promise(resolve => {
    if (server.exitCode !== null) return resolve();
    server.once("exit", resolve);
    setTimeout(() => { server.kill("SIGKILL"); resolve(); }, 3000).unref();
  });
  console.log(`PLAYER IDLE CAPTURE ${failures === 0 ? "PASSED" : "FAILED"} · ${failures} failure(s)`);
}
if (failures > 0) process.exitCode = 1;
