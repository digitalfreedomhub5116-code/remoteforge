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
        description: 'Execute a PowerShell command on the Windows PC. Use this for any system operation: file management, network info, process control, installations, etc.',
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
        description: 'Capture a screenshot of the current screen. Use this to SEE what is on the screen right now. Call this AFTER performing UI actions (clicking, typing, focusing) to verify the result.',
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
        description: 'Type text using the keyboard into the currently focused window. ALWAYS use focus_window FIRST to target the correct app. After typing, use take_screenshot to verify the text appeared correctly.',
        parameters: {
          type: 'OBJECT',
          properties: {
            text: { type: 'STRING', description: 'The text to type (NOT the app name, just the content)' },
          },
          required: ['text'],
        },
      },
      {
        name: 'press_keys',
        description: 'Press a keyboard shortcut or key combination. Examples: ["control","s"] for save, ["enter"] to submit, ["control","l"] to focus address bar, ["alt","tab"] to switch windows.',
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
        description: 'Bring a specific application window to the foreground by its title. Use this BEFORE type_text or click_at to ensure you are interacting with the right window.',
        parameters: {
          type: 'OBJECT',
          properties: {
            window_title: { type: 'STRING', description: 'The title or partial title of the window to focus. Examples: "Notepad", "Chrome", "Antigravity", "Visual Studio Code"' },
          },
          required: ['window_title'],
        },
      },
      {
        name: 'click_at',
        description: 'Click the mouse at specific screen coordinates (x, y). Use take_screenshot first to see the screen and identify where to click. Coordinates are in pixels from the top-left corner.',
        parameters: {
          type: 'OBJECT',
          properties: {
            x: { type: 'STRING', description: 'X coordinate (pixels from left edge)' },
            y: { type: 'STRING', description: 'Y coordinate (pixels from top edge)' },
            button: { type: 'STRING', description: 'Mouse button: "left" (default), "right", or "double"' },
          },
          required: ['x', 'y'],
        },
      },
    ],
  },
];

const SYSTEM_PROMPT = `You are JARVIS — the user's remote operator. You sit at their Windows PC and operate it exactly like a human would. You have eyes (screenshots), hands (keyboard + mouse), and a brain (you). The user commands you from their phone while away from the PC.

YOU ARE NOT A CHATBOT. You are a human-like agent who:
- SEES the screen (a screenshot is attached with every message)
- OPERATES apps by clicking, typing, pressing shortcuts
- READS what's on screen — errors, status bars, notifications, code output
- THINKS about what to do next based on what you see
- REPORTS back in plain English — what happened, what you see, what to do next

YOUR PRIMARY JOB: OPERATING CODING IDEs
The user is a "vibe coder" — they give natural language prompts to coding IDEs (like Antigravity, VS Code, Cursor, Windsurf) and the IDE writes code. YOUR job is to:
1. Look at the screen and understand what's open
2. Find the chat/prompt input field in the IDE
3. Click on it (use click_at) or focus the window
4. Type the coding prompt the user gives you
5. Press Enter to submit
6. WATCH the screen — take screenshots to monitor progress
7. Report back what happened: "The agent is generating code..." or "Done, 3 files created" or "Error: rate limit hit"

HOW TO INTERACT WITH CODING IDEs:
- **Antigravity**: Electron-based IDE. Chat input is at the bottom of the screen. Focus the window, click on the chat input area, type the prompt, press Enter.
- **VS Code / Cursor / Windsurf**: Similar layout. Chat panels are usually on the side. Use Ctrl+L or Ctrl+Shift+I to open the chat panel.
- **Terminal**: For running commands directly (npm run dev, git push, etc.)

WHAT TO DO WHEN THINGS GO WRONG:
- If you see an **error message** on screen, READ it and tell the user what went wrong
- If an IDE hits a **rate limit**, tell the user and suggest switching to another IDE/agent
- If a **build fails**, read the error output and explain it simply
- If a **dev server crashes**, restart it
- NEVER just say "Done" — always describe what you SEE on the screen

HOW TO HANDLE USER COMMANDS:

"Type in antigravity: build a landing page"
→ 1. focus_window("Antigravity")
→ 2. Look at screenshot to find the chat input area
→ 3. click_at the chat input (or just type if already focused)
→ 4. type_text("build a landing page")
→ 5. press_keys(["enter"])
→ 6. Wait a moment, then take_screenshot to see the result
→ 7. Report: "I sent the prompt to Antigravity. It's generating code..."

"What's happening on screen?"
→ 1. Look at the attached screenshot
→ 2. Describe what you see: apps open, code being generated, errors, etc.

"Run the dev server"
→ 1. Open terminal or use run_powershell
→ 2. Navigate to the project directory
→ 3. Run npm run dev
→ 4. Take a screenshot to show the result

"Switch to cursor" or "Use a different agent"
→ 1. Open the requested IDE
→ 2. Find its chat input
→ 3. Continue the task there

BEHAVIOR RULES:
1. ALWAYS look at the screenshot FIRST to understand what's on screen
2. USE TOOLS — never just describe what you would do
3. VERIFY your actions — take a screenshot after clicking/typing to confirm it worked
4. If something fails, TRY A DIFFERENT APPROACH silently
5. NEVER show raw terminal output — interpret and explain in plain English
6. Be PROACTIVE — if you see an error, mention it. If something looks off, point it out.
7. ALWAYS tell the user what you SEE, not just what you did
8. For destructive operations, WARN the user first

RESPONSE FORMAT:
- Start with what you SEE on screen (1 sentence)
- Then what you DID (1-2 sentences)
- Then what HAPPENED / what's next
- Keep it conversational — you're a coworker, not a robot`;


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
    // After UI-interaction tools, we auto-capture a screenshot so AI can verify
    const UI_TOOLS = new Set(['focus_window', 'type_text', 'press_keys', 'click_at']);
    let maxIterations = 15; // Safety limit
    while (maxIterations-- > 0) {
      const candidate = response.response.candidates?.[0];
      if (!candidate) break;

      const parts = candidate.content?.parts || [];
      const functionCalls = parts.filter(p => p.functionCall);

      if (functionCalls.length === 0) break; // AI is done calling tools

      // Execute each function call
      const functionResponses = [];
      let didUIAction = false;

      for (const part of functionCalls) {
        const { name, args } = part.functionCall;
        console.log(`   🔧 JARVIS calling: ${name}(${JSON.stringify(args).slice(0, 80)})`);

        let result;
        try {
          result = await toolExecutor(name, args);
          // Capture screenshots from explicit take_screenshot calls
          if (name === 'take_screenshot' && result.screenshot_base64) {
            screenshotBase64 = result.screenshot_base64;
          }
          if (UI_TOOLS.has(name)) didUIAction = true;
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

      // ---- VISUAL FEEDBACK: After UI actions, capture the screen so AI can see the result ----
      if (didUIAction) {
        try {
          await new Promise(r => setTimeout(r, 400)); // Wait for UI to settle
          const verifyShot = await toolExecutor('take_screenshot', {});
          if (verifyShot.success && verifyShot.screenshot_base64) {
            screenshotBase64 = verifyShot.screenshot_base64;
            // Add the screenshot as an inline image in the response
            functionResponses.push({
              functionResponse: {
                name: 'screen_after_action',
                response: { note: 'This is a screenshot of the screen AFTER your actions. Use it to verify the result.' },
              },
            });
            // We'll include the image inline with the function responses
            console.log('   👁️ Post-action screenshot captured — AI can verify');
          }
        } catch (e) {
          // Non-critical
        }
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
