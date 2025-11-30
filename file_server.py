#!/usr/bin/env python3
"""
FastAPI File Server for TTS Dashboard
Runs on Contabo - serves files to Vast.ai workers and web app
"""

import os
import shutil
import json
import fcntl
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, HTTPException, UploadFile, File, Header, Query, Body
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn


# ============================================================================
# PYDANTIC MODELS
# ============================================================================

class AudioJobCreate(BaseModel):
    script_text: str
    channel_code: str
    video_number: int
    date: str
    audio_counter: int
    organized_path: str
    priority: int = 0

class VideoJobCreate(BaseModel):
    audio_job_id: str
    channel_code: str
    video_number: int
    date: str
    organized_path: str
    image_folder: str = "nature"
    priority: int = 0

class ClaimRequest(BaseModel):
    worker_id: str

class CompleteRequest(BaseModel):
    worker_id: str
    gofile_link: Optional[str] = None

class FailRequest(BaseModel):
    worker_id: str
    error_message: str

class HeartbeatRequest(BaseModel):
    worker_id: str
    status: str = "online"
    hostname: Optional[str] = None
    gpu_model: Optional[str] = None
    current_job: Optional[str] = None

# Configuration
BASE_PATH = os.getenv("DATA_DIR", "/root/tts/data")
API_KEY = os.getenv("FILE_SERVER_API_KEY")  # Required: Set in environment
HOST = os.getenv("FILE_SERVER_HOST", "0.0.0.0")
PORT = int(os.getenv("FILE_SERVER_PORT", "8000"))

if not API_KEY:
    raise ValueError("FILE_SERVER_API_KEY must be set in environment")

app = FastAPI(
    title="TTS File Server",
    description="File server for TTS Dashboard - serves files to workers",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def verify_api_key(x_api_key: Optional[str] = Header(None)):
    """Verify API key for protected endpoints"""
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return True


def safe_path(path: str) -> str:
    """Ensure path doesn't escape BASE_PATH"""
    # Remove leading slashes and normalize
    clean_path = path.lstrip("/")
    full_path = os.path.normpath(os.path.join(BASE_PATH, clean_path))

    # Check it's still under BASE_PATH
    if not full_path.startswith(BASE_PATH):
        raise HTTPException(status_code=403, detail="Access denied")

    return full_path


@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "status": "ok",
        "service": "TTS File Server",
        "timestamp": datetime.now().isoformat(),
        "base_path": BASE_PATH
    }


@app.get("/health")
async def health():
    """Health check"""
    return {"status": "healthy"}


# ============================================================================
# FILE OPERATIONS
# ============================================================================

@app.get("/files/{path:path}")
async def download_file(
    path: str,
    x_api_key: Optional[str] = Header(None)
):
    """
    Download a file

    Args:
        path: File path relative to BASE_PATH

    Returns:
        File content
    """
    verify_api_key(x_api_key)

    file_path = safe_path(path)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {path}")

    if not os.path.isfile(file_path):
        raise HTTPException(status_code=400, detail=f"Not a file: {path}")

    return FileResponse(
        file_path,
        filename=os.path.basename(file_path)
    )


