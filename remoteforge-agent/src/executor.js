/**
 * RemoteForge - Command Executor
 * 
 * Safely executes system commands with timeouts,
 * output streaming, and destructive-command protection.
 */

const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Commands that MUST require user confirmation from the phone
const DESTRUCTIVE_PATTERNS = [
  /\brm\b.*-rf/i,
  /\brmdir\b/i,
  /\bdel\b.*\/s/i,
  /\bformat\b/i,
  /\bRemove-Item\b.*-Recurse/i,
  /\bshutdown\b/i,
  /\brestart\b/i,
  /\bStop-Computer\b/i,
  /\bRestart-Computer\b/i,
  /\breg\s+delete\b/i,
  /\bnet\s+user\b.*\/delete/i,
  /\bdiskpart\b/i,
];

// Commands that are completely blocked (never execute)
const BLOCKED_PATTERNS = [
  /\bformat\s+c:/i,
  /\bcmd.*\/c.*format/i,
  /\b::\(\)\{.*\|.*&\}/,  // fork bomb
];

/**
 * Check if a command is destructive and needs confirmation
 */
function analyzeCommand(command) {
  // Check if completely blocked
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return { allowed: false, reason: 'This command is permanently blocked for safety.' };
    }
  }

  // Check if destructive (needs confirmation)
  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      return { allowed: true, requiresConfirmation: true, reason: `Destructive command detected: ${pattern.source}` };
    }
  }

  return { allowed: true, requiresConfirmation: false };
}

/**
 * Execute a shell command with timeout and output capture
 */
function executeShellCommand(command, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';

    // Use PowerShell on Windows for maximum compatibility
    const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';
    const shellFlag = process.platform === 'win32' ? '-Command' : '-c';

    const child = spawn(shell, [shellFlag, command], {
      cwd: os.homedir(),
      env: process.env,
      windowsHide: true, // Don't show console windows
    });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        success: false,
        stdout: stdout.slice(0, 10000), // Cap output at 10KB
        stderr: 'Command timed out after ' + (timeoutMs / 1000) + ' seconds',
        duration_ms: Date.now() - startTime,
        killed: true,
      });
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        success: code === 0,
        exit_code: code,
        stdout: stdout.slice(0, 10000),
        stderr: stderr.slice(0, 5000),
        duration_ms: Date.now() - startTime,
        killed: false,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        stdout: '',
        stderr: err.message,
        duration_ms: Date.now() - startTime,
        killed: false,
      });
    });
  });
}

/**
 * Execute an "open app" command
 */
async function executeAppCommand(appName) {
  // Common app mappings for Windows
  const appMap = {
    'notepad': 'notepad.exe',
    'calculator': 'calc.exe',
    'paint': 'mspaint.exe',
    'explorer': 'explorer.exe',
    'file explorer': 'explorer.exe',
    'task manager': 'taskmgr.exe',
    'settings': 'ms-settings:',
    'chrome': 'chrome',
    'google chrome': 'chrome',
    'firefox': 'firefox',
    'edge': 'msedge',
    'vs code': 'code',
    'vscode': 'code',
    'visual studio code': 'code',
    'spotify': 'spotify',
    'discord': 'discord',
    'terminal': 'wt.exe',
    'powershell': 'powershell.exe',
    'cmd': 'cmd.exe',
  };

  const normalized = appName.toLowerCase().trim();
  const executable = appMap[normalized] || appName;

  try {
    // Dynamic import for the ESM 'open' package
    const open = (await import('open')).default;
    
    if (executable.startsWith('ms-settings:')) {
      await open(executable);
    } else {
      // Try to launch it
      const result = await executeShellCommand(`Start-Process "${executable}"`, 10000);
      if (!result.success) {
        // Fallback: try using 'open' package
        await open(executable);
      }
    }

    return { success: true, stdout: `Opened ${appName}`, stderr: '' };
  } catch (err) {
    return { success: false, stdout: '', stderr: `Failed to open ${appName}: ${err.message}` };
  }
}

/**
 * Take a screenshot and return as base64
 */
async function takeScreenshot() {
  try {
    const screenshot = require('screenshot-desktop');
    const screenshotDir = path.join(__dirname, '..', 'screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    const imgBuffer = await screenshot({ format: 'png' });
    const filename = `screenshot_${Date.now()}.png`;
    const filepath = path.join(screenshotDir, filename);
    fs.writeFileSync(filepath, imgBuffer);

    // Return base64 for sending back through Supabase
    const base64 = imgBuffer.toString('base64');
    return {
      success: true,
      screenshot_base64: base64.slice(0, 500000), // Cap at ~375KB
      filepath,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Get system information
 */
async function getSystemInfo() {
  const si = require('systeminformation');

  try {
    const [cpu, mem, disk, battery, osInfo] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.battery(),
      si.osInfo(),
    ]);

    return {
      success: true,
      info: {
        os: `${osInfo.distro} ${osInfo.release}`,
        cpu_usage: `${cpu.currentLoad.toFixed(1)}%`,
        ram_total: `${(mem.total / 1073741824).toFixed(1)} GB`,
        ram_used: `${(mem.used / 1073741824).toFixed(1)} GB`,
        ram_percent: `${((mem.used / mem.total) * 100).toFixed(1)}%`,
        disk: disk.map(d => ({
          mount: d.mount,
          size: `${(d.size / 1073741824).toFixed(1)} GB`,
          used: `${d.use.toFixed(1)}%`,
        })),
        battery: battery.hasBattery ? `${battery.percent}% ${battery.isCharging ? '(charging)' : ''}` : 'No battery',
      },
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Execute a file operation (list, search, move, copy)
 */
async function executeFileCommand(operation, params) {
  switch (operation) {
    case 'list':
      return executeShellCommand(`Get-ChildItem "${params.path || '.'}" | Format-Table Name, Length, LastWriteTime -AutoSize`);
    case 'search':
      return executeShellCommand(`Get-ChildItem -Path "${params.path || 'C:\\'}" -Recurse -Filter "${params.query}" -ErrorAction SilentlyContinue | Select-Object -First 20 FullName`);
    case 'read':
      return executeShellCommand(`Get-Content "${params.path}" -TotalCount 100`);
    default:
      return { success: false, stderr: `Unknown file operation: ${operation}` };
  }
}

module.exports = {
  analyzeCommand,
  executeShellCommand,
  executeAppCommand,
  takeScreenshot,
  getSystemInfo,
  executeFileCommand,
};
