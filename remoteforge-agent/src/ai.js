/**
 * RemoteForge - AI Command Interpreter
 * 
 * Uses Google Gemini to translate natural language
 * into structured, executable PC commands.
 * Now supports keyboard/mouse control!
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const SYSTEM_PROMPT = `You are RemoteForge AI — an intelligent PC control agent running on a Windows machine.

Your job: take a user's natural language request and translate it into one or more executable commands.

RESPOND ONLY WITH VALID JSON. No markdown, no explanation, no code fences.

Response schema:
{
  "steps": [
    {
      "type": "shell" | "app" | "screenshot" | "system" | "keyboard",
      "command": "the command string (see type-specific format below)",
      "description": "short human-readable description",
      "is_destructive": true | false
    }
  ],
  "summary": "one-line summary of what you're doing for the user"
}

Available command types:
- "shell": Run a PowerShell command. command = the exact PowerShell command.
- "app": Open an application. command = the app name (e.g., "chrome", "notepad").
- "screenshot": Capture the screen. command = "screenshot".
- "system": Get CPU/RAM/disk info. command = "sysinfo".
- "keyboard": Control keyboard input. command = JSON string with one of these actions:
    Type text: {"action":"type","text":"hello world"}
    Press hotkey: {"action":"hotkey","keys":["control","s"]}
    Press single key: {"action":"key","key":"enter"}

KEYBOARD RULES:
- To type text into a specific app, FIRST use a "shell" step to focus that window using PowerShell:
  (New-Object -ComObject WScript.Shell).AppActivate('Window Title')
- THEN use a "keyboard" step to type the text.
- For hotkeys, valid key names: control, alt, shift, enter, tab, escape, backspace, delete, up, down, left, right, f1-f12, a-z, 0-9
- Always focus the target window before typing!

GENERAL RULES:
1. All shell commands MUST be valid Windows PowerShell syntax.
2. Use $env:USERPROFILE for user paths.
3. For "open app" requests, use type "app" with the app name.
4. For screenshot requests, set type to "screenshot".
5. For system info requests, set type to "system".
6. Mark is_destructive=true for anything that deletes, formats, or permanently modifies data.
7. For multi-step tasks, break them into individual steps.
8. NEVER generate commands that format drives, delete system files, or modify the registry unless explicitly asked.
9. If the user asks a non-PC question (e.g., "what's the weather"), answer via: type="shell", command="echo Your answer here".
10. If unsure, ask for clarification via echo.

Examples:

User: "open chrome"
{"steps":[{"type":"app","command":"chrome","description":"Opening Google Chrome","is_destructive":false}],"summary":"Opening Google Chrome"}

User: "what's my ip address"
{"steps":[{"type":"shell","command":"(Invoke-WebRequest -Uri 'https://api.ipify.org').Content","description":"Getting public IP address","is_destructive":false}],"summary":"Fetching your public IP address"}

User: "type hello in notepad"
{"steps":[{"type":"shell","command":"(New-Object -ComObject WScript.Shell).AppActivate('Notepad')","description":"Focusing Notepad window","is_destructive":false},{"type":"keyboard","command":"{\\"action\\":\\"type\\",\\"text\\":\\"hello\\"}","description":"Typing hello into Notepad","is_destructive":false}],"summary":"Typing 'hello' in Notepad"}

User: "press ctrl+s"
{"steps":[{"type":"keyboard","command":"{\\"action\\":\\"hotkey\\",\\"keys\\":[\\"control\\",\\"s\\"]}","description":"Pressing Ctrl+S to save","is_destructive":false}],"summary":"Pressing Ctrl+S"}

User: "clean up temp files"  
{"steps":[{"type":"shell","command":"Remove-Item -Path $env:TEMP\\\\* -Recurse -Force -ErrorAction SilentlyContinue","description":"Deleting temporary files","is_destructive":true}],"summary":"Cleaning temporary files"}`;

let ai = null;
let model = null;

/**
 * Initialize the Gemini AI client
 */
function initAI(apiKey) {
  if (!apiKey) {
    console.log('⚠️  No GEMINI_API_KEY found. AI interpreter disabled — using basic pattern matching.');
    return false;
  }

  ai = new GoogleGenerativeAI(apiKey);
  model = ai.getGenerativeModel({ 
    model: 'gemini-2.0-flash',
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
    },
  });

  console.log('🧠 Gemini AI initialized (gemini-2.0-flash)');
  return true;
}

/**
 * Interpret a natural language command using Gemini
 */
async function interpretCommand(userInput) {
  if (!model) {
    return fallbackInterpret(userInput);
  }

  try {
    const chat = model.startChat({
      history: [
        { role: 'user', parts: [{ text: SYSTEM_PROMPT }] },
        { role: 'model', parts: [{ text: '{"acknowledged": true}' }] },
      ],
    });

    const result = await chat.sendMessage(userInput);
    const text = result.response.text().trim();

    // Clean any markdown fences
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);

    if (!parsed.steps || !Array.isArray(parsed.steps)) {
      throw new Error('Invalid AI response: missing steps array');
    }

    return parsed;
  } catch (err) {
    console.error('🧠 AI interpretation failed:', err.message);
    console.log('   Falling back to basic detection...');
    return fallbackInterpret(userInput);
  }
}

/**
 * Fallback: basic pattern matching when AI is unavailable
 */
function fallbackInterpret(input) {
  const lower = input.toLowerCase().trim();

  if (lower.includes('screenshot') || lower === 'ss') {
    return { steps: [{ type: 'screenshot', command: 'screenshot', description: 'Taking screenshot', is_destructive: false }], summary: 'Taking a screenshot' };
  }
  if (lower.includes('sysinfo') || lower.includes('system info')) {
    return { steps: [{ type: 'system', command: 'sysinfo', description: 'Getting system info', is_destructive: false }], summary: 'Getting system information' };
  }
  if (/^(open|launch|start)\s+/i.test(lower)) {
    const app = input.replace(/^(open|launch|start)\s+/i, '').trim();
    return { steps: [{ type: 'app', command: app, description: `Opening ${app}`, is_destructive: false }], summary: `Opening ${app}` };
  }

  return { steps: [{ type: 'shell', command: input, description: 'Running shell command', is_destructive: false }], summary: `Running: ${input}` };
}

module.exports = { initAI, interpretCommand };