@app.post("/files/{path:path}")
async def upload_file(
    path: str,
    file: UploadFile = File(...),
    x_api_key: Optional[str] = Header(None)
):
    """
    Upload a file

    Args:
        path: Destination path relative to BASE_PATH
        file: File to upload

    Returns:
        Success status and file info
    """
    verify_api_key(x_api_key)

    file_path = safe_path(path)

    # Create directory if needed
    os.makedirs(os.path.dirname(file_path), exist_ok=True)

    # Save file
    try:
        with open(file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)

        file_size = os.path.getsize(file_path)

        return {
            "success": True,
            "path": path,
            "size": file_size,
            "filename": os.path.basename(file_path)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@app.delete("/files/{path:path}")
async def delete_file(
    path: str,
    x_api_key: Optional[str] = Header(None)
):
    """
    Delete a file

    Args:
        path: File path relative to BASE_PATH

    Returns:
        Success status
    """
    verify_api_key(x_api_key)

    file_path = safe_path(path)

    if not os.path.exists(file_path):
        return {"success": True, "message": "File already deleted"}

    try:
        if os.path.isfile(file_path):
            os.remove(file_path)
        elif os.path.isdir(file_path):
            shutil.rmtree(file_path)

        return {"success": True, "path": path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Delete failed: {str(e)}")


# ============================================================================
# DIRECTORY OPERATIONS
# ============================================================================

@app.get("/list/{path:path}")
async def list_directory(
    path: str = "",
    x_api_key: Optional[str] = Header(None)
):
    """
    List directory contents

    Args:
        path: Directory path relative to BASE_PATH

    Returns:
        List of files and directories
    """
    verify_api_key(x_api_key)

    dir_path = safe_path(path) if path else BASE_PATH

    if not os.path.exists(dir_path):
        raise HTTPException(status_code=404, detail=f"Directory not found: {path}")

    if not os.path.isdir(dir_path):
        raise HTTPException(status_code=400, detail=f"Not a directory: {path}")

    items = []
    for item in os.listdir(dir_path):
        item_path = os.path.join(dir_path, item)
        is_dir = os.path.isdir(item_path)

        items.append({
            "name": item,
            "type": "directory" if is_dir else "file",
            "size": os.path.getsize(item_path) if not is_dir else None,
            "modified": datetime.fromtimestamp(os.path.getmtime(item_path)).isoformat()
        })

    return {
        "path": path,
        "items": items,
        "count": len(items)
    }


@app.post("/mkdir/{path:path}")
async def create_directory(
    path: str,
    x_api_key: Optional[str] = Header(None)
):
    """
    Create a directory

    Args:
        path: Directory path relative to BASE_PATH

    Returns:
        Success status
    """
    verify_api_key(x_api_key)

    dir_path = safe_path(path)

    try:
        os.makedirs(dir_path, exist_ok=True)
        return {"success": True, "path": path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create directory: {str(e)}")


# ============================================================================
# CONVENIENCE ENDPOINTS
# ============================================================================

@app.get("/reference-audio/{filename}")
async def get_reference_audio(
    filename: str,
    x_api_key: Optional[str] = Header(None)
):
    """Get reference audio file by name"""
    verify_api_key(x_api_key)

    file_path = safe_path(f"reference-audio/{filename}")

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"Reference audio not found: {filename}")

    return FileResponse(file_path, filename=filename)


@app.get("/organized/{date}/{channel}/video_{num}/script.txt")
async def get_script(
    date: str,
    channel: str,
    num: int,
    x_api_key: Optional[str] = Header(None)
):
    """Get script file for a job"""
    verify_api_key(x_api_key)

    file_path = safe_path(f"organized/{date}/{channel}/video_{num}/script.txt")

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Script not found")

    with open(file_path, "r", encoding="utf-8") as f:
        content = f.read()

    return {"content": content}


@app.post("/organized/{date}/{channel}/video_{num}/audio.wav")
async def upload_audio(
    date: str,
    channel: str,
    num: int,
    file: UploadFile = File(...),
    x_api_key: Optional[str] = Header(None)
):
    """Upload audio file for a job"""
    verify_api_key(x_api_key)

    file_path = safe_path(f"organized/{date}/{channel}/video_{num}/audio.wav")

    os.makedirs(os.path.dirname(file_path), exist_ok=True)

    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    return {
        "success": True,
        "path": f"organized/{date}/{channel}/video_{num}/audio.wav",
        "size": os.path.getsize(file_path)
    }


@app.post("/organized/{date}/{channel}/video_{num}/video.mp4")
async def upload_video(
    date: str,
    channel: str,
    num: int,
    file: UploadFile = File(...),
    x_api_key: Optional[str] = Header(None)
):
    """Upload video file for a job"""
    verify_api_key(x_api_key)

    file_path = safe_path(f"organized/{date}/{channel}/video_{num}/video.mp4")

    os.makedirs(os.path.dirname(file_path), exist_ok=True)

    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    return {
        "success": True,
        "path": f"organized/{date}/{channel}/video_{num}/video.mp4",
        "size": os.path.getsize(file_path)
    }


@app.get("/images/{folder}")
async def list_images(
    folder: str,
    x_api_key: Optional[str] = Header(None)
):
    """List images in a folder"""
    verify_api_key(x_api_key)

    dir_path = safe_path(f"images/{folder}")

    if not os.path.exists(dir_path):
        raise HTTPException(status_code=404, detail=f"Image folder not found: {folder}")

    images = []
    for item in os.listdir(dir_path):
        if item.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
            images.append(item)

    return {"folder": folder, "images": images, "count": len(images)}


@app.get("/images/{folder}/{filename}")
async def get_image(
    folder: str,
    filename: str,
    x_api_key: Optional[str] = Header(None)
):
    """Get an image file"""
    verify_api_key(x_api_key)

    file_path = safe_path(f"images/{folder}/{filename}")

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"Image not found: {filename}")

    return FileResponse(file_path, filename=filename)


# ============================================================================
# QUEUE OPERATIONS
# ============================================================================

def get_queue_paths(queue_type: str):
    """Get paths for a queue type"""
    if queue_type not in ["audio", "video"]:
        raise HTTPException(status_code=400, detail="Invalid queue type. Use 'audio' or 'video'")

    base = Path(BASE_PATH) / f"{queue_type}-queue"
    return {
        "pending": base / "pending",
        "processing": base / "processing",
        "completed": base / "completed",
        "failed": base / "failed"
    }


@app.post("/queue/{queue_type}/jobs")
async def create_job(
    queue_type: str,
    job: dict = Body(...),
    x_api_key: Optional[str] = Header(None)
):
    """
    Create a new job in the queue

    Args:
        queue_type: 'audio' or 'video'
        job: Job data

    Returns:
        Created job with job_id
    """
    verify_api_key(x_api_key)
    paths = get_queue_paths(queue_type)

    # Generate job_id if not provided
    job_id = job.get("job_id", str(uuid.uuid4()))
    job["job_id"] = job_id
    job["created_at"] = datetime.now().isoformat()
    job["retry_count"] = job.get("retry_count", 0)

    # Save to pending folder
    job_file = paths["pending"] / f"{job_id}.json"
    paths["pending"].mkdir(parents=True, exist_ok=True)

    with open(job_file, "w") as f:
        json.dump(job, f, indent=2)

    return {"success": True, "job_id": job_id, "status": "pending"}


@app.post("/queue/{queue_type}/claim")
async def claim_job(
    queue_type: str,
    request: ClaimRequest,
    x_api_key: Optional[str] = Header(None)
):
    """
    Atomically claim the next pending job

    Args:
        queue_type: 'audio' or 'video'
        request: Contains worker_id

    Returns:
        Job data or null if no jobs available
    """
    verify_api_key(x_api_key)
    paths = get_queue_paths(queue_type)

    # Get pending jobs sorted by priority (desc) and created_at (asc)
    pending_files = list(paths["pending"].glob("*.json"))

    if not pending_files:
        return {"job": None, "message": "No pending jobs"}

    # Read all jobs to sort by priority
    jobs_with_files = []
    for job_file in pending_files:
        try:
            with open(job_file) as f:
                job_data = json.load(f)
                jobs_with_files.append((job_file, job_data))
        except:
            continue

    # Sort by priority (desc) then created_at (asc)
    jobs_with_files.sort(key=lambda x: (-x[1].get("priority", 0), x[1].get("created_at", "")))

    # Try to claim each job atomically
    for job_file, job_data in jobs_with_files:
        try:
            # Atomic move: pending -> processing
            new_name = f"{request.worker_id}_{job_file.name}"
            new_path = paths["processing"] / new_name
            paths["processing"].mkdir(parents=True, exist_ok=True)

            # os.rename is atomic on Linux (same filesystem)
            os.rename(str(job_file), str(new_path))

            # Update job with worker info
            job_data["worker_id"] = request.worker_id
            job_data["processing_started_at"] = datetime.now().isoformat()

            with open(new_path, "w") as f:
                json.dump(job_data, f, indent=2)

            return {"job": job_data, "message": "Job claimed successfully"}

        except FileNotFoundError:
            # Another worker claimed it, try next
            continue
        except Exception as e:
            # Log error but try next job
            print(f"Error claiming job: {e}")
            continue

    return {"job": None, "message": "No jobs available (all claimed)"}


@app.post("/queue/{queue_type}/jobs/{job_id}/complete")
async def complete_job(
    queue_type: str,
    job_id: str,
    request: CompleteRequest,
    x_api_key: Optional[str] = Header(None)
):
    """
    Mark a job as completed

    Args:
        queue_type: 'audio' or 'video'
        job_id: Job ID
        request: Contains worker_id and optional gofile_link

    Returns:
        Success status
    """
    verify_api_key(x_api_key)
    paths = get_queue_paths(queue_type)

    # Find job in processing folder
    job_file = paths["processing"] / f"{request.worker_id}_{job_id}.json"

    if not job_file.exists():
        raise HTTPException(status_code=404, detail=f"Job not found in processing: {job_id}")

    # Read job data
    with open(job_file) as f:
        job_data = json.load(f)

    # Update completion info
    job_data["completed_at"] = datetime.now().isoformat()
    if request.gofile_link:
        job_data["gofile_link"] = request.gofile_link
    job_data["status"] = "completed"

    # Move to completed folder
    completed_file = paths["completed"] / f"{job_id}.json"
    paths["completed"].mkdir(parents=True, exist_ok=True)

    with open(completed_file, "w") as f:
        json.dump(job_data, f, indent=2)

    # Delete from processing
    job_file.unlink()

    return {"success": True, "status": "completed", "job_id": job_id}


@app.post("/queue/{queue_type}/jobs/{job_id}/fail")
async def fail_job(
    queue_type: str,
    job_id: str,
    request: FailRequest,
    x_api_key: Optional[str] = Header(None)
):
    """
    Mark a job as failed (with retry logic)

    Args:
        queue_type: 'audio' or 'video'
        job_id: Job ID
        request: Contains worker_id and error_message

    Returns:
        Success status and retry info
    """
    verify_api_key(x_api_key)
    paths = get_queue_paths(queue_type)

    # Find job in processing folder
    job_file = paths["processing"] / f"{request.worker_id}_{job_id}.json"

    if not job_file.exists():
        raise HTTPException(status_code=404, detail=f"Job not found in processing: {job_id}")

    # Read job data
    with open(job_file) as f:
        job_data = json.load(f)

    # Update failure info
    job_data["retry_count"] = job_data.get("retry_count", 0) + 1
    job_data["error_message"] = request.error_message
    job_data["last_failed_at"] = datetime.now().isoformat()

    max_retries = 3

    if job_data["retry_count"] >= max_retries:
        # Move to failed folder
        job_data["status"] = "failed"
        dest_file = paths["failed"] / f"{job_id}.json"
        paths["failed"].mkdir(parents=True, exist_ok=True)
        message = f"Job permanently failed after {max_retries} retries"
    else:
        # Move back to pending for retry
        job_data["status"] = "pending"
        if "worker_id" in job_data:
            del job_data["worker_id"]
        if "processing_started_at" in job_data:
            del job_data["processing_started_at"]
        dest_file = paths["pending"] / f"{job_id}.json"
        message = f"Job queued for retry ({job_data['retry_count']}/{max_retries})"

    with open(dest_file, "w") as f:
        json.dump(job_data, f, indent=2)

    # Delete from processing
    job_file.unlink()

    return {
        "success": True,
        "status": job_data["status"],
        "retry_count": job_data["retry_count"],
        "message": message
    }


@app.post("/queue/{queue_type}/jobs/{job_id}/status")
async def update_job_status(
    queue_type: str,
    job_id: str,
    new_status: str = Body(..., embed=True),
    x_api_key: Optional[str] = Header(None)
):
    """
    Update job status - move job between folders

    Args:
        queue_type: 'audio' or 'video'
        job_id: Job ID
        new_status: Target status (pending, completed, failed)

    Returns:
        Success status
    """
    verify_api_key(x_api_key)
    paths = get_queue_paths(queue_type)

    if new_status not in ["pending", "completed", "failed"]:
        raise HTTPException(status_code=400, detail="Invalid status. Must be: pending, completed, failed")

    # Find the job in any folder
    job_data = None
    source_file = None
    current_status = None

    for status, folder in paths.items():
        # Check direct match
        job_file = folder / f"{job_id}.json"
        if job_file.exists():
            source_file = job_file
            current_status = status
            break
        # Check processing folder with worker prefix
        if status == "processing":
            for f in folder.glob(f"*_{job_id}.json"):
                source_file = f
                current_status = status
                break

    if not source_file:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")

    # Read job data
    with open(source_file) as f:
        job_data = json.load(f)

    # Update status
    job_data["status"] = new_status
    job_data["status_updated_at"] = datetime.now().isoformat()

    # Reset retry count and error when moving to pending
    if new_status == "pending":
        job_data["retry_count"] = 0
        if "error_message" in job_data:
            del job_data["error_message"]
        if "worker_id" in job_data:
            del job_data["worker_id"]
        if "processing_started_at" in job_data:
            del job_data["processing_started_at"]

    # Save to new folder
    dest_file = paths[new_status] / f"{job_id}.json"
    paths[new_status].mkdir(parents=True, exist_ok=True)

    with open(dest_file, "w") as f:
        json.dump(job_data, f, indent=2)

    # Delete from old location
    source_file.unlink()

    return {
        "success": True,
        "job_id": job_id,
        "old_status": current_status,
        "new_status": new_status
    }


@app.get("/queue/{queue_type}/jobs")
async def list_jobs(
    queue_type: str,
    status: str = Query("pending", description="Job status: pending, processing, completed, failed"),
    x_api_key: Optional[str] = Header(None)
):
    """
    List jobs by status

    Args:
        queue_type: 'audio' or 'video'
        status: pending, processing, completed, or failed

    Returns:
        List of jobs
    """
    verify_api_key(x_api_key)
    paths = get_queue_paths(queue_type)

    if status not in paths:
        raise HTTPException(status_code=400, detail="Invalid status")

    job_files = list(paths[status].glob("*.json"))
    jobs = []

    for job_file in job_files:
        try:
            with open(job_file) as f:
                job_data = json.load(f)
                jobs.append(job_data)
        except:
            continue

    # Sort by created_at desc for completed/failed, by priority for pending
    if status in ["completed", "failed"]:
        jobs.sort(key=lambda x: x.get("completed_at", x.get("last_failed_at", "")), reverse=True)
    else:
        jobs.sort(key=lambda x: (-x.get("priority", 0), x.get("created_at", "")))

    return {"jobs": jobs, "count": len(jobs)}


@app.get("/queue/{queue_type}/stats")
async def get_queue_stats(
    queue_type: str,
    x_api_key: Optional[str] = Header(None)
):
    """
    Get queue statistics

    Args:
        queue_type: 'audio' or 'video'

    Returns:
        Count of jobs in each status
    """
    verify_api_key(x_api_key)
    paths = get_queue_paths(queue_type)

    stats = {}
    for status, path in paths.items():
        if path.exists():
            stats[status] = len(list(path.glob("*.json")))
        else:
            stats[status] = 0

    stats["total"] = sum(stats.values())

    return stats


# ============================================================================
# COUNTER OPERATIONS
# ============================================================================

@app.post("/counter/increment/{counter_type}")
async def increment_counter(
    counter_type: str,
    x_api_key: Optional[str] = Header(None)
):
    """
    Atomically increment a counter

    Args:
        counter_type: 'audio' or 'video'

    Returns:
        New counter value
    """
    verify_api_key(x_api_key)

    if counter_type not in ["audio", "video"]:
        raise HTTPException(status_code=400, detail="Invalid counter type")

    counter_file = Path(BASE_PATH) / "counters.json"
    counter_key = f"{counter_type}_counter"

    # Use file locking for atomicity
    with open(counter_file, "r+") as f:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)

        try:
            counters = json.load(f)
        except:
            counters = {"audio_counter": 0, "video_counter": 0}

        counters[counter_key] = counters.get(counter_key, 0) + 1
        counters["updated_at"] = datetime.now().isoformat()
        new_value = counters[counter_key]

        f.seek(0)
        json.dump(counters, f, indent=2)
        f.truncate()

        # Lock released when file closes

    return {"counter": counter_type, "value": new_value}


