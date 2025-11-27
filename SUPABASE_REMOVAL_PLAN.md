# Supabase Removal Plan - Complete Local Queue System

## Overview

Supabase ko completely hata ke sab kuch Contabo pe local kar dena hai.

**Current (Supabase):**
```
Vercel → Supabase audio_jobs → Vast.ai polls → Supabase video_jobs → Contabo polls
```

**New (Local File Queue):**
```
Vercel → Contabo /data/audio-queue/ → Vast.ai polls file server →
         Contabo /data/video-queue/ → Video Worker watches local
```

---

## 1. New Folder Structure on Contabo

```
/root/tts/data/
├── audio-queue/
│   ├── pending/          # New jobs waiting to be picked
│   │   └── {job_id}.json
│   ├── processing/       # Jobs currently being processed
│   │   └── {worker_id}_{job_id}.json
│   ├── completed/        # Successfully completed jobs
│   │   └── {job_id}.json
│   └── failed/           # Failed jobs (for retry/debug)
│       └── {job_id}.json
│
├── video-queue/
│   ├── pending/
│   │   └── {job_id}.json
│   ├── processing/
│   │   └── {worker_id}_{job_id}.json
│   ├── completed/
│   │   └── {job_id}.json
│   └── failed/
│       └── {job_id}.json
│
├── counters.json         # Global counters (atomic updates)
│
└── workers/              # Worker status tracking
    ├── audio/
    │   └── {worker_id}.json
    └── video/
        └── {worker_id}.json
```

---

## 2. Job JSON Formats

### Audio Job (`audio-queue/pending/{job_id}.json`)
```json
{
  "job_id": "uuid-here",
  "script_text": "Hindi script text...",
  "channel_code": "BI",
  "video_number": 1,
  "date": "2025-01-27",
  "audio_counter": 42,
  "organized_path": "2025-01-27/BI/video_1",
  "priority": 0,
  "retry_count": 0,
  "created_at": "2025-01-27T10:30:00Z"
}
```

### Audio Job (Processing) - adds worker info
```json
{
  ...same as above,
  "worker_id": "vast_abc123",
  "processing_started_at": "2025-01-27T10:35:00Z"
}
```

### Audio Job (Completed) - adds results
```json
{
  ...same as above,
  "completed_at": "2025-01-27T10:40:00Z",
  "gofile_link": "https://gofile.io/xxx",
  "audio_path": "2025-01-27/BI/video_1/audio.wav"
}
```

### Video Job (`video-queue/pending/{job_id}.json`)
```json
{
  "job_id": "uuid-here",
  "audio_job_id": "audio-job-uuid",
  "channel_code": "BI",
  "video_number": 1,
  "date": "2025-01-27",
  "organized_path": "2025-01-27/BI/video_1",
  "image_folder": "nature",
  "priority": 0,
  "retry_count": 0,
  "created_at": "2025-01-27T10:40:00Z"
}
```

### Worker Status (`workers/audio/{worker_id}.json`)
```json
{
  "worker_id": "vast_abc123",
  "hostname": "vast-instance-1",
  "gpu_model": "RTX 4090",
  "status": "online",
  "current_job": null,
  "jobs_completed": 15,
  "jobs_failed": 2,
  "last_heartbeat": "2025-01-27T10:35:00Z",
  "created_at": "2025-01-27T08:00:00Z"
}
```

### Counters (`counters.json`)
```json
{
  "audio_counter": 42,
  "video_counter": 38,
  "updated_at": "2025-01-27T10:30:00Z"
}
```

---

## 3. File Server API Changes (`file_server.py`)

### New Endpoints:

#### 3.1 Create Job
```
POST /queue/{queue_type}/jobs
queue_type: "audio" or "video"
Body: job JSON data
Response: { "job_id": "xxx", "status": "pending" }

- Generates UUID if not provided
- Saves to pending/ folder
- Returns job_id
```

