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

// Remove default menu bar from all windows
Menu.setApplicationMenu(null);

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
        shell.openExternal('https://remoteforge-production.up.railway.app');
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

  // Listen for structured messages from the agent (command updates)
  agentProcess.on('message', (msg) => {
    if (msg && msg.type === 'command' && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('command', msg.data);
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
// Auth Helpers
// ============================================

const fs = require('fs');
const dotenvPath = path.join(__dirname, '..', '.env');

function loadEnv() {
  try {
    const content = fs.readFileSync(dotenvPath, 'utf-8');
    const env = {};
    for (const line of content.split('\n')) {
      const [key, ...vals] = line.split('=');
      if (key && vals.length) env[key.trim()] = vals.join('=').trim();
    }
    return env;
  } catch { return {}; }
}

function saveTokensToEnv(accessToken, refreshToken) {
  let content = '';
  try { content = fs.readFileSync(dotenvPath, 'utf-8'); } catch {}
  
  if (content.includes('USER_ACCESS_TOKEN=')) {
    content = content.replace(/USER_ACCESS_TOKEN=.*/, `USER_ACCESS_TOKEN=${accessToken}`);
  } else {
    content += `\nUSER_ACCESS_TOKEN=${accessToken}`;
  }
  if (content.includes('USER_REFRESH_TOKEN=')) {
    content = content.replace(/USER_REFRESH_TOKEN=.*/, `USER_REFRESH_TOKEN=${refreshToken}`);
  } else {
    content += `\nUSER_REFRESH_TOKEN=${refreshToken}`;
  }
  fs.writeFileSync(dotenvPath, content.trim() + '\n');
}

function hasTokens() {
  const env = loadEnv();
  return !!(env.USER_ACCESS_TOKEN && env.USER_REFRESH_TOKEN);
}

// ============================================
// Login Window
// ============================================

let loginWindow = null;

function showLoginWindow() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.show();
    loginWindow.focus();
    return;
  }

  loginWindow = new BrowserWindow({
    width: 460,
    height: 560,
    title: 'RemoteForge — Sign In',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#0a0a0b',
    resizable: false,
    maximizable: false,
    frame: true,
  });

  loginWindow.loadFile(path.join(__dirname, '..', 'ui', 'login.html'));

  loginWindow.on('closed', () => {
    loginWindow = null;
  });
}

// ============================================
// Supabase Auth from Main Process
// ============================================

let supabaseAuth = null;

function getSupabaseAuth() {
  if (supabaseAuth) return supabaseAuth;
  const { createClient } = require('@supabase/supabase-js');
  const env = loadEnv();
  const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  supabaseAuth = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return supabaseAuth;
}

// ============================================
// IPC Handlers
// ============================================

// Auth handlers
ipcMain.handle('sign-in', async (_, email, password) => {
  const sb = getSupabaseAuth();
  if (!sb) return { error: 'Supabase not configured. Check your .env file.' };

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  // Save tokens
  saveTokensToEnv(data.session.access_token, data.session.refresh_token);
  
  // Set env vars for the agent process
  process.env.USER_ACCESS_TOKEN = data.session.access_token;
  process.env.USER_REFRESH_TOKEN = data.session.refresh_token;

  addLog(`✅ Signed in as ${email}`);

  // Close login, open status, start agent
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.close();
    loginWindow = null;
  }
  showStatusWindow();
  startAgent();

  return { success: true };
});

ipcMain.handle('sign-in-google', async () => {
  const env = loadEnv();
  const url = env.SUPABASE_URL || process.env.SUPABASE_URL;
  if (!url) return { error: 'Supabase not configured' };

  // Start a local server FIRST to handle the OAuth callback
  const http = require('http');
  let server;

  try {
    server = http.createServer(async (req, res) => {
      // Supabase redirects to /auth/callback#access_token=...&refresh_token=...
      // The # hash fragment never reaches the server, so we serve an HTML page
      // that reads the hash client-side and sends tokens via /auth/token endpoint

      if (req.url && req.url.startsWith('/auth/callback')) {
        // Serve the token-extraction page
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
          <html><head><style>*{margin:0}body{background:#0a0a0b;color:#8ab4f8;font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh}</style></head>
          <body><div style="text-align:center" id="msg"><div style="width:32px;height:32px;border:3px solid rgba(138,180,248,0.15);border-top-color:#8ab4f8;border-radius:50%;animation:s .7s linear infinite;margin:0 auto 16px"></div><p>Signing you in...</p></div>
          <style>@keyframes s{to{transform:rotate(360deg)}}</style>
          <script>
            // Extract tokens from URL hash fragment
            const hash = window.location.hash.substring(1);
            const params = new URLSearchParams(hash);
            const accessToken = params.get('access_token');
            const refreshToken = params.get('refresh_token');
            if (accessToken && refreshToken) {
              fetch('/auth/token?access_token=' + accessToken + '&refresh_token=' + refreshToken)
                .then(() => { document.getElementById('msg').innerHTML = '<h2>✅ Signed in!</h2><p style="color:#7a7a85;margin-top:8px">You can close this tab.</p>'; })
                .catch(() => { document.getElementById('msg').innerHTML = '<h2 style="color:#f87171">Error saving token</h2>'; });
            } else {
              document.getElementById('msg').innerHTML = '<h2 style="color:#f87171">Sign-in failed</h2><p style="color:#7a7a85;margin-top:8px">Close this tab and try again.</p>';
            }
          </script></body></html>`);
        return;
      }

      if (req.url && req.url.startsWith('/auth/token')) {
        // Receive the tokens forwarded from the client-side JS
        const urlObj = new URL(`http://localhost${req.url}`);
        const accessToken = urlObj.searchParams.get('access_token');
        const refreshToken = urlObj.searchParams.get('refresh_token');

        if (accessToken && refreshToken) {
          saveTokensToEnv(accessToken, refreshToken);
          process.env.USER_ACCESS_TOKEN = accessToken;
          process.env.USER_REFRESH_TOKEN = refreshToken;

          addLog('✅ Signed in via Google OAuth');
          if (loginWindow && !loginWindow.isDestroyed()) {
            loginWindow.close();
            loginWindow = null;
          }
          showStatusWindow();
          startAgent();

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"ok":true}');
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end('{"error":"missing tokens"}');
        }
        // Close server after a short delay
        setTimeout(() => { try { server.close(); } catch {} }, 2000);
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    await new Promise((resolve, reject) => {
      server.listen(54321, () => {
        console.log('OAuth callback server listening on :54321');
        resolve();
      });
      server.on('error', reject);
    });
  } catch (err) {
    console.error('Failed to start OAuth server:', err.message);
    return { error: 'Could not start auth server. Port 54321 may be in use.' };
  }

  // Now open the browser with the OAuth URL
  const oauthUrl = `${url}/auth/v1/authorize?provider=google&redirect_to=http://localhost:54321/auth/callback`;
  shell.openExternal(oauthUrl);

  // Auto-close server after 3 minutes if no callback
  setTimeout(() => { try { server.close(); } catch {} }, 180000);

  return { success: true };
});

// Agent control handlers
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
  
  // Check if user is already authenticated
  if (hasTokens()) {
    // Already signed in — go straight to status window + start agent
    showStatusWindow();
    startAgent();
  } else {
    // Not signed in — show login window first
    showLoginWindow();
  }
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
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.destroy();
  }
});

// Handle second instance
app.on('second-instance', () => {
  if (hasTokens()) showStatusWindow();
  else showLoginWindow();
});
