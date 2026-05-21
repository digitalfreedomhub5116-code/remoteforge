/**
 * RemoteForge — JARVIS AI Brain
 * 
 * Multi-provider AI backend using OpenAI-compatible APIs.
 * Supports: OpenRouter, Groq, DeepSeek, or any OpenAI-compatible endpoint.
 * 
 * Uses function calling (tool use) for PC control.
 * No external AI SDK needed — uses native fetch.
 */

const path = require('path');

// ---- Tool Definitions (OpenAI format) ----
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'run_powershell',
      description: 'Execute a PowerShell command on the Windows PC. Use for file ops, network, processes, installs, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The PowerShell command to execute' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_application',
      description: 'Open/launch an application by name. Examples: chrome, notepad, vscode, discord, spotify, calculator',
      parameters: {
        type: 'object',
        properties: {
          app_name: { type: 'string', description: 'Name of the app to open' },
        },
        required: ['app_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'take_screenshot',
      description: 'Capture a screenshot of the current screen. Use to SEE what is on screen. Call AFTER UI actions to verify.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_system_info',
      description: 'Get system info: CPU, RAM, disk, battery, OS version.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'type_text',
      description: 'Type text into the currently focused window. ALWAYS use focus_window FIRST. After typing, use take_screenshot to verify.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to type (just the content, NOT the app name)' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'press_keys',
      description: 'Press keyboard shortcut. Examples: ["control","s"] for save, ["enter"] to submit, ["alt","tab"] to switch.',
      parameters: {
        type: 'object',
        properties: {
          keys: {
            type: 'array',
            items: { type: 'string' },
            description: 'Keys to press simultaneously. E.g. ["control","s"], ["alt","tab"], ["enter"]',
          },
        },
        required: ['keys'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'focus_window',
      description: 'Bring a window to foreground by title. Use BEFORE type_text or click_at.',
      parameters: {
        type: 'object',
        properties: {
          window_title: { type: 'string', description: 'Title or partial title of window. E.g. "Notepad", "Chrome", "Antigravity"' },
        },
        required: ['window_title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click_at',
      description: 'Click mouse at screen coordinates (x, y). Use take_screenshot first to see where to click.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'string', description: 'X coordinate (pixels from left)' },
          y: { type: 'string', description: 'Y coordinate (pixels from top)' },
          button: { type: 'string', description: 'Mouse button: "left" (default), "right", "double"' },
        },
        required: ['x', 'y'],
      },
    },
  },
];

// ---- JARVIS System Prompt ----
const SYSTEM_PROMPT = `You are JARVIS — the user's remote operator. You sit at their Windows PC and operate it exactly like a human would. You have eyes (screenshots), hands (keyboard + mouse), and a brain (you). The user commands you from their phone while away from the PC.

YOU ARE NOT A CHATBOT. You are a human-like agent who:
- SEES the screen (a screenshot is attached with every message)
- OPERATES apps by clicking, typing, pressing shortcuts
- READS what's on screen — errors, status bars, notifications, code output
- THINKS about what to do next based on what you see
- ASKS QUESTIONS before acting if anything is unclear

═══════════════════════════════════════════════
CRITICAL: THE 3-PHASE WORKFLOW
═══════════════════════════════════════════════

EVERY task follows this flow. NO EXCEPTIONS:

PHASE 1 — CLARIFY (ask questions)
Before doing ANYTHING, look at the screen and think:
- Is there anything ambiguous about this request?
- Do I need to know which profile/account/window/folder?
- Would a human assistant ask a question before starting?
If YES → ask your questions. DO NOT USE ANY TOOLS YET.
If everything is crystal clear → skip to Phase 2.

PHASE 2 — PLAN (show steps, wait for confirmation)
Present a clear numbered plan of exactly what you will do:
"Here's my plan:
1. Open Chrome
2. Navigate to web.whatsapp.com
3. Find the chat with Utkarsha
4. Type the message: I will be late
5. Send the message

Ready to execute? Say 'go' to confirm."

DO NOT USE ANY TOOLS YET. Wait for the user to confirm.

PHASE 3 — EXECUTE (only after user says go/yes/do it/confirm)
When the user confirms (says "go", "yes", "do it", "confirm", "execute", "start", "proceed", etc.):
- Execute the plan step by step
- Take screenshots to verify each step
- Report what you see after each major action
- If something unexpected happens, STOP and ask the user

═══════════════════════════════════════════════
WHEN TO SKIP CLARIFY (Phase 1)
═══════════════════════════════════════════════

Skip Phase 1 ONLY for these simple/obvious tasks:
- "What's on my screen?" → just describe (no plan needed either)
- "What time is it?" → just answer
- "Take a screenshot" → just do it
- Any question that just needs info, not action

For EVERYTHING that requires action, always do Phase 2 (plan + confirm).

═══════════════════════════════════════════════
HOW TO INTERACT WITH APPS
═══════════════════════════════════════════════

CODING IDEs:
- **Antigravity**: Electron IDE. Chat input at bottom. Focus window → click chat input → type → Enter
- **VS Code / Cursor / Windsurf**: Chat panels on side. Use Ctrl+L or Ctrl+Shift+I to open chat
- **Terminal**: For running commands (npm run dev, git push)

GENERAL APPS:
- **Chrome**: Use run_powershell to open URLs, or focus + click
- **WhatsApp/Telegram**: Navigate via Chrome to web versions
- **Any app**: Focus window → navigate with clicks/keyboard

ERROR HANDLING:
- If you see an error on screen → READ it and explain to the user
- If an IDE hits rate limits → inform user and suggest alternatives
- If a build fails → read the error and explain simply
- If something unexpected happens → STOP executing, take a screenshot, ask the user

RESPONSE FORMAT:
- Start with what you SEE on screen
- Be conversational — you're a coworker, not a robot
- Keep plans clean and numbered
- Always end Phase 2 with a clear "Ready to execute?" or similar`;


// ---- Provider Configuration ----
let apiKey = null;
let apiBase = null;
let modelId = null;
let providerName = null;
const conversationHistories = new Map(); // deviceId -> messages[]

/**
 * Initialize the AI client
 * Supports multiple providers via OpenAI-compatible API format
 */
function initAI(config) {
  // Support legacy single key format
  if (typeof config === 'string') {
    config = { apiKey: config };
  }

  if (!config || !config.apiKey) {
    console.log('⚠️  No AI API key found — JARVIS brain disabled.');
    return false;
  }

  apiKey = config.apiKey;

  // Fallback models to try if primary is rate-limited (OpenRouter only)
  const FALLBACK_MODELS = [
    'nvidia/nemotron-3-super-120b-a12b:free',
    'deepseek/deepseek-v4-flash:free',
    'google/gemma-4-31b-it:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'qwen/qwen3-coder:free',
  ];

  // Auto-detect provider from key prefix or explicit config
  if (config.provider === 'gemini' || apiKey.startsWith('AIza')) {
    // Google Gemini — most generous free tier (15 RPM, 1500 req/day for Flash)
    apiBase = 'https://generativelanguage.googleapis.com/v1beta/openai';
    modelId = config.model || 'gemini-2.0-flash';
    providerName = 'Gemini';
  } else if (config.provider === 'groq' || apiKey.startsWith('gsk_')) {
    apiBase = 'https://api.groq.com/openai/v1';
    modelId = config.model || 'llama-3.3-70b-versatile';
    providerName = 'Groq';
  } else if (config.provider === 'openrouter' || apiKey.startsWith('sk-or-')) {
    apiBase = 'https://openrouter.ai/api/v1';
    modelId = config.model || FALLBACK_MODELS[0];
    providerName = 'OpenRouter';
  } else if (config.provider === 'deepseek' || apiKey.startsWith('sk-ds')) {
    apiBase = 'https://api.deepseek.com/v1';
    modelId = config.model || 'deepseek-chat';
    providerName = 'DeepSeek';
  } else {
    apiBase = config.apiBase || 'https://openrouter.ai/api/v1';
    modelId = config.model || FALLBACK_MODELS[0];
    providerName = config.provider || 'OpenRouter';
  }

  console.log(`🧠 JARVIS brain initialized (${providerName} → ${modelId})`);
  if (providerName === 'OpenRouter') {
    console.log(`   📋 Fallback models: ${FALLBACK_MODELS.slice(1).join(', ')}`);
  }
  if (providerName === 'Gemini') {
    console.log(`   ✨ Using Google Gemini — generous free tier (15 RPM, 1500 req/day)`);
  }
  return true;
}

/**
 * Make a chat completion request to the provider
 */
async function chatCompletion(messages, tools = null) {
  const body = {
    model: modelId,
    messages,
    temperature: 0.4,
    max_tokens: 4096,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  // OpenRouter-specific headers
  if (providerName === 'OpenRouter') {
    headers['HTTP-Referer'] = 'https://remoteforge.app';
    headers['X-Title'] = 'RemoteForge JARVIS';
  }

  const response = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${errText}`);
  }

  return await response.json();
}

/**
 * Process a user message through JARVIS
 * Returns: { text: string, screenshot_base64?: string }
 */
async function processWithJarvis(userMessage, deviceId, toolExecutor, isCancelled) {
  if (!apiKey) {
    return { text: "I'm currently running in basic mode. Please add an API key to enable full JARVIS capabilities." };
  }

  // Get or create conversation history
  if (!conversationHistories.has(deviceId)) {
    conversationHistories.set(deviceId, []);
  }
  const history = conversationHistories.get(deviceId);

  // Keep last 20 messages for context
  if (history.length > 40) {
    history.splice(0, history.length - 20);
  }

  try {
    console.log('   🧠 Sending to AI...');

    // Build the conversation — no pre-screenshot for speed
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: userMessage },
    ];

    let result = await sendWithRetry(messages, TOOLS);
    let screenshotBase64 = null;

    // Function calling loop
    const UI_TOOLS = new Set(['focus_window', 'type_text', 'press_keys', 'click_at']);
    let maxIterations = 15;

    while (maxIterations-- > 0) {
      const choice = result.choices?.[0];
      if (!choice) break;

      // Check if command was cancelled/aborted
      if (isCancelled && await isCancelled()) {
        console.log('   ⏹ Command aborted by user');
        return { text: '', cancelled: true };
      }

      const msg = choice.message;
      
      // Check if AI wants to call tools
      if (!msg.tool_calls || msg.tool_calls.length === 0) break;

      // Add assistant's tool_calls message to conversation
      messages.push(msg);

      let didUIAction = false;

      // Execute each tool call
      for (const toolCall of msg.tool_calls) {
        const fnName = toolCall.function.name;
        let args = {};
        try {
          args = JSON.parse(toolCall.function.arguments || '{}');
        } catch (e) {
          args = {};
        }

        console.log(`   🔧 JARVIS calling: ${fnName}(${JSON.stringify(args).slice(0, 80)})`);

        let toolResult;
        try {
          toolResult = await toolExecutor(fnName, args);
          if (fnName === 'take_screenshot' && toolResult.screenshot_base64) {
            screenshotBase64 = toolResult.screenshot_base64;
            toolResult = { success: true, message: 'Screenshot captured successfully. The screen shows the current state of the PC.' };
          }
          if (UI_TOOLS.has(fnName)) didUIAction = true;
        } catch (err) {
          toolResult = { success: false, error: err.message };
        }

        // Add tool result to conversation
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }

      // Visual feedback: after UI actions, auto-capture
      if (didUIAction) {
        try {
          await new Promise(r => setTimeout(r, 400));
          const verifyShot = await toolExecutor('take_screenshot', {});
          if (verifyShot.success && verifyShot.screenshot_base64) {
            screenshotBase64 = verifyShot.screenshot_base64;
            console.log('   👁️ Post-action screenshot captured');
          }
        } catch (e) {
          // Non-critical
        }
      }

      // Send results back to AI for next step
      result = await sendWithRetry(messages, TOOLS);
    }

    // Extract final text response
    const text = result.choices?.[0]?.message?.content || 'Done.';

    // Update conversation history (keep it lean)
    history.push({ role: 'user', content: userMessage });
    history.push({ role: 'assistant', content: text });

    return { text, screenshot_base64: screenshotBase64 };

  } catch (err) {
    console.error('🧠 JARVIS error:', err.message);

    if (err.message.includes('429') || err.message.includes('rate')) {
      return { text: "I'm a bit overloaded right now. Please wait a moment and try again. (Rate limit reached)" };
    }

    return { text: `I encountered an issue: ${err.message}. Try rephrasing your request.` };
  }
}

/**
 * Send with retry + smart model fallback for rate limits
 */
const FALLBACK_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'deepseek/deepseek-v4-flash:free',
  'google/gemma-4-31b-it:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-coder:free',
];

async function sendWithRetry(messages, tools, maxRetries = 3) {
  const originalModel = modelId;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await chatCompletion(messages, tools);
      return result;
    } catch (err) {
      const isRateLimit = err.message.includes('429') || err.message.includes('rate');
      
      if (isRateLimit && providerName === 'OpenRouter' && attempt < maxRetries - 1) {
        // Try next fallback model
        const currentIdx = FALLBACK_MODELS.indexOf(modelId);
        const nextIdx = (currentIdx + 1) % FALLBACK_MODELS.length;
        if (nextIdx !== 0 || currentIdx === -1) {
          modelId = FALLBACK_MODELS[nextIdx === 0 ? 1 : nextIdx];
          console.log(`   🔄 Switching to fallback: ${modelId}`);
        } else {
          const wait = (attempt + 1) * 3000;
          console.log(`   ⏳ All models rate-limited, waiting ${wait / 1000}s...`);
          await new Promise(r => setTimeout(r, wait));
          modelId = FALLBACK_MODELS[0]; // Reset to primary
        }
      } else if (isRateLimit && attempt < maxRetries - 1) {
        const wait = (attempt + 1) * 3000;
        console.log(`   ⏳ Rate limited, waiting ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        modelId = originalModel; // Restore original
        throw err;
      }
    }
  }
  modelId = originalModel; // Restore original
}

/**
 * Clear conversation history
 */
function clearHistory(deviceId) {
  conversationHistories.delete(deviceId);
}

module.exports = { initAI, processWithJarvis, clearHistory };
