/**
 * RemoteForge Desktop Agent — Electron Main Process
 * 
 * This wraps the agent in a proper Windows app with:
 * - System tray icon with status indicator
 * - Auto-start on Windows boot
 * - Background operation (no visible window needed)
 * - Graceful start/stop from tray menu
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } = require('electron');
const path = require('path');
const { fork } = require('child_process');

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let tray = null;
let mainWindow = null;
let agentProcess = null;
let agentStatus = 'stopped'; // 'stopped' | 'starting' | 'running' | 'error'
let lastLogs = [];
const MAX_LOGS = 100;

// Auto-launch setup
let AutoLaunch;
try {
  AutoLaunch = require('auto-launch');
} catch (e) {
  console.log('auto-launch not available');
}

let autoLauncher = null;
if (AutoLaunch) {
  autoLauncher = new AutoLaunch({
    name: 'RemoteForge',
    path: app.getPath('exe'),
    isHidden: true,
  });
}

/**
 * Create the system tray icon
 */
function createTray() {
  // Create a 16x16 tray icon (green circle for online, red for offline)
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  let trayIcon;
  
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) throw new Error('empty');
  } catch (e) {
    // Fallback: create a simple colored icon programmatically
    trayIcon = createStatusIcon('stopped');
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('RemoteForge — Agent Stopped');
  
  updateTrayMenu();

  tray.on('double-click', () => {
    showStatusWindow();
  });
}

/**
 * Create a colored status icon
 */
