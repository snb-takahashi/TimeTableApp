const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const { fork } = require("node:child_process");

let serverProcess = null;
let mainWindow = null;

/** Finds a free local TCP port by letting the OS assign one. */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Ensures a real SQLite DB exists in userData; copies the packaged
 *  template on first run. Returns the absolute path to the DB file. */
function ensureUserDatabase() {
  const userDataDir = app.getPath("userData");
  fs.mkdirSync(userDataDir, { recursive: true });
  const dbPath = path.join(userDataDir, "timetable.db");

  if (!fs.existsSync(dbPath)) {
    const templatePath = app.isPackaged
      ? path.join(process.resourcesPath, "template.db")
      : path.join(__dirname, "..", "resources", "template.db");
    fs.copyFileSync(templatePath, dbPath);
  }
  return dbPath;
}

/** Starts the bundled Next.js standalone server as a child Node process
 *  running inside Electron's own Node runtime (no system Node required). */
function startNextServer(port, databaseUrl) {
  return new Promise((resolve, reject) => {
    const serverEntry = app.isPackaged
      ? path.join(process.resourcesPath, "app", "server.js")
      : path.join(__dirname, "..", ".next", "standalone", "server.js");

    serverProcess = fork(serverEntry, [], {
      cwd: path.dirname(serverEntry),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        PORT: String(port),
        HOSTNAME: "127.0.0.1",
        DATABASE_URL: `file:${databaseUrl.replace(/\\/g, "/")}`,
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });

    serverProcess.stdout?.on("data", (d) => console.log(`[next] ${d}`));
    serverProcess.stderr?.on("data", (d) => console.error(`[next] ${d}`));
    serverProcess.on("exit", (code) => {
      console.error(`Next server exited early with code ${code}`);
      if (mainWindow) mainWindow = null;
    });
    serverProcess.on("error", reject);

    waitForServerReady(port).then(resolve).catch(reject);
  });
}

async function waitForServerReady(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/admin/timetable`);
      if (res.status < 500) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Timed out waiting for the local server to start.");
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(`http://127.0.0.1:${port}/admin/timetable`);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    // Dev mode: point straight at `next dev` instead of spawning a server,
    // so the Electron shell can be developed with the ordinary Next.js dev
    // server (hot reload, etc.) running alongside it.
    if (process.env.ELECTRON_START_URL) {
      createWindow(new URL(process.env.ELECTRON_START_URL).port || "3000");
      return;
    }

    const dbPath = ensureUserDatabase();
    const port = await getFreePort();
    await startNextServer(port, dbPath);
    createWindow(port);
  } catch (err) {
    console.error("Failed to start app:", err);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
  }
});