@app.get("/counter/{counter_type}")
async def get_counter(
    counter_type: str,
    x_api_key: Optional[str] = Header(None)
):
    """
    Get current counter value

    Args:
        counter_type: 'audio' or 'video'

    Returns:
        Current counter value
    """
    verify_api_key(x_api_key)

    if counter_type not in ["audio", "video"]:
        raise HTTPException(status_code=400, detail="Invalid counter type")

    counter_file = Path(BASE_PATH) / "counters.json"
    counter_key = f"{counter_type}_counter"

    try:
        with open(counter_file) as f:
            counters = json.load(f)
        return {"counter": counter_type, "value": counters.get(counter_key, 0)}
    except:
        return {"counter": counter_type, "value": 0}


# ============================================================================
# RESET OPERATIONS
# ============================================================================

@app.post("/queue/reset")
async def reset_queue(
    x_api_key: Optional[str] = Header(None)
):
    """
    Reset all queues - delete all jobs from pending, processing, completed, failed
    """
    verify_api_key(x_api_key)

    results = {"audio": {}, "video": {}}

    for queue_type in ["audio", "video"]:
        paths = get_queue_paths(queue_type)
        for status, path in paths.items():
            if path.exists():
                count = len(list(path.glob("*.json")))
                shutil.rmtree(path)
                path.mkdir(parents=True, exist_ok=True)
                results[queue_type][status] = count
            else:
                results[queue_type][status] = 0

    return {"success": True, "deleted": results}


