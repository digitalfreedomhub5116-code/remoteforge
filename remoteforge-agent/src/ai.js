/**
 * RemoteForge — JARVIS AI Brain
 * 
 * Uses Gemini 2.5 Flash with Function Calling (tool use)
 * to create a true conversational PC control agent.
 * 
 * The AI decides when to run commands, interprets results,
 * retries on failure, and responds in natural language.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

// ---- Tool Definitions (what JARVIS can do) ----
const TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'run_powershell',
        description: 'Execute a PowerShell command on the Windows PC. Use this for any system operation: file management, network info, process control, installations, etc. Always use valid PowerShell syntax.',
        parameters: {
          type: 'OBJECT',
          properties: {
            command: { type: 'STRING', description: 'The PowerShell command to execute' },
          },
          required: ['command'],
        },
      },
      {
        name: 'open_application',
        description: 'Open/launch an application by name. Examples: chrome, notepad, vscode, discord, spotify, calculator, explorer, edge',
        parameters: {
          type: 'OBJECT',
          properties: {
            app_name: { type: 'STRING', description: 'Name of the app to open' },
          },
          required: ['app_name'],
        },
      },
      {
        name: 'take_screenshot',
        description: 'Capture a screenshot of the current screen. Use when the user wants to see what is on their screen or verify something visually.',
        parameters: {
          type: 'OBJECT',
          properties: {},
        },
      },
      {
        name: 'get_system_info',
        description: 'Get detailed system information: CPU usage, RAM, disk space, battery level, OS version.',
        parameters: {
          type: 'OBJECT',
          properties: {},
        },
      },
      {
        name: 'type_text',
        description: 'Type text using the keyboard. The text will be typed into whatever window is currently focused. Use focus_window first to target a specific app.',
        parameters: {
          type: 'OBJECT',
          properties: {
            text: { type: 'STRING', description: 'The text to type' },
          },
          required: ['text'],
        },
      },
      {
        name: 'press_keys',
        description: 'Press a keyboard shortcut or key combination. Use for hotkeys like Ctrl+S, Ctrl+C, Alt+Tab, Enter, etc.',
        parameters: {
          type: 'OBJECT',
          properties: {
            keys: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: 'Array of keys to press simultaneously. Examples: ["control","s"], ["alt","tab"], ["enter"]',
            },
          },
          required: ['keys'],
        },
      },
      {
        name: 'focus_window',
        description: 'Bring a specific application window to the foreground. Use before type_text to ensure text goes to the right app.',
        parameters: {
          type: 'OBJECT',
          properties: {
            window_title: { type: 'STRING', description: 'The title or partial title of the window to focus' },
          },
          required: ['window_title'],
        },
      },
    ],
  },
];

// ---- JARVIS System Prompt ----
const SYSTEM_PROMPT = `You are JARVIS — an advanced AI assistant integrated into a Windows PC. You control this computer on behalf of your user, just like Tony Stark's JARVIS.

PERSONALITY:
- Professional but warm, like a trusted butler
- Concise and clear — no unnecessary rambling
- Confident — you handle tasks without hesitation
- Proactive — suggest next steps when helpful

CAPABILITIES:
You have direct control over this Windows PC through tools:
- Run any PowerShell command (file operations, network, processes, installations)
- Open and control applications
- Type text and press keyboard shortcuts in specific windows
- Take screenshots to verify your work
- Get system health information
- **VISION**: You can SEE the current screen! A screenshot is attached with each message. Use it to understand context.

CRITICAL — HOW TO HANDLE "TYPE IN [APP]" COMMANDS:
When the user says something like "type in notepad hello world" or "type in antigravity hello", they mean:
1. FIRST: Use focus_window to bring the target app to the foreground
2. THEN: Use type_text to type ONLY the text content (NOT the app name)

Examples:
- "type in notepad hello world" → focus_window("Notepad") + type_text("hello world")
- "type in antigravity run the dev server" → focus_window("Antigravity") + type_text("run the dev server")
- "type hello in chrome" → focus_window("Chrome") + type_text("hello")
- "write test123 in vscode" → focus_window("Visual Studio Code") + type_text("test123")

ALWAYS parse the command to separate the TARGET WINDOW from the TEXT TO TYPE. Never type the app name as part of the text.

KNOWN APPS AND THEIR WINDOW TITLES (use these for focus_window):
- "antigravity" → window title contains "Antigravity"
- "vscode" / "vs code" → window title contains "Visual Studio Code"
- "notepad" → window title contains "Notepad"
- "chrome" → window title contains "Chrome"
- "edge" → window title contains "Edge"
- "terminal" → window title contains "Terminal" or "PowerShell"
- Look at the screenshot to find the EXACT window title if unsure

BEHAVIOR RULES:
1. ALWAYS use tools to accomplish tasks — never just describe what you WOULD do
2. If a command fails, TRY A DIFFERENT APPROACH silently — don't show errors to the user
3. Interpret tool results and respond in plain English — NEVER show raw terminal output or error messages
4. If you need to run multiple commands, do them in sequence
5. For destructive operations (deleting files, formatting), WARN the user first
6. When showing file listings or data, format it nicely
7. If you're unsure what the user wants, ask a brief clarifying question
8. After completing a task, briefly confirm what you did AND which window you typed in
9. You can use $env:USERPROFILE for the user's home directory
10. USE THE SCREEN CONTEXT: Look at the attached screenshot to understand what apps are open, what the user is looking at, and what state the PC is in.

RESPONSE FORMAT:
- Keep responses SHORT (2-4 sentences for simple tasks)
- Use bullet points for lists
- Use bold for important info
- Don't use code blocks for responses — you're talking to a human, not a developer`;

let model = null;
const conversationHistories = new Map(); // deviceId -> chat history

/**
 * Initialize the Gemini AI client
 */
