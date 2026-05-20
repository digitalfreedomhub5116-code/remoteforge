/**
 * RemoteForge Desktop Agent
 * 
 * The core background service that:
 * 1. Connects to Supabase Realtime
 * 2. Listens for incoming commands from the phone app
 * 3. Executes them safely on this PC
 * 4. Sends results back
 */

const path = require('path');
const fs = require('fs');

// Load .env only if it exists and only for vars NOT already set
// In packaged builds, tokens come via process.env from the Electron parent
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath, override: false });
}

const { createClient } = require('@supabase/supabase-js');
const os = require('os');
const {
  analyzeCommand,
  executeShellCommand,
  executeAppCommand,
  takeScreenshot,
  getSystemInfo,
  executeFileCommand,
  executeKeyboardCommand,
} = require('./executor');
const { initAI, processWithJarvis } = require('./ai');

// ============================================
// Configuration
// ============================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const DEVICE_NAME = process.env.DEVICE_NAME || os.hostname();
const COMMAND_TIMEOUT = parseInt(process.env.COMMAND_TIMEOUT_MS || '30000');
const HEARTBEAT_INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL_MS || '10000');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

// ============================================
// Supabase Client
// ============================================
let supabase;
let deviceId = null;
let userId = null;
let heartbeatTimer = null;
let realtimeChannel = null;
let healthCheckTimer = null;
let reconnectAttempts = 0;
let currentPairingCode = null;
const MAX_RECONNECT_DELAY = 30000;

/**
 * Initialize Supabase with user session
 */
function initSupabase(accessToken, refreshToken) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: false,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });

  if (accessToken && refreshToken) {
    return supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
  }
}

/**
 * Register this PC as a device in the database
 */
async function registerDevice() {
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) throw new Error('Not authenticated');

  userId = user.user.id;

  // Check if this device is already registered
  const { data: existing } = await supabase
    .from('devices')
    .select('id')
    .eq('user_id', userId)
    .eq('device_name', DEVICE_NAME)
    .eq('device_type', 'pc')
    .single();

  if (existing) {
    deviceId = existing.id;
    // Update online status
    await supabase
      .from('devices')
      .update({ is_online: true, last_seen_at: new Date().toISOString(), platform: process.platform === 'win32' ? 'windows' : process.platform })
      .eq('id', deviceId);

    console.log(`📟 Device reconnected: ${DEVICE_NAME} (${deviceId})`);
  } else {
    // Register new device
    const { data: newDevice, error } = await supabase
      .from('devices')
      .insert({
        user_id: userId,
        device_name: DEVICE_NAME,
        device_type: 'pc',
        platform: process.platform === 'win32' ? 'windows' : process.platform,
        is_online: true,
        metadata: {
          hostname: os.hostname(),
          arch: os.arch(),
          cpus: os.cpus().length,
          totalMemory: `${(os.totalmem() / 1073741824).toFixed(1)} GB`,
        },
      })
      .select('id')
      .single();

    if (error) throw error;
    deviceId = newDevice.id;
    console.log(`📟 Device registered: ${DEVICE_NAME} (${deviceId})`);
  }

  return deviceId;
}

// ============================================
// Pairing Code System
// ============================================

/**
 * Generate a 6-digit alphanumeric pairing code (A-Z, 0-9)
 */
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I,O,0,1 to avoid confusion
  let code = '';
  const crypto = require('crypto');
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

/**
 * Create a new pairing code for this device and store it in the DB.
 * Returns the 6-character code string.
 */
async function createPairingCode() {
  // Invalidate any existing unused codes for this device
  await supabase
    .from('pairing_tokens')
    .update({ is_used: true })
    .eq('pc_device_id', deviceId)
    .eq('is_used', false);

  const code = generateCode();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes

  const { error } = await supabase
    .from('pairing_tokens')
    .insert({
      user_id: userId,
      pc_device_id: deviceId,
      code: code,
      expires_at: expiresAt,
    });

  if (error) {
    console.error('❌ Failed to create pairing code:', error.message);
    return null;
  }

  currentPairingCode = code;
  console.log(`🔑 Pairing code: ${code} (expires in 5 minutes)`);

  // Notify the Electron main process
  if (typeof process.send === 'function') {
    process.send({ type: 'pairing-code', code: code });
  }

  // Auto-regenerate before expiry (every 4 minutes)
  setTimeout(() => {
    if (deviceId && supabase) {
      createPairingCode();
    }
  }, 4 * 60 * 1000);

  return code;
}