@app.post("/counter/reset")
async def reset_counters(
    x_api_key: Optional[str] = Header(None)
):
    """
    Reset all counters to 0
    """
    verify_api_key(x_api_key)

    counter_file = Path(BASE_PATH) / "counters.json"

    counters = {
        "audio_counter": 0,
        "video_counter": 0,
        "updated_at": datetime.now().isoformat()
    }

    with open(counter_file, "w") as f:
        json.dump(counters, f, indent=2)

    return {"success": True, "counters": counters}


# ============================================================================
# WORKER OPERATIONS
# ============================================================================

@app.post("/workers/{worker_type}/heartbeat")
async def worker_heartbeat(
    worker_type: str,
    request: HeartbeatRequest,
    x_api_key: Optional[str] = Header(None)
):
    """
    Update worker heartbeat

    Args:
        worker_type: 'audio' or 'video'
        request: Worker status info

    Returns:
        Success status
    """
    verify_api_key(x_api_key)

    if worker_type not in ["audio", "video"]:
        raise HTTPException(status_code=400, detail="Invalid worker type")

    workers_dir = Path(BASE_PATH) / "workers" / worker_type
    workers_dir.mkdir(parents=True, exist_ok=True)

    worker_file = workers_dir / f"{request.worker_id}.json"

    # Read existing or create new
    if worker_file.exists():
        with open(worker_file) as f:
            worker_data = json.load(f)
    else:
        worker_data = {
            "worker_id": request.worker_id,
            "jobs_completed": 0,
            "jobs_failed": 0,
            "created_at": datetime.now().isoformat()
        }

    # Update
    worker_data["status"] = request.status
    worker_data["last_heartbeat"] = datetime.now().isoformat()
    if request.hostname:
        worker_data["hostname"] = request.hostname
    if request.gpu_model:
        worker_data["gpu_model"] = request.gpu_model
    if request.current_job is not None:
        worker_data["current_job"] = request.current_job

    with open(worker_file, "w") as f:
        json.dump(worker_data, f, indent=2)

    return {"success": True, "worker_id": request.worker_id}