function initAI(apiKey) {
  if (!apiKey) {
    console.log('⚠️  No GEMINI_API_KEY found — JARVIS brain disabled.');
    return false;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    tools: TOOLS,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 4096,
    },
  });

  console.log('🧠 JARVIS brain initialized (Gemini 2.5 Flash + Function Calling)');
  return true;
}

/**
 * Process a user message through JARVIS
 * Returns: { text: string, screenshot_base64?: string }
 * 
 * This handles the full conversation loop:
 * User message → AI thinks → AI calls tools → Agent executes → 
 * Results fed back to AI → AI responds naturally
 */
async function processWithJarvis(userMessage, deviceId, toolExecutor) {
  if (!model) {
    return { text: "I'm currently running in basic mode. Please add a Gemini API key to enable full JARVIS capabilities." };
  }

  // Get or create conversation history for this device
  if (!conversationHistories.has(deviceId)) {
    conversationHistories.set(deviceId, []);
  }
  const history = conversationHistories.get(deviceId);

  // Keep last 20 messages for context (prevent token overflow)
  if (history.length > 40) {
    history.splice(0, history.length - 20);
  }

  try {
    // ---- VISION: Auto-capture screen before processing ----
    let screenContext = null;
    try {
      console.log('   👁️ Capturing screen context...');
      const ssResult = await toolExecutor('take_screenshot', {});
      if (ssResult.success && ssResult.screenshot_base64) {
        // Resize/compress for API efficiency (keep it under 1MB)
        screenContext = ssResult.screenshot_base64.slice(0, 500000);
        console.log('   👁️ Screen captured — JARVIS can see your screen');
      }
    } catch (e) {
      console.log('   👁️ Screen capture skipped:', e.message);
    }

    // Build the message with vision
    const messageParts = [];
    if (screenContext) {
      messageParts.push({
        inlineData: {
          mimeType: 'image/png',
          data: screenContext,
        },
      });
      messageParts.push({ text: `[Current screen is attached above]\n\nUser: ${userMessage}` });
    } else {
      messageParts.push({ text: userMessage });
    }

    // Start chat with history
    const chat = model.startChat({ history });

    let response = await sendWithRetry(chat, messageParts);
    let screenshotBase64 = null;

    // Function calling loop — AI may call multiple tools
    let maxIterations = 10; // Safety limit
    while (maxIterations-- > 0) {
      const candidate = response.response.candidates?.[0];
      if (!candidate) break;

      const parts = candidate.content?.parts || [];
      const functionCalls = parts.filter(p => p.functionCall);

      if (functionCalls.length === 0) break; // AI is done calling tools

      // Execute each function call
      const functionResponses = [];
      for (const part of functionCalls) {
        const { name, args } = part.functionCall;
        console.log(`   🔧 JARVIS calling: ${name}(${JSON.stringify(args).slice(0, 80)})`);

        let result;
        try {
          result = await toolExecutor(name, args);
          // Capture screenshots
          if (name === 'take_screenshot' && result.screenshot_base64) {
            screenshotBase64 = result.screenshot_base64;
          }
        } catch (err) {
          result = { success: false, error: err.message };
        }

        functionResponses.push({
          functionResponse: {
            name,
            response: result,
          },
        });
      }

      // Send tool results back to AI for interpretation
      response = await sendWithRetry(chat, functionResponses);
    }

    // Extract the final text response
    const text = response.response.text() || "Done.";

    // Update conversation history (text only, no images for history to save tokens)
    history.push({ role: 'user', parts: [{ text: userMessage }] });
    history.push({ role: 'model', parts: [{ text }] });

    return { text, screenshot_base64: screenshotBase64 };

  } catch (err) {
    console.error('🧠 JARVIS error:', err.message);

    // Graceful fallback
    if (err.message.includes('429') || err.message.includes('Resource exhausted')) {
      return { text: "I'm a bit overloaded right now. Please wait a moment and try again. (Rate limit reached)" };
    }

    return { text: `I encountered an issue: ${err.message}. Try rephrasing your request.` };
  }
}

/**
 * Send message with retry logic for rate limits
 */
async function sendWithRetry(chat, message, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await chat.sendMessage(message);
    } catch (err) {
      if (err.message.includes('429') && attempt < maxRetries - 1) {
        const wait = (attempt + 1) * 2000; // 2s, 4s, 6s
        console.log(`   ⏳ Rate limited, waiting ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
}

/**
 * Clear conversation history for a device
 */
function clearHistory(deviceId) {
  conversationHistories.delete(deviceId);
}

module.exports = { initAI, processWithJarvis, clearHistory };
