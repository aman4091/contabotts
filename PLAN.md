# TTS Dashboard - Complete Implementation Plan

## Project Overview

A Next.js 14 web application for processing YouTube transcripts into TTS audio and videos.
- **Frontend**: Vercel (Next.js 14)
- **Backend/File Server**: Contabo (FastAPI)
- **Audio Generation**: Vast.ai (F5-TTS)
- **Video Generation**: Contabo (FFmpeg)
- **Database**: Supabase (minimal - only job queues)
- **File Storage**: All local on Contabo
- **Sync**: Syncthing to Mobile/PC

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           VERCEL                                         │
│                     Next.js 14 Frontend                                  │
│  - Source/Target Channel Selection                                       │
│  - YouTube Video Fetching                                                │
│  - Transcript Fetching (Supadata)                                        │
│  - AI Processing (Gemini)                                                │
│  - Add to Audio Queue                                                    │
│  - Audio Files Page (view completed)                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ API Calls
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         CONTABO SERVER                                   │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  FastAPI File Server (Port 8000)                                 │    │
│  │  - GET/POST/DELETE files                                         │    │
│  │  - List directories                                              │    │
│  │  - Serve reference audio, images                                 │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  video_worker.py (24/7)                                          │    │
│  │  - Polls Supabase for video jobs                                 │    │
│  │  - Downloads audio from local /data/organized/                   │    │
│  │  - Generates video with FFmpeg                                   │    │
│  │  - Saves to /data/organized/                                     │    │
│  │  - Uploads to Gofile                                             │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  /root/tts/data/  (All local storage)                                   │
│  ├── source-channels.json                                               │
│  ├── target-channels.json                                               │
│  ├── settings.json                                                      │
│  ├── reference-audio/                                                   │
│  ├── images/                                                            │
│  ├── transcripts/                                                       │
│  ├── skip/                                                              │
│  ├── completed/                                                         │
│  └── organized/                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Supabase (Job Queue)
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           SUPABASE                                       │
│  - audio_jobs (queue)                                                   │
│  - video_jobs (queue)                                                   │
│  - audio_workers (status)                                               │
│  - video_workers (status)                                               │
│  - global_counter                                                       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Polls for jobs
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           VAST.AI                                        │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  audio_worker.py                                                 │    │
│  │  - Polls Supabase for audio jobs                                 │    │
│  │  - Downloads script & reference audio from Contabo               │    │
│  │  - Generates audio with F5-TTS                                   │    │
│  │  - Uploads audio to Contabo /data/organized/                     │    │
│  │  - Uploads to Gofile                                             │    │
│  │  - Creates video job                                             │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Syncthing
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       MOBILE / PC (Sync)                                 │
│  - Syncthing auto-syncs /data/organized/ folder                         │
│  - Direct access to all scripts, audio, video                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Folder Structure

```
/root/tts/
│
├── PLAN.md                              # This file
├── PROGRESS.md                          # Implementation progress
│
├── data/                                # ALL LOCAL DATA
│   ├── source-channels.json             # Source channel configs
│   ├── target-channels.json             # Target channel configs
│   ├── settings.json                    # Prompts, API configs
│   │
│   ├── reference-audio/                 # Voice samples
│   │   ├── BI.wav
│   │   ├── AFG.wav
│   │   ├── JIMMY.wav
│   │   ├── GYH.wav
│   │   ├── ANU.wav
│   │   └── JM.wav
│   │
│   ├── images/                          # Images for video
│   │   ├── nature/
│   │   ├── jesus/
│   │   └── shorts/
│   │
│   ├── transcripts/                     # Fetched transcripts
│   │   └── {SOURCE_CHANNEL}/
│   │       ├── 1.txt
│   │       ├── 2.txt
│   │       └── ...
│   │
│   ├── skip/                            # Skipped transcripts
│   │   └── {SOURCE_CHANNEL}/
│   │       └── {index}.txt
│   │
│   ├── completed/                       # Processed & queued
│   │   └── {SOURCE_CHANNEL}/
│   │       └── {index}.txt
│   │
│   └── organized/                       # FINAL OUTPUT
│       └── {DATE}/
│           └── {TARGET_CHANNEL}/
│               └── video_{N}/
│                   ├── transcript.txt
│                   ├── script.txt
│                   ├── audio.wav
│                   └── video.mp4
│
├── app/                                 # Next.js 14 App
│   ├── layout.tsx
│   ├── page.tsx                         # Main dashboard
│   ├── audio-files/
│   │   └── page.tsx                     # Audio files list
│   ├── settings/
│   │   └── page.tsx                     # Settings page
│   ├── globals.css
│   │
│   └── api/
│       ├── source-channels/route.ts
│       ├── target-channels/route.ts
│       ├── settings/route.ts
│       ├── transcripts/
│       │   ├── route.ts                 # List transcripts
│       │   ├── save/route.ts            # Save batch
│       │   └── skip/route.ts            # Skip transcript
│       ├── youtube/
│       │   ├── videos/route.ts          # Fetch videos
│       │   └── transcript/route.ts      # Fetch transcript
│       ├── ai/
│       │   └── process/route.ts         # Gemini AI
│       ├── queue/
│       │   └── audio/route.ts           # Add to queue
│       └── audio-files/route.ts         # List completed
│
├── components/
│   └── ui/                              # shadcn/ui
│
├── lib/
│   ├── supabase.ts
│   ├── file-storage.ts                  # Local file operations
│   └── utils.ts
│
├── file_server.py                       # FastAPI file server
├── audio_worker.py                      # Vast.ai worker (updated)
├── video_worker.py                      # Contabo worker (updated)
├── supabase_client.py
│
├── package.json
├── next.config.js
├── tailwind.config.js
├── tsconfig.json
└── .env.local
```

