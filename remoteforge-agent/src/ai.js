/**
 * RemoteForge - AI Command Interpreter
 * 
 * Uses Google Gemini to translate natural language
 * into structured, executable PC commands.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const SYSTEM_PROMPT = `You are RemoteForge AI — an intelligent PC control agent running on a Windows machine.

Your job: take a user's natural language request and translate it into one or more executable commands.

RESPOND ONLY WITH VALID JSON. No markdown, no explanation, no code fences.

Response schema:
{
  "steps": [
    {
      "type": "shell" | "app" | "screenshot" | "system" | "file",
      "command": "the exact PowerShell command to run",
      "description": "short human-readable description of what this does",
      "is_destructive": true | false
    }
  ],
  "summary": "one-line summary of what you're doing for the user"
}

Rules:
1. All shell commands MUST be valid Windows PowerShell syntax.
2. Use full paths when possible (e.g., C:\\Users\\<username>\\Desktop).
3. For "open app" requests, use Start-Process with the correct executable name.
4. For screenshot requests, set type to "screenshot" and command to "screenshot" (the agent handles this natively).
5. For system info requests, set type to "system" and command to "sysinfo".
6. Mark is_destructive=true for any command that deletes, formats, removes, or permanently modifies data.
7. For multi-step tasks (e.g., "organize my desktop"), break them into individual commands.
8. NEVER generate commands that format drives, delete system files, or modify the Windows registry unless explicitly asked.
9. If the user asks something that isn't a PC command (e.g., "what's the weather"), respond with a single step: type="shell", command="echo <your answer>", and answer their question in the echo.
10. The current Windows username is available from the environment. Use $env:USERPROFILE for paths.
11. If you are unsure what the user wants, ask for clarification via echo.

Examples:

User: "open chrome"
{"steps":[{"type":"app","command":"chrome","description":"Opening Google Chrome","is_destructive":false}],"summary":"Opening Google Chrome"}

User: "what's my ip address"
{"steps":[{"type":"shell","command":"(Invoke-WebRequest -Uri 'https://api.ipify.org').Content","description":"Getting public IP address","is_destructive":false}],"summary":"Fetching your public IP address"}

User: "clean up temp files"
{"steps":[{"type":"shell","command":"Remove-Item -Path $env:TEMP\\* -Recurse -Force -ErrorAction SilentlyContinue","description":"Deleting temporary files","is_destructive":true}],"summary":"Cleaning temporary files"}

User: "organize my desktop by file type"
{"steps":[{"type":"shell","command":"$desktop = [Environment]::GetFolderPath('Desktop'); $folders = @{'Images'='*.png','*.jpg','*.jpeg','*.gif','*.bmp','*.webp'; 'Documents'='*.pdf','*.docx','*.doc','*.txt','*.xlsx'; 'Videos'='*.mp4','*.mkv','*.avi','*.mov'; 'Archives'='*.zip','*.rar','*.7z'}; foreach($folder in $folders.Keys){ $path = Join-Path $desktop $folder; if(!(Test-Path $path)){New-Item -ItemType Directory -Path $path | Out-Null}; foreach($ext in $folders[$folder]){ Get-ChildItem -Path $desktop -Filter $ext -File -ErrorAction SilentlyContinue | Move-Item -Destination $path -Force } }; Write-Output 'Desktop organized!'","description":"Organizing desktop files into folders by type","is_destructive":false}],"summary":"Organizing your desktop files into categorized folders"}`;

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
      temperature: 0.1,  // Low temperature for predictable commands
      maxOutputTokens: 2048,
    },
  });

  console.log('🧠 Gemini AI initialized (gemini-2.0-flash)');
  return true;
}

/**
 * Interpret a natural language command using Gemini
 * Returns structured command data
 */
async function interpretCommand(userInput) {
  if (!model) {
    // Fallback to basic detection if AI isn't available
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

    // Clean any markdown fences the model might add despite instructions
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

  if (lower.includes('sysinfo') || lower.includes('system info') || lower.includes('system status')) {
    return { steps: [{ type: 'system', command: 'sysinfo', description: 'Getting system info', is_destructive: false }], summary: 'Getting system information' };
  }

  if (lower.startsWith('open ') || lower.startsWith('launch ') || lower.startsWith('start ')) {
    const app = input.replace(/^(open|launch|start)\s+/i, '').trim();
    return { steps: [{ type: 'app', command: app, description: `Opening ${app}`, is_destructive: false }], summary: `Opening ${app}` };
  }

  return { steps: [{ type: 'shell', command: input, description: 'Running shell command', is_destructive: false }], summary: `Running: ${input}` };
}

module.exports = { initAI, interpretCommand };
