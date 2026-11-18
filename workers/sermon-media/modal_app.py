"""Modal app for FaithForm sermon media compute.

  modal deploy workers/sermon-media/modal_app.py
  modal run workers/sermon-media/modal_app.py::benchmark --paths /data/service1.mp4

Deploy-time settings (read from the local environment when deploying):
  MAX_GPU_CONTAINERS (10), MAX_RENDER_CONTAINERS (10), SCALEDOWN_WINDOW_SEC (120),
  TRANSCRIBE_TIMEOUT_SEC (3600), RENDER_TIMEOUT_SEC (1800), GPU_TYPE (L4).
Runtime settings come from the Modal secret `faithform-sermon-media`:
  ASR_ENGINE, ASR_FALLBACK_ENGINE, AUDIO_EVENTS, ASR_WINDOW_SEC, ASR_OVERLAP_SEC, LANGID_MODEL, ...
"""
import json
import logging
import os
import sys

import modal

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)  # so add_local_python_source finds sermon_media / bench

APP_NAME = "faithform-sermon-media"
GPU = os.environ.get("GPU_TYPE", "L4")
MAX_GPU_CONTAINERS = int(os.environ.get("MAX_GPU_CONTAINERS", "10"))
MAX_RENDER_CONTAINERS = int(os.environ.get("MAX_RENDER_CONTAINERS", "10"))
SCALEDOWN = int(os.environ.get("SCALEDOWN_WINDOW_SEC", "120"))
TRANSCRIBE_TIMEOUT = int(os.environ.get("TRANSCRIBE_TIMEOUT_SEC", "3600"))  # 2 h service ~5-10 min
RENDER_TIMEOUT = int(os.environ.get("RENDER_TIMEOUT_SEC", "1800"))

app = modal.App(APP_NAME)
secret = modal.Secret.from_name("faithform-sermon-media")
models = modal.Volume.from_name("faithform-sermon-media-models", create_if_missing=True)
bench_data = modal.Volume.from_name("faithform-sermon-media-bench", create_if_missing=True)

web_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("fastapi[standard]>=0.115")
    .add_local_python_source("sermon_media")
)

render_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "fontconfig", "fonts-dejavu-core")  # bookworm ffmpeg 5.1 (libass, loudnorm)
    .pip_install("numpy>=1.26,<2.3", "opencv-python-headless>=4.10,<5")
    .env({"CAPTION_FONT": "DejaVu Sans", "PYTHONUNBUFFERED": "1"})
    .add_local_python_source("sermon_media")
)

gpu_image = (
    modal.Image.from_registry("nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04", add_python="3.11")
    .apt_install("ffmpeg", "libsndfile1", "git")
    # One resolve for torch, torchaudio and NeMo: NeMo pulls its own torch, and a
    # torchaudio pinned in an earlier layer no longer matches it (libtorchaudio
    # fails to load with an undefined symbol). torchaudio pins torch exactly.
    .pip_install("nemo_toolkit[asr]>=2.4,<3", "torch", "torchaudio", "faster-whisper>=1.1.1", "numpy>=1.26,<2.3")
    .pip_install("tensorflow-cpu>=2.16,<2.20", "tensorflow-hub>=0.16")
    .pip_install("jiwer>=3.0")  # benchmark only
    .env({"HF_HOME": "/models/hf", "TFHUB_CACHE_DIR": "/models/tfhub",
          "TF_CPP_MIN_LOG_LEVEL": "2", "PYTHONUNBUFFERED": "1", "GPU_TYPE": GPU})
    .add_local_python_source("sermon_media", "bench")
)


Request = None  # replaced inside the web container
with web_image.imports():
    from fastapi import Request


def _logging():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    for noisy in ("urllib3", "httpx", "nemo_logger"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


@app.cls(
    image=gpu_image, gpu=GPU, secrets=[secret], volumes={"/models": models},
    max_containers=MAX_GPU_CONTAINERS, min_containers=0, scaledown_window=SCALEDOWN,
    timeout=TRANSCRIBE_TIMEOUT,
)
class Transcriber:
    @modal.enter()
    def load(self):
        _logging()
        from sermon_media.audio_events import Yamnet
        from sermon_media.engines import EngineSet
        from sermon_media.jobs import _env_bool

        self.engines = EngineSet(os.environ.get("ASR_ENGINE", "parakeet"),
                                 os.environ.get("ASR_FALLBACK_ENGINE", "faster_whisper"))
        self.engines.warm()  # failure is recorded; jobs then use the fallback
        self.events = None
        if _env_bool("AUDIO_EVENTS", True):
            try:
                self.events = Yamnet()
            except Exception as e:  # noqa: BLE001 - events are optional
                logging.getLogger("sermon_media").warning("YAMNet unavailable: %s", type(e).__name__)
        models.commit()  # persist first-time model downloads

    @modal.method()
    def transcribe_job(self, job: dict) -> str:
        from sermon_media.jobs import run_transcribe

        return run_transcribe(job, engines=self.engines, events_detector=self.events)


@app.function(
    image=render_image, cpu=4.0, memory=4096, secrets=[secret],
    max_containers=MAX_RENDER_CONTAINERS, min_containers=0, scaledown_window=SCALEDOWN,
    timeout=RENDER_TIMEOUT,
)
def render_job(job: dict) -> str:
    _logging()
    from sermon_media.jobs import run_render

    return run_render(job)


@app.function(image=web_image, min_containers=0, scaledown_window=SCALEDOWN)
@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
async def submit(request: Request):
    """Dashboard hand-off: validate, spawn, return {call_id}. Never echoes the body."""
    from fastapi.responses import JSONResponse

    from sermon_media.jobs import validate_submit

    try:
        job = validate_submit(await request.json())
    except ValueError as e:
        return JSONResponse({"error": "invalid_body", "detail": str(e)}, status_code=422)
    except Exception:  # noqa: BLE001 - malformed JSON
        return JSONResponse({"error": "invalid_body"}, status_code=400)
    if job["kind"] == "transcribe":
        call = await Transcriber().transcribe_job.spawn.aio(job)
    else:
        call = await render_job.spawn.aio(job)
    return {"call_id": call.object_id}


# ---------------------------------------------------------------- benchmark on one L4

@app.function(image=gpu_image, gpu=GPU, volumes={"/models": models, "/data": bench_data},
              timeout=4 * 3600, max_containers=1)
def bench_l4(paths: list, engines: list, terms_path=None, references=None) -> dict:
    _logging()
    from bench.benchmark import run_benchmark

    terms = []
    if terms_path:
        terms = [l.strip() for l in open(terms_path, encoding="utf-8") if l.strip()]
    report = run_benchmark(paths, engines, terms, references or [], out_dir="/data/bench-out")
    with open("/data/bench-out/report.json", "w") as f:
        json.dump(report, f, indent=2)
    bench_data.commit()
    models.commit()
    return report


@app.local_entrypoint()
def benchmark(paths: str, engines: str = "parakeet,faster_whisper", terms: str = "",
              references: str = ""):
    """paths/references: comma-separated paths inside the bench Volume (mounted at /data)."""
    report = bench_l4.remote(paths.split(","), engines.split(","), terms or None,
                             references.split(",") if references else None)
    print(json.dumps(report, indent=2))