#### 3.2 Claim Job (Atomic)
```
POST /queue/{queue_type}/claim
Body: { "worker_id": "vast_abc123" }
Response: job JSON data or { "job": null }

- Lists pending/ folder (sorted by priority DESC, created_at ASC)
- Tries to MOVE first file to processing/{worker_id}_{job_id}.json
- If move fails (race condition), tries next file
- Returns job data or null if no jobs
```

#### 3.3 Complete Job
```
POST /queue/{queue_type}/jobs/{job_id}/complete
Body: { "worker_id": "xxx", "gofile_link": "xxx", ... }
Response: { "status": "completed" }

- Moves from processing/ to completed/
- Updates job JSON with completion data
```

#### 3.4 Fail Job
```
POST /queue/{queue_type}/jobs/{job_id}/fail
Body: { "worker_id": "xxx", "error_message": "xxx" }
Response: { "status": "failed" }

- Increments retry_count
- If retry_count < 3: moves back to pending/
- If retry_count >= 3: moves to failed/
```

#### 3.5 List Jobs
```
GET /queue/{queue_type}/jobs?status=pending
Response: [ { job1 }, { job2 }, ... ]
```

#### 3.6 Get Queue Stats
```
GET /queue/{queue_type}/stats
Response: {
  "pending": 5,
  "processing": 2,
  "completed": 100,
  "failed": 3
}
```

#### 3.7 Increment Counter (Atomic)
```
POST /counter/increment/{counter_type}
counter_type: "audio" or "video"
Response: { "value": 43 }

- Uses file locking for atomicity
- Returns new value
```

#### 3.8 Worker Heartbeat
```
POST /workers/{worker_type}/heartbeat
Body: { "worker_id": "xxx", "status": "online", "gpu_model": "xxx" }
Response: { "status": "ok" }

- Creates/updates worker status file
```

#### 3.9 List Workers
```
GET /workers/{worker_type}
Response: [ { worker1 }, { worker2 }, ... ]
```

---

## 4. Next.js API Changes

### 4.1 Remove Supabase Dependencies
- Delete `lib/supabase.ts`
- Remove all Supabase imports
- Remove Supabase env variables

### 4.2 Update `/api/queue/audio/route.ts`
```typescript
// OLD: Insert into Supabase
const { data, error } = await supabase.from('audio_jobs').insert(...)

// NEW: POST to file server
const response = await fetch(`${FILE_SERVER_URL}/queue/audio/jobs`, {
  method: 'POST',
  headers: { 'X-API-Key': API_KEY },
  body: JSON.stringify(jobData)
})
```

### 4.3 Update Counter Increment
```typescript
// OLD: Call Supabase function
const { data } = await supabase.rpc('increment_audio_counter')

// NEW: POST to file server
const response = await fetch(`${FILE_SERVER_URL}/counter/increment/audio`, {
  method: 'POST',
  headers: { 'X-API-Key': API_KEY }
})
const { value } = await response.json()
```

### 4.4 Update Queue Status API
```typescript
// OLD: Query Supabase
const { data } = await supabase.from('audio_jobs').select('status')

// NEW: GET from file server
const response = await fetch(`${FILE_SERVER_URL}/queue/audio/stats`)
```

### 4.5 Update Audio Files Page
```typescript
// OLD: Query completed jobs from Supabase
const { data } = await supabase.from('audio_jobs').select('*').eq('status', 'completed')

// NEW: GET from file server
const response = await fetch(`${FILE_SERVER_URL}/queue/audio/jobs?status=completed`)
```

---

## 5. Audio Worker Changes (`audio_worker_new.py`)

### 5.1 Remove Supabase Client
```python
# DELETE these:
from supabase import create_client
supabase = create_client(...)
```