function createStatusIcon(status) {
  const size = 16;
  const canvas = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="3" fill="${status === 'running' ? '#10b981' : status === 'starting' ? '#f59e0b' : status === 'error' ? '#ef4444' : '#6b7280'}"/>
    <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="white" font-family="Arial" font-size="10" font-weight="bold">R</text>
  </svg>`;
  
  // Convert SVG to data URI for nativeImage
  const buffer = Buffer.from(canvas);
  return nativeImage.createFromBuffer(buffer);
}

/**
 * Update tray icon and menu based on agent status
 */
function updateTrayMenu() {
  if (!tray) return;

  const statusLabel = {
    stopped: '⚪ Agent Stopped',
    starting: '🟡 Starting...',
    running: '🟢 Agent Running',
    error: '🔴 Error',
  }[agentStatus];

  tray.setToolTip(`RemoteForge — ${statusLabel}`);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'RemoteForge Agent', type: 'normal', enabled: false },
    { type: 'separator' },
    { label: statusLabel, type: 'normal', enabled: false },
    { type: 'separator' },
    {
      label: 'Start Agent',
      type: 'normal',
      enabled: agentStatus === 'stopped' || agentStatus === 'error',
      click: () => startAgent(),
    },
    {
      label: 'Stop Agent',
      type: 'normal',
      enabled: agentStatus === 'running' || agentStatus === 'starting',
      click: () => stopAgent(),
    },
    {
      label: 'Restart Agent',
      type: 'normal',
      enabled: agentStatus === 'running',
      click: () => { stopAgent(); setTimeout(() => startAgent(), 1500); },
    },
    { type: 'separator' },
    {
      label: 'Show Status',
      type: 'normal',
      click: () => showStatusWindow(),
    },
    {
      label: 'View Logs',
      type: 'normal',
      click: () => showStatusWindow(),
    },
    { type: 'separator' },
    {
      label: 'Start on Boot',
      type: 'checkbox',
      checked: false, // Will be updated async
      click: async (menuItem) => {
        if (autoLauncher) {
          if (menuItem.checked) {
            await autoLauncher.enable();
          } else {
            await autoLauncher.disable();
          }
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Open Web Dashboard',
      type: 'normal',
      click: () => {
        shell.openExternal('https://remoteforge-mobile-production.up.railway.app');
      },
    },
    { type: 'separator' },
    {
      label: 'Quit RemoteForge',
      type: 'normal',
      click: () => {
        stopAgent();
        setTimeout(() => {
          app.quit();
        }, 1000);
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Update auto-launch checkbox async
  if (autoLauncher) {
    autoLauncher.isEnabled().then(enabled => {
      const items = contextMenu.items;
      // Find the checkbox item
      for (const item of items) {
        if (item.label === 'Start on Boot') {
          item.checked = enabled;
        }
      }
    }).catch(() => {});
  }
}

/**
 * Start the agent as a child process
 */
function startAgent() {
  if (agentProcess) {
    console.log('Agent already running');
    return;
  }

  agentStatus = 'starting';
  updateTrayMenu();
  addLog('Starting JARVIS agent...');

  const agentPath = path.join(__dirname, 'agent.js');
  
  agentProcess = fork(agentPath, [], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });

  agentProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    for (const line of lines) {
      addLog(line);
      
      // Detect when agent is fully running
      if (line.includes('Agent is LIVE')) {
        agentStatus = 'running';
        updateTrayMenu();
      }
    }
  });

  agentProcess.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    for (const line of lines) {
      addLog(`[ERR] ${line}`);
    }
  });

  agentProcess.on('error', (err) => {
    agentStatus = 'error';
    addLog(`Agent error: ${err.message}`);
    updateTrayMenu();
    agentProcess = null;
  });

  agentProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      agentStatus = 'error';
      addLog(`Agent exited with code ${code}`);
    } else {
      agentStatus = 'stopped';
      addLog('Agent stopped');
    }
    updateTrayMenu();
    agentProcess = null;
  });

  // Set a timeout for starting status
  setTimeout(() => {
    if (agentStatus === 'starting') {
      agentStatus = 'running'; // Assume it's running if no error after 10s
      updateTrayMenu();
    }
  }, 10000);
}

/**
 * Stop the agent
 */
function stopAgent() {
  if (!agentProcess) return;

  addLog('Stopping agent...');
  agentProcess.kill('SIGTERM');

  // Force kill after 5 seconds if still running
  setTimeout(() => {
    if (agentProcess) {
      agentProcess.kill('SIGKILL');
      agentProcess = null;
      agentStatus = 'stopped';
      updateTrayMenu();
    }
  }, 5000);
}

/**
 * Add a log entry
 */
function addLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  const entry = `[${timestamp}] ${message}`;
  lastLogs.push(entry);
  if (lastLogs.length > MAX_LOGS) lastLogs.shift();
  
  console.log(entry);

  // Send to status window if open
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', entry);
    mainWindow.webContents.send('status', agentStatus);
  }
}

/**
 * Show the status/log window
 */
function showStatusWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 700,
    height: 500,
    title: 'RemoteForge Agent',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#131314',
    show: false,
    frame: true,
    resizable: true,
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'status.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Send current state
    mainWindow.webContents.send('status', agentStatus);
    mainWindow.webContents.send('logs', lastLogs);
  });

  mainWindow.on('close', (event) => {
    // Minimize to tray instead of closing
    event.preventDefault();
    mainWindow.hide();
  });
}

// ============================================
// IPC Handlers (communication with status window)
// ============================================

ipcMain.handle('get-status', () => agentStatus);
ipcMain.handle('get-logs', () => lastLogs);
ipcMain.handle('start-agent', () => startAgent());
ipcMain.handle('stop-agent', () => stopAgent());
ipcMain.handle('restart-agent', () => {
  stopAgent();
  setTimeout(() => startAgent(), 1500);
});
ipcMain.handle('get-auto-launch', async () => {
  if (!autoLauncher) return false;
  return await autoLauncher.isEnabled();
});
ipcMain.handle('set-auto-launch', async (_, enabled) => {
  if (!autoLauncher) return;
  if (enabled) await autoLauncher.enable();
  else await autoLauncher.disable();
});

// ============================================
// App Lifecycle
// ============================================

app.on('ready', () => {
  createTray();
  
  // Auto-start the agent when the app opens
  startAgent();
});

// Keep running in tray when all windows closed
app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('before-quit', () => {
  stopAgent();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }
});

// Handle second instance
app.on('second-instance', () => {
  showStatusWindow();
});
