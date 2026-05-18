# RemoteForge 🔥

**Control your PC from anywhere using natural language.**

RemoteForge is an AI-powered remote PC control system. Send chat commands from your phone, and your PC executes them instantly.

## Architecture

```
📱 Phone App (React + Capacitor)
    ↓ sends commands
☁️ Supabase (Auth + Realtime + Database)
    ↓ relays to
💻 PC Agent (Node.js + Gemini AI)
    ↓ executes
⚡ Windows (PowerShell, Apps, Screenshots)
```

## Projects

| Folder | Description |
|---|---|
| `remoteforge-agent/` | Desktop agent that runs on your PC |
| `remoteforge-mobile/` | Mobile chat interface (React + Vite) |

## Features

- 🧠 **AI-Powered** — Gemini interprets natural language into executable commands
- 📱 **Mobile Chat UI** — Send commands from your phone
- 🔒 **Secure** — Supabase Auth + Row Level Security + destructive command confirmation
- 📸 **Screenshots** — Capture and view your PC screen remotely
- 💻 **System Info** — Monitor CPU, RAM, disk, battery
- 🔄 **Real-time** — Instant WebSocket communication
- 🛡️ **Safety** — Destructive commands require phone confirmation

## Setup

### PC Agent
```bash
cd remoteforge-agent
npm install
# Edit .env with your Supabase + Gemini keys
npm run setup   # First-time login
npm start       # Start the agent
```

### Mobile App
```bash
cd remoteforge-mobile
npm install
npm run dev     # Start dev server
```

## License
MIT