### 5.2 New Queue Functions
```python
class FileServerQueue:
    def __init__(self, base_url, api_key):
        self.base_url = base_url
        self.api_key = api_key
        self.headers = {'X-API-Key': api_key}

    def claim_audio_job(self, worker_id):
        """Claim next pending audio job"""
        response = requests.post(
            f"{self.base_url}/queue/audio/claim",
            json={"worker_id": worker_id},
            headers=self.headers
        )
        return response.json().get('job')

    def complete_audio_job(self, job_id, worker_id, gofile_link):
        """Mark audio job as completed"""
        requests.post(
            f"{self.base_url}/queue/audio/jobs/{job_id}/complete",
            json={"worker_id": worker_id, "gofile_link": gofile_link},
            headers=self.headers
        )

    def fail_audio_job(self, job_id, worker_id, error_message):
        """Mark audio job as failed"""
        requests.post(
            f"{self.base_url}/queue/audio/jobs/{job_id}/fail",
            json={"worker_id": worker_id, "error_message": error_message},
            headers=self.headers
        )

    def create_video_job(self, job_data):
        """Create new video job"""
        requests.post(
            f"{self.base_url}/queue/video/jobs",
            json=job_data,
            headers=self.headers
        )

    def send_heartbeat(self, worker_id, status, gpu_model=None):
        """Send worker heartbeat"""
        requests.post(
            f"{self.base_url}/workers/audio/heartbeat",
            json={"worker_id": worker_id, "status": status, "gpu_model": gpu_model},
            headers=self.headers
        )
```

### 5.3 Update Main Loop
```python
# OLD:
job = supabase.rpc('claim_audio_job', {'p_worker_id': worker_id}).execute()

# NEW:
queue = FileServerQueue(FILE_SERVER_URL, API_KEY)
job = queue.claim_audio_job(worker_id)
```

### 5.4 Update Job Completion
```python
# OLD:
supabase.from_('audio_jobs').update({...}).eq('job_id', job_id).execute()
supabase.from_('video_jobs').insert({...}).execute()

# NEW:
queue.complete_audio_job(job_id, worker_id, gofile_link)
queue.create_video_job({
    'audio_job_id': job_id,
    'channel_code': channel_code,
    ...
})
```

---

## 6. Video Worker Changes (`video_worker_new.py`)

### 6.1 Remove Supabase, Use Local Files
```python
# DELETE Supabase imports

# NEW: Local file operations
import os
import json
import shutil
from pathlib import Path

QUEUE_BASE = Path('/root/tts/data/video-queue')
```

### 6.2 New Local Queue Functions
```python
class LocalVideoQueue:
    def __init__(self, base_path='/root/tts/data/video-queue'):
        self.base_path = Path(base_path)
        self.pending = self.base_path / 'pending'
        self.processing = self.base_path / 'processing'
        self.completed = self.base_path / 'completed'
        self.failed = self.base_path / 'failed'

        # Create folders if not exist
        for folder in [self.pending, self.processing, self.completed, self.failed]:
            folder.mkdir(parents=True, exist_ok=True)

    def claim_job(self, worker_id):
        """Claim next pending job (atomic via file move)"""
        # Get pending jobs sorted by priority and created_at
        pending_files = sorted(self.pending.glob('*.json'))

        for job_file in pending_files:
            try:
                # Try atomic move
                new_name = f"{worker_id}_{job_file.name}"
                new_path = self.processing / new_name
                job_file.rename(new_path)  # Atomic on Linux

                # Read and return job data
                with open(new_path) as f:
                    job = json.load(f)
                job['worker_id'] = worker_id
                job['processing_started_at'] = datetime.now().isoformat()

                # Update file with worker info
                with open(new_path, 'w') as f:
                    json.dump(job, f, indent=2)

                return job
            except FileNotFoundError:
                # Another worker took it, try next
                continue

        return None

    def complete_job(self, job_id, worker_id, gofile_link=None):
        """Move job to completed"""
        job_file = self.processing / f"{worker_id}_{job_id}.json"

        with open(job_file) as f:
            job = json.load(f)

        job['completed_at'] = datetime.now().isoformat()
        job['gofile_link'] = gofile_link

        completed_file = self.completed / f"{job_id}.json"
        with open(completed_file, 'w') as f:
            json.dump(job, f, indent=2)

        job_file.unlink()  # Delete processing file

    def fail_job(self, job_id, worker_id, error_message):
        """Move job to failed or back to pending for retry"""
        job_file = self.processing / f"{worker_id}_{job_id}.json"

        with open(job_file) as f:
            job = json.load(f)

        job['retry_count'] = job.get('retry_count', 0) + 1
        job['error_message'] = error_message
        job['last_failed_at'] = datetime.now().isoformat()

        if job['retry_count'] >= 3:
            # Move to failed
            dest = self.failed / f"{job_id}.json"
        else:
            # Back to pending for retry
            dest = self.pending / f"{job_id}.json"
            del job['worker_id']

        with open(dest, 'w') as f:
            json.dump(job, f, indent=2)

        job_file.unlink()
```

