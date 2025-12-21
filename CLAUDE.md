# Project Instructions for Claude

## Git Rules
- NEVER push to git without asking me first
- Always ask "Push kar dun?" before pushing

## Language Preference
- NEVER use Hindi script (Devanagari/देवनागरी) - this is strictly prohibited
- ALWAYS use Hinglish (Hindi words written in English/Roman script)
- Example: "Ye feature add kar diya" NOT "यह फीचर ऐड कर दिया"
- Keep responses casual and natural

## Project Info
- TTS (Text-to-Speech) web application
- Next.js frontend with Python backend workers
- File server runs on port 8000
- Webapp runs on port 3000 via PM2 (process name: "tts")
- F5-TTS for voice synthesis
- Queue system with pending/processing/completed/failed/paused states

## Common Commands
- Build: `npm run build`
- Restart webapp: `npx pm2 restart tts`
- Check workers: `systemctl status unified_worker@{1,2,3}`
- File server: `systemctl status tts-file-server`