---

## Data Formats

### source-channels.json
```json
[
  {
    "channel_code": "MRBEAST",
    "channel_name": "MrBeast",
    "youtube_channel_url": "https://youtube.com/@MrBeast",
    "min_duration_seconds": 600,
    "max_duration_seconds": 7200,
    "max_videos": 1000,
    "is_active": true
  }
]
```

### target-channels.json
```json
[
  {
    "channel_code": "BI",
    "channel_name": "Business Insider Hindi",
    "reference_audio": "BI.wav",
    "is_active": true
  }
]
```

### settings.json
```json
{
  "prompts": {
    "youtube": "Convert this English transcript to Hindi...",
    "channel": "Rewrite for TTS narration..."
  },
  "api_keys": {
    "youtube": "env",
    "supadata": "env",
    "gemini": "env"
  }
}
```

### Transcript file format (1.txt)
```
Title: Video Title Here
Video ID: dQw4w9WgXcQ

Transcript text goes here...
Multiple lines...
```

---

## Supabase Tables

### audio_jobs
```sql
CREATE TABLE audio_jobs (
  job_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  script_text TEXT NOT NULL,
  channel_code TEXT NOT NULL,
  video_number INTEGER NOT NULL,
  date DATE NOT NULL,
  audio_counter INTEGER NOT NULL,
  organized_path TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  worker_id TEXT,
  error_message TEXT,
  gofile_link TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processing_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
```

### video_jobs
```sql
CREATE TABLE video_jobs (
  job_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  audio_job_id UUID REFERENCES audio_jobs(job_id),
  channel_code TEXT NOT NULL,
  video_number INTEGER NOT NULL,
  date DATE NOT NULL,
  organized_path TEXT NOT NULL,
  image_folder TEXT DEFAULT 'nature',
  status TEXT DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  worker_id TEXT,
  error_message TEXT,
  gofile_link TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processing_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);
```

### audio_workers
```sql
CREATE TABLE audio_workers (
  worker_id TEXT PRIMARY KEY,
  hostname TEXT,
  gpu_model TEXT,
  status TEXT DEFAULT 'offline',
  jobs_completed INTEGER DEFAULT 0,
  jobs_failed INTEGER DEFAULT 0,
  last_heartbeat TIMESTAMPTZ
);
```

### video_workers
```sql
CREATE TABLE video_workers (
  worker_id TEXT PRIMARY KEY,
  hostname TEXT,
  status TEXT DEFAULT 'offline',
  jobs_completed INTEGER DEFAULT 0,
  jobs_failed INTEGER DEFAULT 0,
  last_heartbeat TIMESTAMPTZ
);
```

### global_counter
```sql
CREATE TABLE global_counter (
  id INTEGER PRIMARY KEY DEFAULT 1,
  audio_counter INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (id = 1)
);

-- Atomic increment function
CREATE OR REPLACE FUNCTION increment_audio_counter()
RETURNS INTEGER AS $$
DECLARE
  new_val INTEGER;
BEGIN
  UPDATE global_counter
  SET audio_counter = audio_counter + 1, updated_at = NOW()
  WHERE id = 1
  RETURNING audio_counter INTO new_val;
  RETURN new_val;
END;
$$ LANGUAGE plpgsql;
```

---