@app.post("/workers/{worker_type}/{worker_id}/increment")
async def increment_worker_stat(
    worker_type: str,
    worker_id: str,
    stat: str = Query(..., description="Stat to increment: jobs_completed or jobs_failed"),
    x_api_key: Optional[str] = Header(None)
):
    """Increment worker job count"""
    verify_api_key(x_api_key)

    if stat not in ["jobs_completed", "jobs_failed"]:
        raise HTTPException(status_code=400, detail="Invalid stat")

    workers_dir = Path(BASE_PATH) / "workers" / worker_type
    worker_file = workers_dir / f"{worker_id}.json"

    if not worker_file.exists():
        raise HTTPException(status_code=404, detail="Worker not found")

    with open(worker_file) as f:
        worker_data = json.load(f)

    worker_data[stat] = worker_data.get(stat, 0) + 1

    with open(worker_file, "w") as f:
        json.dump(worker_data, f, indent=2)

    return {"success": True, stat: worker_data[stat]}


@app.get("/workers/{worker_type}")
async def list_workers(
    worker_type: str,
    x_api_key: Optional[str] = Header(None)
):
    """
    List all workers of a type

    Args:
        worker_type: 'audio' or 'video'

    Returns:
        List of workers
    """
    verify_api_key(x_api_key)

    if worker_type not in ["audio", "video"]:
        raise HTTPException(status_code=400, detail="Invalid worker type")

    workers_dir = Path(BASE_PATH) / "workers" / worker_type

    if not workers_dir.exists():
        return {"workers": [], "count": 0}

    workers = []
    for worker_file in workers_dir.glob("*.json"):
        try:
            with open(worker_file) as f:
                worker_data = json.load(f)
                workers.append(worker_data)
        except:
            continue

    # Sort by last_heartbeat desc
    workers.sort(key=lambda x: x.get("last_heartbeat", ""), reverse=True)

    return {"workers": workers, "count": len(workers)}


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    print(f"Starting TTS File Server...")
    print(f"Base path: {BASE_PATH}")
    print(f"Host: {HOST}")
    print(f"Port: {PORT}")

    # Ensure base directories exist
    os.makedirs(BASE_PATH, exist_ok=True)
    os.makedirs(os.path.join(BASE_PATH, "reference-audio"), exist_ok=True)
    os.makedirs(os.path.join(BASE_PATH, "images"), exist_ok=True)
    os.makedirs(os.path.join(BASE_PATH, "organized"), exist_ok=True)
    os.makedirs(os.path.join(BASE_PATH, "transcripts"), exist_ok=True)

    uvicorn.run(app, host=HOST, port=PORT)
