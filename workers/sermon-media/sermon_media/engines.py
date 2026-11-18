"""ASR engine adapters with a common output and lazy heavy imports.

`transcribe(audio, language)` takes float32 16 kHz mono samples and returns
{"language": str|None, "words": [{"w","s","e","p"?}], "segments": [{"s","e","text","p"?}]}
with times relative to the start of `audio`.
"""
from __future__ import annotations

import logging
import os
import tempfile

SR = 16000
log = logging.getLogger("sermon_media")

# nvidia/parakeet-tdt-0.6b-v3 model card: 25 European languages.
PARAKEET_LANGS = frozenset(
    "bg hr cs da nl en et fi fr de el hu it lv lt mt pl pt ro sk sl es sv ru uk".split()
)


class ParakeetEngine:
    name = "parakeet-tdt-0.6b-v3"
    languages = PARAKEET_LANGS

    def __init__(self, model_id: str = "nvidia/parakeet-tdt-0.6b-v3", device: str = "cuda",
                 full_attention_max_sec: float | None = None):
        import nemo.collections.asr as nemo_asr  # heavy; GPU image only

        self.model = nemo_asr.models.ASRModel.from_pretrained(model_id).to(device).eval()
        # Full attention is quadratic in window length: a 20 min window needs ~31 GB,
        # more than an L4's 24 GB (measured OOM on a real 82 min service). The model
        # card's 24 min figure is for an 80 GB A100. Default to NVIDIA's long-form
        # local attention for every window; set PARAKEET_FULL_ATTENTION_MAX_SEC to
        # allow full attention for windows up to that length on a larger GPU.
        if full_attention_max_sec is None:
            full_attention_max_sec = float(os.environ.get("PARAKEET_FULL_ATTENTION_MAX_SEC", "0"))
        self.full_attention_max_sec = full_attention_max_sec
        self._local_attention = False
        self._confidence = False
        if os.environ.get("PARAKEET_WORD_CONFIDENCE", "true").lower() == "false":
            return
        try:  # per-word confidence (optional; falls back to no `p`)
            from omegaconf import open_dict

            cfg = self.model.cfg.decoding
            with open_dict(cfg):
                cfg.confidence_cfg = {"preserve_word_confidence": True,
                                      "preserve_token_confidence": True,
                                      "aggregation": "min", "exclude_blank": True,
                                      "method_cfg": {"name": "entropy", "entropy_type": "tsallis",
                                                     "alpha": 0.5, "entropy_norm": "exp"}}
            self.model.change_decoding_strategy(cfg)
            self._confidence = True
        except Exception as e:  # noqa: BLE001
            log.warning("parakeet word confidence unavailable: %s", type(e).__name__)

    def _disable_confidence(self) -> None:
        """NeMo's word-confidence aggregation can fail on real long-form audio
        (word/token count mismatch). Confidence only feeds the `uncertain` flag,
        so drop it for the rest of this container rather than fail the job."""
        from omegaconf import open_dict

        cfg = self.model.cfg.decoding
        with open_dict(cfg):
            cfg.confidence_cfg = {"preserve_word_confidence": False, "preserve_token_confidence": False}
        self.model.change_decoding_strategy(cfg)
        self._confidence = False
        log.warning("parakeet word confidence disabled after an aggregation error")

    def transcribe(self, audio, language: str | None = None) -> dict:
        from .timeline import write_wav

        if len(audio) / SR > self.full_attention_max_sec and not self._local_attention:
            self.model.change_attention_model("rel_pos_local_attn", [256, 256])
            self._local_attention = True
        with tempfile.TemporaryDirectory() as d:
            path = write_wav(os.path.join(d, "w.wav"), audio)
            try:
                out = self.model.transcribe([path], timestamps=True, batch_size=1, return_hypotheses=True)
            except RuntimeError as e:
                if not self._confidence or "confidence" not in str(e).lower():
                    raise
                self._disable_confidence()
                out = self.model.transcribe([path], timestamps=True, batch_size=1, return_hypotheses=True)
        if isinstance(out, tuple):
            out = out[0]
        hyp = out[0]
        ts = getattr(hyp, "timestamp", None) or {}
        conf = list(getattr(hyp, "word_confidence", None) or [])
        raw_words = ts.get("word", [])
        words = []
        for i, w in enumerate(raw_words):
            item = {"w": w.get("word", ""), "s": float(w["start"]), "e": float(w["end"])}
            if len(conf) == len(raw_words):
                item["p"] = float(conf[i])
            words.append(item)
        segments = [{"s": float(s["start"]), "e": float(s["end"]), "text": s.get("segment", "")}
                    for s in ts.get("segment", [])]
        return {"language": language, "words": words, "segments": segments}