/**
 * Start the heartbeat — tell Supabase this PC is alive every N seconds
 */
function startHeartbeat() {
  heartbeatTimer = setInterval(async () => {
    try {
      await supabase
        .from('devices')
        .update({ is_online: true, last_seen_at: new Date().toISOString() })
        .eq('id', deviceId);
    } catch (err) {
      console.error('💓 Heartbeat failed:', err.message);
    }
  }, HEARTBEAT_INTERVAL);

  console.log(`💓 Heartbeat started (every ${HEARTBEAT_INTERVAL / 1000}s)`);
}

/**
 * Tool executor — maps AI function calls to actual PC operations
 */
async function executeTool(toolName, args) {
  switch (toolName) {
    case 'run_powershell': {
      const analysis = analyzeCommand(args.command);
      if (!analysis.allowed) return { success: false, error: analysis.reason };
      const result = await executeShellCommand(args.command, COMMAND_TIMEOUT);
      return { success: result.success, output: result.stdout || '', error: result.stderr || '' };
    }
    case 'open_application':
      return await executeAppCommand(args.app_name);
    case 'take_screenshot': {
      const ss = await takeScreenshot();
      return { success: ss.success, message: ss.success ? 'Screenshot captured successfully' : 'Screenshot failed', screenshot_base64: ss.screenshot_base64 };
    }
    case 'get_system_info': {
      const info = await getSystemInfo();
      return info.success ? { success: true, ...info.info } : { success: false, error: info.error };
    }
    case 'type_text': {
      const cmd = JSON.stringify({ action: 'type', text: args.text });
      return await executeKeyboardCommand(cmd);
    }
    case 'press_keys': {
      const cmd = JSON.stringify({ action: 'hotkey', keys: args.keys });
      return await executeKeyboardCommand(cmd);
    }
    case 'focus_window': {
      const psCmd = `(New-Object -ComObject WScript.Shell).AppActivate('${args.window_title.replace(/'/g, "''")}')`;
      const result = await executeShellCommand(psCmd, 5000);
      await new Promise(r => setTimeout(r, 500)); // Wait for focus
      return { success: result.success, message: result.success ? `Focused: ${args.window_title}` : 'Window not found' };
    }
    case 'click_at': {
      const x = parseInt(args.x, 10);
      const y = parseInt(args.y, 10);
      const btn = args.button || 'left';
      // Use PowerShell + user32.dll for reliable mouse click
      let clickScript;
      if (btn === 'double') {
        clickScript = `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Mouse { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo); }';
[Mouse]::SetCursorPos(${x}, ${y}); Start-Sleep -Milliseconds 50;
[Mouse]::mouse_event(0x0002, 0, 0, 0, 0); [Mouse]::mouse_event(0x0004, 0, 0, 0, 0); Start-Sleep -Milliseconds 80;
[Mouse]::mouse_event(0x0002, 0, 0, 0, 0); [Mouse]::mouse_event(0x0004, 0, 0, 0, 0);`;
      } else if (btn === 'right') {
        clickScript = `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Mouse { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo); }';
[Mouse]::SetCursorPos(${x}, ${y}); Start-Sleep -Milliseconds 50;
[Mouse]::mouse_event(0x0008, 0, 0, 0, 0); [Mouse]::mouse_event(0x0010, 0, 0, 0, 0);`;
      } else {
        clickScript = `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Mouse { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y); [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo); }';
[Mouse]::SetCursorPos(${x}, ${y}); Start-Sleep -Milliseconds 50;
[Mouse]::mouse_event(0x0002, 0, 0, 0, 0); [Mouse]::mouse_event(0x0004, 0, 0, 0, 0);`;
      }
      const result = await executeShellCommand(clickScript, 5000);
      return { success: result.success, message: `Clicked at (${x}, ${y}) with ${btn} button` };
    }
    case 'screen_after_action':
      // This is a virtual tool — the screenshot is handled in the AI loop
      return { success: true, message: 'Screenshot captured for verification' };
    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

/**
 * Process an incoming command — routes through JARVIS brain
 */
// Track current processing command for abort
let currentCommandId = null;

async function processCommand(command) {
  const { id, raw_input, command_type } = command;
  console.log(`\n⚡ Command received: "${raw_input}"`);

  // Check if already cancelled before we start
  const { data: fresh } = await supabase.from('commands').select('status').eq('id', id).single();
  if (fresh && fresh.status === 'cancelled') {
    console.log('⏹ Command was cancelled before processing, skipping.');
    return;
  }

  currentCommandId = id;

  // Notify Electron parent of new command
  sendToParent({ id, raw_input, command_type, status: 'processing', created_at: command.created_at || new Date().toISOString() });

  // Mark as processing (JARVIS is thinking)
  await supabase.from('commands').update({ 
    status: 'processing', 
    started_at: new Date().toISOString() 
  }).eq('id', id);

  try {
    console.log('🧠 JARVIS thinking...');

    // Send to JARVIS brain — pass cancellation checker
    const isCancelled = async () => {
      const { data } = await supabase.from('commands').select('status').eq('id', id).single();
      return data && data.status === 'cancelled';
    };
    const result = await processWithJarvis(raw_input, deviceId, executeTool, isCancelled);

    // Check if cancelled during processing
    if (result.cancelled) {
      console.log('⏹ Command was aborted during processing.');
      currentCommandId = null;
      return;
    }

    console.log(`✅ JARVIS: ${result.text.slice(0, 80)}...`);

    // Send the natural language response back
    const updateData = {
      status: 'completed',
      result_stdout: result.text,
      parsed_command: null,
      completed_at: new Date().toISOString(),
    };

    if (result.screenshot_base64) {
      updateData.result_screenshot = result.screenshot_base64;
    }

    await supabase.from('commands').update(updateData).eq('id', id);

    // Notify Electron parent of completion
    sendToParent({ id, raw_input, status: 'completed', result_stdout: result.text, created_at: command.created_at || new Date().toISOString() });

  } catch (err) {
    console.error('❌ JARVIS error:', err.message);
    await supabase.from('commands').update({
      status: 'failed',
      result_stdout: `I ran into an issue: ${err.message}. Could you try rephrasing that?`,
      completed_at: new Date().toISOString(),
    }).eq('id', id);

    // Notify Electron parent of failure
    sendToParent({ id, raw_input, status: 'failed', result_stderr: err.message, created_at: command.created_at || new Date().toISOString() });
  }
  currentCommandId = null;
}

/**
 * Send structured data to Electron parent process (if running as child)
 */
function sendToParent(cmdData) {
  if (typeof process.send === 'function') {
    process.send({ type: 'command', data: cmdData });
  }
}

/**
 * Subscribe to new commands via Supabase Realtime
 * Includes robust reconnection and health monitoring
 */
function subscribeToCommands() {
  // Clean up previous channel if exists
  if (realtimeChannel) {
    try {
      supabase.removeChannel(realtimeChannel);
    } catch (e) {
      console.log('   ⚠️ Error removing old channel:', e.message);
    }
    realtimeChannel = null;
  }

  const channel = supabase
    .channel('commands-listener')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'commands',
        filter: `pc_device_id=eq.${deviceId}`,
      },
      (payload) => {
        const command = payload.new;
        if (command.status === 'pending') {
          processCommand(command);
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'commands',
        filter: `pc_device_id=eq.${deviceId}`,
      },
      (payload) => {
        const command = payload.new;
        // Handle confirmed destructive commands
        if (command.status === 'pending' && command.confirmed_at && command.requires_confirmation) {
          console.log(`✅ Confirmation received for command: ${command.raw_input}`);
          processCommand({ ...command, requires_confirmation: false });
        }
        // Handle "Implement Plan" button click
        if (command.status === 'pending' && command.command_type === 'execute_plan') {
          console.log(`▶ Plan implementation requested: ${command.raw_input}`);
          processCommand(command);
        }
      }
    )
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        console.log('📡 Listening for commands via Realtime...');
        reconnectAttempts = 0; // Reset on successful subscription
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error(`📡 Realtime ${status}${err ? ': ' + err.message : ''} — will reconnect...`);
        scheduleReconnect();
      } else if (status === 'CLOSED') {
        console.log('📡 Realtime channel closed — reconnecting...');
        scheduleReconnect();
      } else {
        console.log(`📡 Realtime status: ${status}`);
      }
    });

  realtimeChannel = channel;

  // Start health monitoring
  startChannelHealthCheck();

  return channel;
}