## API Endpoints

### Source Channels
- `GET /api/source-channels` - List all
- `POST /api/source-channels` - Add new
- `PUT /api/source-channels` - Update
- `DELETE /api/source-channels?code=XXX` - Delete

### Target Channels
- `GET /api/target-channels` - List all
- `POST /api/target-channels` - Add new
- `PUT /api/target-channels` - Update
- `DELETE /api/target-channels?code=XXX` - Delete

### Transcripts
- `GET /api/transcripts?channel=XXX` - List transcripts
- `GET /api/transcripts/[index]?channel=XXX` - Get single
- `POST /api/transcripts/save` - Save batch
- `POST /api/transcripts/skip` - Skip transcript

### YouTube
- `POST /api/youtube/videos` - Fetch channel videos
- `POST /api/youtube/transcript` - Fetch single transcript

### AI
- `POST /api/ai/process` - Process with Gemini

### Queue
- `POST /api/queue/audio` - Add to audio queue
- `GET /api/queue/status` - Get queue status

### Audio Files
- `GET /api/audio-files` - List completed audio jobs

### Settings
- `GET /api/settings` - Get all settings
- `PUT /api/settings` - Update settings

---

## User Flow

1. **Open webpage**
2. **Select Source Channel** (dropdown) → Load saved transcripts
3. **If no transcripts**:
   - Set duration filter (min/max)
   - Click "Fetch Videos" → YouTube API
   - Click "Fetch Transcripts" → Supadata API (20/sec)
   - Auto-save to local files
4. **Select Target Channel** (dropdown)
5. **Click transcript** in left panel → Show in right panel
6. **Process**:
   - "Copy Prompt+Transcript" → Manual Gemini
   - "AI Process" → Auto Gemini API
   - "Skip" → Move to skip folder
7. **Paste/Edit** processed script in textarea
8. **"Add to Audio Queue"**:
   - Create organized folder structure
   - Save transcript.txt + script.txt
   - Insert job to Supabase
   - Move original to completed folder
   - Show success message
   - Auto-advance to next transcript
9. **Audio Worker** (Vast.ai) picks job:
   - Download script + reference audio from Contabo
   - Generate audio
   - Upload to Contabo organized folder
   - Upload to Gofile
   - Create video job
10. **Video Worker** (Contabo) picks job:
    - Read audio from organized folder
    - Get image from images folder
    - Generate video
    - Save to organized folder
    - Upload to Gofile
11. **View results**:
    - "Audio Files" page shows Gofile links
    - Syncthing syncs organized folder to mobile/PC

---

## Implementation Order

### Phase 1: Foundation
1. Create folder structure
2. Create data files (JSON configs)
3. Setup Next.js project
4. Install dependencies
5. Setup Tailwind + shadcn/ui

### Phase 2: File Server
6. Create FastAPI file server
7. Test file operations

### Phase 3: Frontend - Basic
8. Create layout with navigation
9. Create main page UI
10. Create source/target channel dropdowns

### Phase 4: API Routes
11. Source channels API
12. Target channels API
13. Transcripts API
14. Settings API

### Phase 5: YouTube Integration
15. YouTube videos API
16. Supadata transcript API

### Phase 6: AI Processing
17. Gemini AI process API

### Phase 7: Queue System
18. Add to queue API
19. Create organized folders

### Phase 8: Workers
20. Update audio_worker.py for Contabo file server
21. Update video_worker.py for local files

### Phase 9: Additional Pages
22. Audio Files page
23. Settings page

### Phase 10: Polish
24. Error handling
25. Loading states
26. Toast notifications
27. Testing

---

## Environment Variables

### .env.local (Vercel/Next.js)
```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx

# YouTube
YOUTUBE_API_KEY=AIzaSyxxx

# Supadata
SUPADATA_API_KEY=xxx

# Gemini
GEMINI_API_KEY=AIzaSyxxx

# Contabo File Server
FILE_SERVER_URL=http://contabo-ip:8000
FILE_SERVER_API_KEY=your-secret-key
```

### .env (Workers)
```
# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJxxx

# Contabo File Server
FILE_SERVER_URL=http://contabo-ip:8000
FILE_SERVER_API_KEY=your-secret-key

# Telegram
BOT_TOKEN=xxx
CHAT_ID=xxx
```

---

## Notes

- All files stored locally on Contabo
- No Google Drive dependency
- Supabase only for job queue management
- Syncthing for mobile/PC access
- Gofile for easy sharing links
- Workers poll Supabase, download/upload via Contabo file server