### 6.3 Update Main Loop
```python
# OLD:
job = supabase.rpc('claim_video_job', {'p_worker_id': worker_id}).execute()

# NEW:
queue = LocalVideoQueue()
job = queue.claim_job(worker_id)
```

---

## 7. Implementation Order

### Step 1: Create Folder Structure
```bash
mkdir -p /root/tts/data/audio-queue/{pending,processing,completed,failed}
mkdir -p /root/tts/data/video-queue/{pending,processing,completed,failed}
mkdir -p /root/tts/data/workers/{audio,video}
echo '{"audio_counter": 0, "video_counter": 0}' > /root/tts/data/counters.json
```

### Step 2: Update File Server (`file_server.py`)
- Add all new queue endpoints
- Add counter endpoint with file locking
- Add worker heartbeat endpoints
- Test endpoints with curl

### Step 3: Update Audio Worker (`audio_worker_new.py`)
- Remove Supabase
- Add FileServerQueue class
- Update main loop
- Test on Vast.ai

### Step 4: Update Video Worker (`video_worker_new.py`)
- Remove Supabase
- Add LocalVideoQueue class
- Update main loop
- Test locally

### Step 5: Update Next.js APIs
- Remove Supabase client
- Update queue API
- Update audio-files API
- Update stats API
- Test on local dev

### Step 6: Cleanup
- Remove Supabase env variables
- Remove `lib/supabase.ts`
- Update documentation

---

## 8. Race Condition Handling

### File Move Atomicity
- `os.rename()` / `Path.rename()` is atomic on Linux (same filesystem)
- If two workers try to move same file, only one succeeds
- Failed worker gets `FileNotFoundError`, tries next file

### Counter Atomicity
```python
import fcntl

def increment_counter(counter_type):
    counter_file = '/root/tts/data/counters.json'

    with open(counter_file, 'r+') as f:
        # Acquire exclusive lock
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)

        counters = json.load(f)
        counters[f'{counter_type}_counter'] += 1
        new_value = counters[f'{counter_type}_counter']

        f.seek(0)
        json.dump(counters, f, indent=2)
        f.truncate()

        # Lock released when file closes

    return new_value
```

---

## 9. Benefits

1. **No External Dependency** - No Supabase = no network latency, no rate limits
2. **Simpler** - Just files on disk, easy to debug
3. **Cheaper** - No Supabase costs
4. **Faster** - Local file ops vs network calls
5. **Offline Capable** - Works even if internet is down (for video worker)
6. **Easy Backup** - Just backup the data folder
7. **Easy Debug** - Can directly view/edit JSON files

---

## 10. Env Variables After Removal

### Next.js (.env.local)
```
# REMOVE:
# NEXT_PUBLIC_SUPABASE_URL=xxx
# NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx

# KEEP:
YOUTUBE_API_KEY=xxx
SUPADATA_API_KEY=xxx
GEMINI_API_KEY=xxx
FILE_SERVER_URL=http://contabo-ip:8000
FILE_SERVER_API_KEY=your-secret-key
```

### Workers (.env)
```
# REMOVE:
# SUPABASE_URL=xxx
# SUPABASE_ANON_KEY=xxx

# KEEP:
FILE_SERVER_URL=http://contabo-ip:8000
FILE_SERVER_API_KEY=your-secret-key
BOT_TOKEN=xxx
CHAT_ID=xxx
```

---

## Ready to Implement!

Ye plan follow karke Supabase completely hata denge. Shuru karte hain?