/**
 * Schedule a reconnection with exponential backoff
 */
function scheduleReconnect() {
  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), MAX_RECONNECT_DELAY);
  console.log(`   🔄 Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt #${reconnectAttempts})...`);

  setTimeout(async () => {
    try {
      // Refresh the auth session first
      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        console.error('   ❌ Session refresh failed:', error.message);
        // Try reloading tokens from .env in case main process updated them
        const fs = require('fs');
        const envPath = path.join(__dirname, '..', '.env');
        try {
          const envContent = fs.readFileSync(envPath, 'utf-8');
          const tokenMatch = envContent.match(/USER_ACCESS_TOKEN=(.+)/);
          const refreshMatch = envContent.match(/USER_REFRESH_TOKEN=(.+)/);
          if (tokenMatch && refreshMatch) {
            await supabase.auth.setSession({
              access_token: tokenMatch[1].trim(),
              refresh_token: refreshMatch[1].trim(),
            });
            console.log('   🔑 Reloaded tokens from .env');
          }
        } catch (e) {
          console.error('   ❌ Could not reload tokens:', e.message);
        }
      } else if (data.session) {
        console.log('   🔑 Session refreshed successfully');
        // Save refreshed tokens to .env
        const fs = require('fs');
        const envPath = path.join(__dirname, '..', '.env');
        try {
          let envContent = fs.readFileSync(envPath, 'utf-8');
          envContent = envContent.replace(/USER_ACCESS_TOKEN=.*/, `USER_ACCESS_TOKEN=${data.session.access_token}`);
          envContent = envContent.replace(/USER_REFRESH_TOKEN=.*/, `USER_REFRESH_TOKEN=${data.session.refresh_token}`);
          fs.writeFileSync(envPath, envContent);
        } catch (e) {
          // Non-critical
        }
      }

      // Re-subscribe
      subscribeToCommands();

      // Process any pending commands that arrived while disconnected
      await processPendingCommands();

    } catch (err) {
      console.error('   ❌ Reconnection failed:', err.message);
      scheduleReconnect(); // Try again
    }
  }, delay);
}