class FasterWhisperEngine:
    name = "faster-whisper-large-v3-turbo"
    languages = None  # multilingual

    def __init__(self, model_id: str = "large-v3-turbo", device: str = "cuda",
                 compute_type: str = "float16", batch_size: int = 16):
        from faster_whisper import BatchedInferencePipeline, WhisperModel

        self.model = WhisperModel(model_id, device=device, compute_type=compute_type)
        self.pipe = BatchedInferencePipeline(model=self.model)
        self.batch_size = batch_size

    def transcribe(self, audio, language: str | None = None) -> dict:
        segs, info = self.pipe.transcribe(audio, language=language, batch_size=self.batch_size,
                                          word_timestamps=True, vad_filter=True)
        words, segments = [], []
        for seg in segs:
            segments.append({"s": seg.start, "e": seg.end, "text": seg.text.strip()})
            for w in seg.words or []:
                words.append({"w": w.word.strip(), "s": w.start, "e": w.end, "p": w.probability})
        return {"language": info.language, "words": words, "segments": segments}

    def detect_language(self, audio) -> tuple[str, float]:
        lang, prob, _ = self.model.detect_language(audio)
        return lang, prob


class LanguageDetector:
    """Small faster-whisper model used only for language ID when the job says "auto"."""

    def __init__(self, model_id: str = "small", device: str = "cuda", compute_type: str = "int8_float16"):
        from faster_whisper import WhisperModel

        self.model = WhisperModel(model_id, device=device, compute_type=compute_type)

    def detect(self, audio) -> tuple[str, float]:
        lang, prob, _ = self.model.detect_language(audio)
        return lang, prob


ENGINES = {"parakeet": ParakeetEngine, "faster_whisper": FasterWhisperEngine}


class EngineSet:
    """Loads the primary engine once per container; the fallback and language detector
    load lazily on first need. Selection rules:
      * primary parakeet + language outside PARAKEET_LANGS -> fallback
      * primary failed to load -> fallback
    """

    def __init__(self, primary: str = "parakeet", fallback: str | None = "faster_whisper",
                 device: str = "cuda", factories: dict | None = None, detector_factory=None):
        self.primary_name = primary
        self.fallback_name = fallback if fallback and fallback != primary else None
        self.device = device
        self.factories = factories or ENGINES
        self.detector_factory = detector_factory or (lambda: LanguageDetector(
            os.environ.get("LANGID_MODEL", "small"), device=device))
        self._loaded: dict[str, object] = {}
        self._failed: set[str] = set()
        self._detector = None

    def _get(self, name: str):
        if name in self._failed:
            return None
        if name not in self._loaded:
            try:
                self._loaded[name] = self.factories[name](device=self.device)
            except Exception as e:  # noqa: BLE001
                log.error("engine %s failed to load: %s", name, type(e).__name__)
                self._failed.add(name)
                return None
        return self._loaded[name]

    def warm(self) -> None:
        self._get(self.primary_name)

    def detect_language(self, audio) -> str | None:
        try:
            if self._detector is None:
                self._detector = self.detector_factory()
            lang, _ = self._detector.detect(audio)
            return lang
        except Exception as e:  # noqa: BLE001
            log.warning("language detection failed: %s", type(e).__name__)
            return None

    def choose(self, language: str | None):
        """Return (engine, reason). Raises RuntimeError when nothing can load."""
        primary_ok = True
        langs = getattr(self.factories.get(self.primary_name), "languages", None)
        if language and langs is not None and language not in langs:
            primary_ok = False
            reason = f"language {language} not supported by primary"
        else:
            reason = "primary"
        if primary_ok:
            eng = self._get(self.primary_name)
            if eng is not None:
                return eng, reason
            reason = "primary failed to load"
        if self.fallback_name:
            eng = self._get(self.fallback_name)
            if eng is not None:
                return eng, f"fallback ({reason})"
        raise RuntimeError("no ASR engine available")
