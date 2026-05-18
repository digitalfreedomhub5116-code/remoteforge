/**
 * RemoteForge Desktop Agent
 * 
 * The core background service that:
 * 1. Connects to Supabase Realtime
 * 2. Listens for incoming commands from the phone app
 * 3. Executes them safely on this PC
 * 4. Sends results back
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const os = require('os');
const {
  analyzeCommand,
  executeShellCommand,
  executeAppCommand,
  takeScreenshot,
  getSystemInfo,
  executeFileCommand,
} = require('./executor');
const { initAI, interpretCommand } = require('./ai');

// ============================================
// Configuration
// ============================================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const DEVICE_NAME = process.env.DEVICE_NAME || os.hostname();
const COMMAND_TIMEOUT = parseInt(process.env.COMMAND_TIMEOUT_MS || '30000');
const HEARTBEAT_INTERVAL = parseInt(process.env.HEARTBEAT_INTERVAL_MS || '15000');

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

/**
 * Initialize Supabase with user session
 */
function initSupabase(accessToken, refreshToken) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: false,
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
 * Process an incoming command — routes through AI brain first
 */
async function processCommand(command) {
  const { id, raw_input } = command;
  console.log(`\n⚡ Command received: "${raw_input}"`);

  // Mark as processing (AI is thinking)
  await supabase
    .from('commands')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('id', id);

  try {
    // Step 1: Ask AI to interpret the command
    console.log('🧠 AI interpreting...');
    const plan = await interpretCommand(raw_input);
    console.log(`🧠 AI plan: ${plan.summary} (${plan.steps.length} step${plan.steps.length > 1 ? 's' : ''})`);

    // Update with AI summary
    await supabase
      .from('commands')
      .update({ status: 'executing', parsed_command: plan.summary })
      .eq('id', id);

    // Step 2: Check for destructive steps
    const hasDestructive = plan.steps.some(s => s.is_destructive);
    if (hasDestructive) {
      const destructiveDescs = plan.steps.filter(s => s.is_destructive).map(s => s.description).join(', ');
      await supabase
        .from('commands')
        .update({
          status: 'awaiting_confirmation',
          requires_confirmation: true,
          result_stderr: `⚠️ AI detected destructive action: ${destructiveDescs}\nPlease confirm from your phone.`,
          parsed_command: plan.summary,
        })
        .eq('id', id);
      console.log(`⚠️ Awaiting confirmation for destructive steps`);
      return;
    }

    // Step 3: Execute all steps
    const allResults = [];
    let allSuccess = true;
    let screenshotBase64 = null;

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      console.log(`   Step ${i + 1}/${plan.steps.length}: ${step.description} [${step.type}]`);

      let stepResult;

      switch (step.type) {
        case 'screenshot': {
          const ss = await takeScreenshot();
          stepResult = { success: ss.success, stdout: ss.success ? 'Screenshot captured' : '', stderr: ss.error || '' };
          if (ss.success) screenshotBase64 = ss.screenshot_base64;
          break;
        }
        case 'system': {
          const info = await getSystemInfo();
          stepResult = { success: info.success, stdout: info.success ? JSON.stringify(info.info, null, 2) : '', stderr: info.error || '' };
          break;
        }
        case 'app': {
          stepResult = await executeAppCommand(step.command);
          break;
        }
        default: {
          // Safety check on the actual command
          const analysis = analyzeCommand(step.command);
          if (!analysis.allowed) {
            stepResult = { success: false, stdout: '', stderr: analysis.reason };
          } else {
            stepResult = await executeShellCommand(step.command, COMMAND_TIMEOUT);
          }
        }
      }

      if (!stepResult.success) allSuccess = false;
      allResults.push(`[${step.description}]\n${stepResult.stdout || stepResult.stderr || '(no output)'}`);

      // If a step fails, stop executing the rest
      if (!stepResult.success) {
        allResults.push(`\n❌ Step failed — skipping remaining steps.`);
        break;
      }
    }

    // Step 4: Send combined results back
    const combinedOutput = allResults.join('\n\n');
    const updateData = {
      status: allSuccess ? 'completed' : 'failed',
      result_stdout: combinedOutput.slice(0, 50000) || null,
      result_stderr: allSuccess ? null : 'One or more steps failed',
      error_message: allSuccess ? null : 'Execution error',
      completed_at: new Date().toISOString(),
    };

    if (screenshotBase64) {
      updateData.result_screenshot = screenshotBase64;
    }

    await supabase.from('commands').update(updateData).eq('id', id);

    console.log(`${allSuccess ? '✅' : '❌'} ${plan.summary}`);
  } catch (err) {
    await supabase.from('commands').update({
      status: 'failed',
      result_stderr: err.message,
      error_message: err.message,
      completed_at: new Date().toISOString(),
    }).eq('id', id);
    console.error('❌ Error:', err.message);
  }
}

/**
 * Subscribe to new commands via Supabase Realtime
 */
function subscribeToCommands() {
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
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('📡 Listening for commands via Realtime...');
      } else {
        console.log(`📡 Realtime status: ${status}`);
      }
    });

  return channel;
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
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║     🔥 RemoteForge Desktop Agent     ║');
  console.log('║       v2.0.0 — AI-Powered 🧠         ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');

  // Initialize Gemini AI
  const aiReady = initAI(process.env.GEMINI_API_KEY);
  if (!aiReady) {
    console.log('   (Running in basic mode — add GEMINI_API_KEY to .env for AI powers)');
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
    console.error('❌ Session expired. Run: node src/setup.js');
    process.exit(1);
  }

  // Step 4: Listen for token refreshes and save them
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED' && session) {
      const fs = require('fs');
      const path = require('path');
      const envPath = path.join(__dirname, '..', '.env');
      let envContent = fs.readFileSync(envPath, 'utf-8');
      envContent = envContent.replace(/USER_ACCESS_TOKEN=.*/, `USER_ACCESS_TOKEN=${session.access_token}`);
      envContent = envContent.replace(/USER_REFRESH_TOKEN=.*/, `USER_REFRESH_TOKEN=${session.refresh_token}`);
      fs.writeFileSync(envPath, envContent);
      console.log('🔄 Auth tokens refreshed and saved');
    }
  });

  // Step 5: Register device
  await registerDevice();

  // Step 6: Start heartbeat
  startHeartbeat();

  // Step 7: Process any pending commands from while offline
  await processPendingCommands();

  // Step 8: Subscribe to Realtime for new commands
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