/**
 * Periodically check channel health and process missed pending commands
 */
function startChannelHealthCheck() {
  if (healthCheckTimer) clearInterval(healthCheckTimer);

  healthCheckTimer = setInterval(async () => {
    // Check if channel is still active
    if (!realtimeChannel || realtimeChannel.state !== 'joined') {
      console.log('📡 Health check: channel not joined — reconnecting...');
      scheduleReconnect();
      return;
    }

    // Also sweep for any pending commands that might have been missed
    // (e.g., during a brief disconnect that wasn't caught)
    try {
      const { data: pending } = await supabase
        .from('commands')
        .select('*')
        .eq('pc_device_id', deviceId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });

      if (pending && pending.length > 0) {
        console.log(`📋 Health check found ${pending.length} pending command(s) — processing...`);
        for (const cmd of pending) {
          await processCommand(cmd);
        }
      }
    } catch (e) {
      console.error('📋 Health check query failed:', e.message);
    }
  }, 30000); // Every 30 seconds
}

/**
 * Also check for any pending commands that arrived while offline
 */
async function processPendingCommands() {
  const { data: pending } = await supabase
    .from('commands')
    .select('*')
    .eq('pc_device_id', deviceId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (pending && pending.length > 0) {
    console.log(`📋 Found ${pending.length} pending commands from while offline`);
    for (const cmd of pending) {
      await processCommand(cmd);
    }
  }
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  console.log('\n🛑 Shutting down RemoteForge Agent...');

  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (healthCheckTimer) clearInterval(healthCheckTimer);

  if (realtimeChannel) {
    try { supabase.removeChannel(realtimeChannel); } catch (e) {}
  }

  if (deviceId && supabase) {
    await supabase
      .from('devices')
      .update({ is_online: false, last_seen_at: new Date().toISOString() })
      .eq('id', deviceId);
  }

  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ============================================
// Main Entry Point
// ============================================
async function main() {
  // Debug: write startup log to a known location
  try {
    const logDir = process.env.APPDATA ? path.join(process.env.APPDATA, 'RemoteForge') : __dirname;
    const debugFs = require('fs');
    debugFs.mkdirSync(logDir, { recursive: true });
    const debugLog = [
      `Agent started at: ${new Date().toISOString()}`,
      `SUPABASE_URL: ${process.env.SUPABASE_URL ? 'SET (' + process.env.SUPABASE_URL.slice(0, 30) + '...)' : 'MISSING'}`,
      `SUPABASE_ANON_KEY: ${process.env.SUPABASE_ANON_KEY ? 'SET (' + process.env.SUPABASE_ANON_KEY.slice(0, 20) + '...)' : 'MISSING'}`,
      `USER_ACCESS_TOKEN: ${process.env.USER_ACCESS_TOKEN ? 'SET (length=' + process.env.USER_ACCESS_TOKEN.length + ')' : 'MISSING/EMPTY'}`,
      `USER_REFRESH_TOKEN: ${process.env.USER_REFRESH_TOKEN ? 'SET (length=' + process.env.USER_REFRESH_TOKEN.length + ')' : 'MISSING/EMPTY'}`,
      `AI_API_KEY: ${process.env.AI_API_KEY ? 'SET' : 'MISSING'}`,
      `DEVICE_NAME: ${process.env.DEVICE_NAME || 'NOT SET'}`,
      `__dirname: ${__dirname}`,
      `cwd: ${process.cwd()}`,
      `app.isPackaged context: ${!!process.env.ELECTRON_IS_PACKAGED || 'unknown'}`,
    ].join('\n');
    debugFs.writeFileSync(path.join(logDir, 'agent-debug.log'), debugLog);
  } catch (e) {
    console.error('Debug log failed:', e.message);
  }

  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║     🔥 RemoteForge Desktop Agent     ║');
  console.log('║     v3.0.0 — JARVIS Mode 🤖          ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');

  // Initialize JARVIS brain (supports OpenRouter, Groq, DeepSeek, Gemini)
  const aiReady = initAI({
    apiKey: process.env.AI_API_KEY || process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY,
    provider: process.env.AI_PROVIDER, // auto-detected from key if not set
    model: process.env.AI_MODEL,       // uses provider default if not set
  });
  if (!aiReady) {
    console.log('   ⚠️ JARVIS brain offline — add AI_API_KEY to .env');
  }

  // Step 1: Initialize Supabase
  const accessToken = process.env.USER_ACCESS_TOKEN;
  const refreshToken = process.env.USER_REFRESH_TOKEN;

  initSupabase(accessToken, refreshToken);

  // Step 2: Check if we need to sign in
  if (!accessToken || !refreshToken) {
    console.log('🔐 First-time setup — you need to sign in.');
    console.log('   Run: node src/setup.js');
    process.exit(0);
  }

  // Step 3: Restore session
  const { error: sessionError } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (sessionError) {
    console.error('❌ Session expired — need to re-login');
    // Exit with code 2 to signal main.js to show login window
    process.exit(2);
  }

  // Step 4: Listen for token refreshes and save them + reconnect Realtime
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'TOKEN_REFRESHED' && session) {
      const fs = require('fs');
      const envPath = path.join(__dirname, '..', '.env');
      try {
        let envContent = fs.readFileSync(envPath, 'utf-8');
        envContent = envContent.replace(/USER_ACCESS_TOKEN=.*/, `USER_ACCESS_TOKEN=${session.access_token}`);
        envContent = envContent.replace(/USER_REFRESH_TOKEN=.*/, `USER_REFRESH_TOKEN=${session.refresh_token}`);
        fs.writeFileSync(envPath, envContent);
      } catch (e) {
        console.error('⚠️ Could not save refreshed tokens:', e.message);
      }
      console.log('🔄 Auth tokens refreshed and saved');

      // Re-subscribe to Realtime with the new token
      // The Supabase client should handle this, but force it to be safe
      if (realtimeChannel && realtimeChannel.state !== 'joined') {
        console.log('🔄 Reconnecting Realtime after token refresh...');
        subscribeToCommands();
        await processPendingCommands();
      }
    } else if (event === 'SIGNED_OUT') {
      console.error('❌ Auth session ended — agent stopping.');
      await shutdown();
    }
  });

  // Step 5: Register device
  await registerDevice();

  // Step 6: Generate pairing code
  await createPairingCode();

  // Step 7: Start heartbeat
  startHeartbeat();

  // Step 8: Process any pending commands from while offline
  await processPendingCommands();

  // Step 9: Subscribe to Realtime for new commands
  subscribeToCommands();

  console.log('');
  console.log(`🟢 Agent is LIVE — Device: ${DEVICE_NAME} (${deviceId})`);
  console.log('   Waiting for commands from your phone...');
  console.log('   Press Ctrl+C to stop.');
  console.log('');
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
