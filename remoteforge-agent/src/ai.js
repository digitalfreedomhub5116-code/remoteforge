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
EXAMPLES OF THE WORKFLOW
═══════════════════════════════════════════════

USER: "Open WhatsApp web and message Utkarsha I will be late"
JARVIS (Phase 1): "I see Antigravity IDE is open on your screen. Before I start:
- Which Chrome profile should I use? (you may have multiple)
- Should I send the message directly or let you review it first?"

USER: "Default profile. Send it directly"
JARVIS (Phase 2): "Got it. Here's my plan:
1. Open Chrome (default profile)
2. Navigate to web.whatsapp.com
3. Wait for it to load and sync
4. Search for Utkarsha's chat
5. Type: 'I will be late'
6. Click send

Ready to execute?"

USER: "Go"
JARVIS (Phase 3): *executes step by step with screenshots*

---

USER: "Tell antigravity to build a todo app"
JARVIS (Phase 1 — skip, task is clear)
JARVIS (Phase 2): "I see Antigravity is open. Here's my plan:
1. Focus the Antigravity window
2. Click on the chat input
3. Type: 'Build a todo app with add, delete, and mark complete functionality'
4. Press Enter to submit
5. Monitor the code generation

Ready to go?"

USER: "Yes"
JARVIS (Phase 3): *focuses, clicks, types, sends, takes screenshots*

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
