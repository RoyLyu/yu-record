"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  convertRecording,
  getOutputMimeType,
  OUTPUT_FORMAT_LABELS,
  type OutputFormat,
} from "@/lib/media-export";

type RecorderState = "idle" | "recording" | "paused" | "processing";
type PromptMode = "speech" | "manual";
type PromptPosition = "top" | "center" | "bottom";
type CameraPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";
type CameraShape = "rounded" | "circle";
type QualityPreset = "source" | "2160p" | "1080p";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike extends Event {
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

interface StudioSettings {
  quality: QualityPreset;
  fps: 30 | 60;
  bitrate: 20 | 40 | 60;
  outputFormat: OutputFormat;
  promptMode: PromptMode;
  promptPosition: PromptPosition;
  promptFontSize: number;
  promptColor: string;
  promptBackground: number;
  promptSpeed: number;
  promptWidth: number;
  promptHeight: number;
  promptInRecording: boolean;
  cameraPosition: CameraPosition;
  cameraShape: CameraShape;
  cameraSize: number;
  mirrorCamera: boolean;
  enhancePicture: boolean;
}

const DEFAULT_SETTINGS: StudioSettings = {
  quality: "source",
  fps: 60,
  bitrate: 40,
  outputFormat: "webm",
  promptMode: "speech",
  promptPosition: "center",
  promptFontSize: 42,
  promptColor: "#ffffff",
  promptBackground: 58,
  promptSpeed: 38,
  promptWidth: 78,
  promptHeight: 34,
  promptInRecording: true,
  cameraPosition: "bottom-right",
  cameraShape: "rounded",
  cameraSize: 20,
  mirrorCamera: true,
  enhancePicture: true,
};

const STORAGE_KEY = "yu-record-studio-v1";
const PUNCTUATION_RE =
  /[\s\u3000，。！？；：、“”‘’（）《》【】…—,.!?;:'"()[\]{}<>_\-]/g;

function normalizeSpeech(value: string) {
  return value.toLocaleLowerCase().replace(PUNCTUATION_RE, "");
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function selectMimeType(audioOnly = false) {
  const candidates = audioOnly
    ? ["audio/webm;codecs=opus", "audio/webm"]
    : [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function drawCover(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
  y: number,
  width: number,
  height: number,
  contain = false,
) {
  const sourceWidth = video.videoWidth || 16;
  const sourceHeight = video.videoHeight || 9;
  const scale = contain
    ? Math.min(width / sourceWidth, height / sourceHeight)
    : Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;

  context.drawImage(video, drawX, drawY, drawWidth, drawHeight);
}

function roundedRectanglePath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.roundRect(x, y, width, height, safeRadius);
}

function wrapPromptText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  const lines: string[] = [];
  const paragraphs = text.replace(/\r/g, "").split("\n");

  paragraphs.forEach((paragraph) => {
    if (!paragraph.trim()) {
      lines.push("");
      return;
    }

    const usesSpaces = paragraph.includes(" ");
    const units = usesSpaces
      ? paragraph.split(/(\s+)/).filter(Boolean)
      : Array.from(paragraph);
    let currentLine = "";

    units.forEach((unit) => {
      const candidate = currentLine + unit;
      if (currentLine && context.measureText(candidate).width > maxWidth) {
        lines.push(currentLine.trim());
        currentLine = unit.trimStart();
      } else {
        currentLine = candidate;
      }
    });

    if (currentLine) {
      lines.push(currentLine.trim());
    }
  });

  return lines;
}

function findSpeechProgress(script: string, spoken: string, currentProgress: number) {
  const normalizedScript = normalizeSpeech(script);
  const normalizedSpoken = normalizeSpeech(spoken);

  if (!normalizedScript || normalizedSpoken.length < 2) {
    return currentProgress;
  }

  const currentIndex = Math.floor(currentProgress * normalizedScript.length);
  const searchStart = Math.max(0, currentIndex - 20);
  const maximumMatchLength = Math.min(28, normalizedSpoken.length);

  for (let length = maximumMatchLength; length >= 2; length -= 1) {
    const phrase = normalizedSpoken.slice(-length);
    const nearbyIndex = normalizedScript.indexOf(phrase, searchStart);

    if (nearbyIndex >= 0) {
      const nextProgress = (nearbyIndex + length) / normalizedScript.length;
      return Math.max(currentProgress, Math.min(1, nextProgress));
    }
  }

  return currentProgress;
}

function getDownloadName(format: OutputFormat) {
  const stamp = new Date()
    .toISOString()
    .replace("T", "_")
    .replaceAll(":", "-")
    .slice(0, 19);
  return `屿录_${stamp}.${format}`;
}

export function RecorderStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const promptOverlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const previousFrameTimeRef = useRef(0);
  const promptOffsetRef = useRef(0);
  const maximumPromptOffsetRef = useRef(0);
  const promptProgressRef = useRef(0);
  const promptRunningRef = useRef(false);
  const promptLayoutCacheRef = useRef<{
    script: string;
    fontSize: number;
    maxWidth: number;
    lines: string[];
  }>({ script: "", fontSize: 0, maxWidth: 0, lines: [] });
  const scriptRef = useRef("");
  const settingsRef = useRef<StudioSettings>(DEFAULT_SETTINGS);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speechShouldRunRef = useRef(false);
  const speechHistoryRef = useRef("");
  const currentSpeechSessionRef = useRef("");
  const recordingUrlRef = useRef<string | null>(null);
  const progressUiFrameRef = useRef(0);

  const [settings, setSettings] = useState<StudioSettings>(DEFAULT_SETTINGS);
  const [script, setScript] = useState("");
  const [screenReady, setScreenReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [promptRunning, setPromptRunning] = useState(false);
  const [promptProgress, setPromptProgress] = useState(0);
  const [speechActive, setSpeechActive] = useState(false);
  const [spokenPreview, setSpokenPreview] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [notice, setNotice] = useState(
    "先选择屏幕或开启摄像头，再开始录制。",
  );
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingSize, setRecordingSize] = useState("");
  const [recordingFormat, setRecordingFormat] =
    useState<OutputFormat>("webm");
  const [outputResolution, setOutputResolution] = useState([1920, 1080]);

  const hasVisualSource = screenReady || cameraReady;
  const canStartRecording =
    settings.outputFormat === "wav"
      ? microphoneReady ||
        Boolean(screenStreamRef.current?.getAudioTracks().length)
      : hasVisualSource;
  const isRecordingLocked =
    recorderState === "recording" ||
    recorderState === "paused" ||
    recorderState === "processing" ||
    countdown !== null;

  const updateSettings = useCallback(
    <Key extends keyof StudioSettings>(key: Key, value: StudioSettings[Key]) => {
      setSettings((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const setCanvasResolution = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || isRecordingLocked) {
      return;
    }

    const sourceSettings =
      screenStreamRef.current?.getVideoTracks()[0]?.getSettings() ??
      cameraStreamRef.current?.getVideoTracks()[0]?.getSettings();
    let width = sourceSettings?.width ?? 1920;
    let height = sourceSettings?.height ?? 1080;

    if (settings.quality === "2160p") {
      width = 3840;
      height = 2160;
    } else if (settings.quality === "1080p") {
      width = 1920;
      height = 1080;
    }

    canvas.width = Math.max(2, Math.floor(width / 2) * 2);
    canvas.height = Math.max(2, Math.floor(height / 2) * 2);
    setOutputResolution([canvas.width, canvas.height]);
  }, [isRecordingLocked, settings.quality]);

  const syncPromptProgress = useCallback((progress: number) => {
    const safeProgress = Math.max(0, Math.min(1, progress));
    promptProgressRef.current = safeProgress;
    promptOffsetRef.current = safeProgress * maximumPromptOffsetRef.current;
    setPromptProgress(Math.round(safeProgress * 100));
  }, []);

  const stopSpeechRecognition = useCallback(() => {
    speechShouldRunRef.current = false;
    setSpeechActive(false);
    const recognition = recognitionRef.current;
    recognitionRef.current = null;

    if (recognition) {
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      try {
        recognition.stop();
      } catch {
        recognition.abort();
      }
    }
  }, []);

  const startSpeechRecognition = useCallback(() => {
    const Recognition =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!Recognition) {
      setSpeechActive(false);
      setNotice(
        "当前浏览器不支持语音跟随，已保留手动匀速滚屏。建议使用最新版 Chrome。",
      );
      return false;
    }

    stopSpeechRecognition();
    speechShouldRunRef.current = true;
    speechHistoryRef.current = "";
    currentSpeechSessionRef.current = "";

    const createRecognition = () => {
      if (!speechShouldRunRef.current) {
        return;
      }

      const recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "zh-CN";

      recognition.onresult = (event) => {
        let currentSession = "";
        for (let index = 0; index < event.results.length; index += 1) {
          currentSession += event.results[index][0]?.transcript ?? "";
        }

        currentSpeechSessionRef.current = currentSession;
        const fullSpeech = speechHistoryRef.current + currentSession;
        const nextProgress = findSpeechProgress(
          scriptRef.current,
          fullSpeech,
          promptProgressRef.current,
        );

        promptProgressRef.current = nextProgress;
        promptOffsetRef.current =
          nextProgress * maximumPromptOffsetRef.current;
        setPromptProgress(Math.round(nextProgress * 100));
        setSpokenPreview(currentSession.slice(-28));
      };

      recognition.onerror = (event) => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          speechShouldRunRef.current = false;
          setSpeechActive(false);
          setNotice(
            "语音识别权限未开启。你仍可切换到匀速模式，或在 Chrome 设置中允许麦克风。",
          );
        }
      };

      recognition.onend = () => {
        speechHistoryRef.current += currentSpeechSessionRef.current;
        currentSpeechSessionRef.current = "";
        if (speechShouldRunRef.current) {
          window.setTimeout(createRecognition, 250);
        }
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
        setSpeechActive(true);
        setNotice("语音跟随已启动；说到文案中的词句时，提词器会自动前进。");
      } catch {
        setSpeechActive(false);
        setNotice("语音跟随启动失败，请切换到匀速模式继续使用。");
      }
    };

    createRecognition();
    return true;
  }, [stopSpeechRecognition]);

  const startPrompt = useCallback(() => {
    if (!script.trim()) {
      setNotice("请先输入提词文案。");
      return;
    }

    promptRunningRef.current = true;
    setPromptRunning(true);

    if (settingsRef.current.promptMode === "speech") {
      startSpeechRecognition();
    } else {
      setNotice("匀速滚屏已启动，可随时拖动进度或调整速度。");
    }
  }, [script, startSpeechRecognition]);

  const stopPrompt = useCallback(() => {
    promptRunningRef.current = false;
    setPromptRunning(false);
    stopSpeechRecognition();
  }, [stopSpeechRecognition]);

  useEffect(() => {
    scriptRef.current = script;
  }, [script]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    promptRunningRef.current = promptRunning;
  }, [promptRunning]);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      try {
        const parsed = JSON.parse(saved) as {
          script?: string;
          settings?: Partial<StudioSettings>;
        };
        setScript(parsed.script ?? "");
        setSettings((current) => ({ ...current, ...parsed.settings }));
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ script, settings }),
      );
    }, 200);

    return () => window.clearTimeout(timer);
  }, [script, settings]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(setCanvasResolution);
    return () => window.cancelAnimationFrame(frame);
  }, [cameraReady, screenReady, setCanvasResolution]);

  useEffect(() => {
    if (recorderState !== "recording") {
      return;
    }

    const timer = window.setInterval(() => {
      setElapsedSeconds((seconds) => seconds + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [recorderState]);

  useEffect(() => {
    const drawFrame = (timestamp: number) => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      const promptOverlayCanvas = promptOverlayCanvasRef.current;
      const promptOverlayContext = promptOverlayCanvas?.getContext("2d");

      if (!canvas || !context) {
        animationFrameRef.current = requestAnimationFrame(drawFrame);
        return;
      }

      const width = canvas.width;
      const height = canvas.height;
      if (
        promptOverlayCanvas &&
        (promptOverlayCanvas.width !== width ||
          promptOverlayCanvas.height !== height)
      ) {
        promptOverlayCanvas.width = width;
        promptOverlayCanvas.height = height;
      }
      promptOverlayContext?.clearRect(0, 0, width, height);
      const settingsSnapshot = settingsRef.current;
      const screenVideo = screenVideoRef.current;
      const cameraVideo = cameraVideoRef.current;
      const hasScreen =
        Boolean(screenVideo?.srcObject) && (screenVideo?.readyState ?? 0) >= 2;
      const hasCamera =
        Boolean(cameraVideo?.srcObject) && (cameraVideo?.readyState ?? 0) >= 2;

      context.save();
      context.fillStyle = "#07090d";
      context.fillRect(0, 0, width, height);

      if (settingsSnapshot.enhancePicture) {
        context.filter = "brightness(1.015) contrast(1.035) saturate(1.04)";
      }

      if (hasScreen && screenVideo) {
        drawCover(context, screenVideo, 0, 0, width, height, true);
      } else if (hasCamera && cameraVideo) {
        drawCover(context, cameraVideo, 0, 0, width, height);
      } else {
        const gradient = context.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, "#151922");
        gradient.addColorStop(1, "#07090d");
        context.fillStyle = gradient;
        context.fillRect(0, 0, width, height);
      }

      context.filter = "none";
      context.restore();

      if (hasScreen && hasCamera && cameraVideo) {
        const cameraWidth = width * (settingsSnapshot.cameraSize / 100);
        const isCircle = settingsSnapshot.cameraShape === "circle";
        const sourceRatio =
          cameraVideo.videoWidth && cameraVideo.videoHeight
            ? cameraVideo.videoWidth / cameraVideo.videoHeight
            : 16 / 9;
        const cameraHeight = isCircle ? cameraWidth : cameraWidth / sourceRatio;
        const margin = width * 0.025;
        const isRight = settingsSnapshot.cameraPosition.endsWith("right");
        const isBottom = settingsSnapshot.cameraPosition.startsWith("bottom");
        const x = isRight ? width - cameraWidth - margin : margin;
        const y = isBottom ? height - cameraHeight - margin : margin;

        context.save();
        context.shadowColor = "rgba(0, 0, 0, 0.48)";
        context.shadowBlur = width * 0.012;
        context.shadowOffsetY = width * 0.004;

        if (isCircle) {
          context.beginPath();
          context.arc(
            x + cameraWidth / 2,
            y + cameraHeight / 2,
            cameraWidth / 2,
            0,
            Math.PI * 2,
          );
        } else {
          roundedRectanglePath(
            context,
            x,
            y,
            cameraWidth,
            cameraHeight,
            width * 0.012,
          );
        }

        context.fillStyle = "#11151d";
        context.fill();
        context.clip();
        context.shadowColor = "transparent";

        if (settingsSnapshot.mirrorCamera) {
          context.translate(x + cameraWidth, y);
          context.scale(-1, 1);
          drawCover(
            context,
            cameraVideo,
            0,
            0,
            cameraWidth,
            cameraHeight,
          );
        } else {
          drawCover(
            context,
            cameraVideo,
            x,
            y,
            cameraWidth,
            cameraHeight,
          );
        }

        context.restore();
        context.save();
        context.strokeStyle = "rgba(255, 255, 255, 0.74)";
        context.lineWidth = Math.max(2, width * 0.0013);
        if (isCircle) {
          context.beginPath();
          context.arc(
            x + cameraWidth / 2,
            y + cameraHeight / 2,
            cameraWidth / 2,
            0,
            Math.PI * 2,
          );
        } else {
          roundedRectanglePath(
            context,
            x,
            y,
            cameraWidth,
            cameraHeight,
            width * 0.012,
          );
        }
        context.stroke();
        context.restore();
      }

      if (promptRunningRef.current && scriptRef.current.trim()) {
        const promptContext = settingsSnapshot.promptInRecording
          ? context
          : promptOverlayContext;
        if (!promptContext) {
          previousFrameTimeRef.current = timestamp;
          animationFrameRef.current = requestAnimationFrame(drawFrame);
          return;
        }
        const scale = height / 1080;
        const fontSize = settingsSnapshot.promptFontSize * scale;
        const lineHeight = fontSize * 1.48;
        const promptWidth = width * (settingsSnapshot.promptWidth / 100);
        const promptX = (width - promptWidth) / 2;
        const promptHeight =
          height * (settingsSnapshot.promptHeight / 100);
        const promptY =
          settingsSnapshot.promptPosition === "top"
            ? height * 0.055
            : settingsSnapshot.promptPosition === "bottom"
              ? height - promptHeight - height * 0.055
              : (height - promptHeight) / 2;

        promptContext.save();
        promptContext.font = `700 ${fontSize}px "Noto Sans SC", "PingFang SC", sans-serif`;
        promptContext.textBaseline = "middle";
        promptContext.textAlign = "center";
        const maximumLineWidth = promptWidth * 0.88;
        const cachedLayout = promptLayoutCacheRef.current;
        let lines = cachedLayout.lines;

        if (
          cachedLayout.script !== scriptRef.current ||
          cachedLayout.fontSize !== fontSize ||
          cachedLayout.maxWidth !== maximumLineWidth
        ) {
          lines = wrapPromptText(
            promptContext,
            scriptRef.current,
            maximumLineWidth,
          );
          promptLayoutCacheRef.current = {
            script: scriptRef.current,
            fontSize,
            maxWidth: maximumLineWidth,
            lines,
          };
        }
        const totalTextHeight = lines.length * lineHeight;
        const maximumOffset = Math.max(
          0,
          totalTextHeight - promptHeight * 0.58,
        );
        maximumPromptOffsetRef.current = maximumOffset;

        if (settingsSnapshot.promptMode === "manual") {
          const previousTimestamp = previousFrameTimeRef.current || timestamp;
          const deltaSeconds = Math.min(
            0.1,
            (timestamp - previousTimestamp) / 1000,
          );
          promptOffsetRef.current = Math.min(
            maximumOffset,
            promptOffsetRef.current +
              settingsSnapshot.promptSpeed * scale * deltaSeconds,
          );
          promptProgressRef.current =
            maximumOffset > 0 ? promptOffsetRef.current / maximumOffset : 0;
        } else {
          promptOffsetRef.current =
            promptProgressRef.current * maximumOffset;
        }

        const backgroundAlpha = settingsSnapshot.promptBackground / 100;
        const gradient = promptContext.createLinearGradient(
          0,
          promptY,
          0,
          promptY + promptHeight,
        );
        gradient.addColorStop(0, `rgba(5, 7, 11, ${backgroundAlpha * 0.12})`);
        gradient.addColorStop(
          0.18,
          `rgba(5, 7, 11, ${backgroundAlpha * 0.92})`,
        );
        gradient.addColorStop(
          0.82,
          `rgba(5, 7, 11, ${backgroundAlpha * 0.92})`,
        );
        gradient.addColorStop(1, `rgba(5, 7, 11, ${backgroundAlpha * 0.12})`);
        promptContext.fillStyle = gradient;
        roundedRectanglePath(
          promptContext,
          promptX,
          promptY,
          promptWidth,
          promptHeight,
          width * 0.012,
        );
        promptContext.fill();
        promptContext.clip();

        const firstLineY =
          promptY + promptHeight * 0.47 - promptOffsetRef.current;
        promptContext.fillStyle = settingsSnapshot.promptColor;
        promptContext.shadowColor = "rgba(0, 0, 0, 0.78)";
        promptContext.shadowBlur = fontSize * 0.26;
        promptContext.shadowOffsetY = fontSize * 0.08;

        lines.forEach((line, index) => {
          const lineY = firstLineY + index * lineHeight;
          if (
            lineY > promptY - lineHeight &&
            lineY < promptY + promptHeight + lineHeight
          ) {
            promptContext.fillText(
              line || " ",
              promptX + promptWidth / 2,
              lineY,
            );
          }
        });
        promptContext.restore();

        if (
          timestamp - progressUiFrameRef.current > 180 &&
          settingsSnapshot.promptMode === "manual"
        ) {
          progressUiFrameRef.current = timestamp;
          setPromptProgress(Math.round(promptProgressRef.current * 100));
        }
      }

      previousFrameTimeRef.current = timestamp;
      animationFrameRef.current = requestAnimationFrame(drawFrame);
    };

    animationFrameRef.current = requestAnimationFrame(drawFrame);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      stopStream(screenStreamRef.current);
      stopStream(cameraStreamRef.current);
      stopStream(microphoneStreamRef.current);
      stopStream(recorderStreamRef.current);
      stopSpeechRecognition();
      if (recordingUrlRef.current) {
        URL.revokeObjectURL(recordingUrlRef.current);
      }
    };
  }, [stopSpeechRecognition]);

  const chooseScreen = async () => {
    if (isRecordingLocked) {
      return;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setNotice("当前浏览器不支持屏幕采集，请使用最新版 Chrome。");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: settings.fps, max: settings.fps },
        },
        audio: true,
      });
      stopStream(screenStreamRef.current);
      screenStreamRef.current = stream;
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream;
        await screenVideoRef.current.play();
      }

      stream.getVideoTracks()[0]?.addEventListener(
        "ended",
        () => {
          setScreenReady(false);
          screenStreamRef.current = null;
          setNotice("屏幕共享已停止。");
        },
        { once: true },
      );
      setScreenReady(true);
      setNotice(
        stream.getAudioTracks().length
          ? "屏幕已接入，系统声音也会进入录制。"
          : "屏幕已接入；本次未共享系统声音。",
      );
      window.setTimeout(setCanvasResolution, 80);
    } catch (error) {
      if ((error as DOMException).name !== "NotAllowedError") {
        setNotice("无法读取屏幕，请确认 Chrome 已获得屏幕录制权限。");
      }
    }
  };

  const toggleCamera = async () => {
    if (isRecordingLocked) {
      return;
    }

    if (cameraReady) {
      stopStream(cameraStreamRef.current);
      cameraStreamRef.current = null;
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = null;
      }
      setCameraReady(false);
      setNotice("摄像头已关闭。");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice("当前浏览器不支持摄像头采集，请使用最新版 Chrome。");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 3840 },
          height: { ideal: 2160 },
          frameRate: { ideal: settings.fps, max: settings.fps },
        },
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
        await cameraVideoRef.current.play();
      }
      setCameraReady(true);
      setNotice("摄像头已接入，可在右侧调整位置、大小和形状。");
      window.setTimeout(setCanvasResolution, 80);
    } catch {
      setNotice("无法打开摄像头，请检查浏览器权限或摄像头占用情况。");
    }
  };

  const toggleMicrophone = async () => {
    if (isRecordingLocked) {
      return;
    }

    if (microphoneReady) {
      stopStream(microphoneStreamRef.current);
      microphoneStreamRef.current = null;
      setMicrophoneReady(false);
      setNotice("麦克风已关闭。");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice("当前浏览器不支持麦克风采集，请使用最新版 Chrome。");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      microphoneStreamRef.current = stream;
      setMicrophoneReady(true);
      setNotice("麦克风已接入，并启用了回声消除与降噪。");
    } catch {
      setNotice("无法打开麦克风，请检查浏览器权限。");
    }
  };

  const startRecording = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !canStartRecording || isRecordingLocked) {
      setNotice(
        settings.outputFormat === "wav"
          ? "WAV 需要声音，请先开启麦克风或共享系统声音。"
          : "请先选择屏幕或开启摄像头。",
      );
      return;
    }

    if (!window.MediaRecorder) {
      setNotice("当前浏览器不支持本地视频录制，请使用最新版 Chrome。");
      return;
    }

    setRecordingUrl(null);
    setRecordingSize("");
    setRecordingFormat(settings.outputFormat);
    if (recordingUrlRef.current) {
      URL.revokeObjectURL(recordingUrlRef.current);
      recordingUrlRef.current = null;
    }

    for (let value = 3; value >= 1; value -= 1) {
      setCountdown(value);
      await new Promise((resolve) => window.setTimeout(resolve, 650));
    }
    setCountdown(null);

    if (
      settings.outputFormat !== "wav" &&
      !screenStreamRef.current &&
      !cameraStreamRef.current
    ) {
      setNotice("采集源在倒计时期间已断开，请重新选择画面。");
      return;
    }

    try {
      const isAudioOnly = settings.outputFormat === "wav";
      const canvasStream = isAudioOnly
        ? null
        : canvas.captureStream(settings.fps);
      const audioTracks = [
        ...(screenStreamRef.current?.getAudioTracks() ?? []),
        ...(microphoneStreamRef.current?.getAudioTracks() ?? []),
      ];
      if (isAudioOnly && audioTracks.length === 0) {
        setRecorderState("idle");
        setNotice("WAV 需要声音，请开启麦克风或在共享屏幕时勾选系统声音。");
        return;
      }
      let mixedAudioTracks: MediaStreamTrack[] = [];

      if (audioTracks.length > 0) {
        const audioContext = new AudioContext();
        await audioContext.resume();
        const destination = audioContext.createMediaStreamDestination();

        audioTracks.forEach((track) => {
          const source = audioContext.createMediaStreamSource(
            new MediaStream([track]),
          );
          source.connect(destination);
        });

        audioContextRef.current = audioContext;
        mixedAudioTracks = destination.stream.getAudioTracks();
      }

      const recordingStream = new MediaStream([
        ...(canvasStream?.getVideoTracks() ?? []),
        ...mixedAudioTracks,
      ]);
      const mimeType = selectMimeType(isAudioOnly);
      const recorder = new MediaRecorder(recordingStream, {
        ...(mimeType ? { mimeType } : {}),
        ...(isAudioOnly
          ? { audioBitsPerSecond: 320_000 }
          : {
              videoBitsPerSecond: settings.bitrate * 1_000_000,
              audioBitsPerSecond: 320_000,
            }),
      });

      recordedChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        setNotice("录制器遇到错误，请停止录制后重试。");
      };
      recorder.onstop = async () => {
        const sourceBlob = new Blob(recordedChunksRef.current, {
          type: recorder.mimeType || "video/webm",
        });
        const outputFormat = settings.outputFormat;

        try {
          setNotice(
            outputFormat === "webm"
              ? "正在整理 WebM 文件…"
              : `正在本地生成 ${outputFormat.toUpperCase()}，请保持页面打开…`,
          );
          const blob = await convertRecording(sourceBlob, {
            format: outputFormat,
            videoBitrate: settings.bitrate * 1_000_000,
            onProgress: (progress) => {
              setNotice(
                `正在本地生成 ${outputFormat.toUpperCase()} · ${Math.round(progress * 100)}%`,
              );
            },
          });
          const url = URL.createObjectURL(blob);
          recordingUrlRef.current = url;
          setRecordingUrl(url);
          setRecordingFormat(outputFormat);
          setRecordingSize(`${(blob.size / 1024 / 1024).toFixed(1)} MB`);
          setNotice(
            `${outputFormat.toUpperCase()} 已生成，文件只保存在当前浏览器内，请下载到本地。`,
          );
        } catch {
          setNotice(
            `当前设备无法完成 ${outputFormat.toUpperCase()} 编码。请改用 WebM，或降低分辨率后重试。`,
          );
        } finally {
          setRecorderState("idle");
          stopStream(recorderStreamRef.current);
          recorderStreamRef.current = null;
          await audioContextRef.current?.close();
          audioContextRef.current = null;
        }
      };

      recorderRef.current = recorder;
      recorderStreamRef.current = recordingStream;
      recorder.start(1000);
      setElapsedSeconds(0);
      setRecorderState("recording");
      setNotice(
        settings.outputFormat === "wav"
          ? "正在录制 24-bit / 48 kHz WAV 音频。"
          : `正在以 ${canvas.width} × ${canvas.height}、${settings.fps}fps 录制 ${settings.outputFormat.toUpperCase()}。`,
      );

      if (script.trim() && !promptRunningRef.current) {
        startPrompt();
      }
    } catch {
      setRecorderState("idle");
      setNotice("无法开始录制，请降低清晰度或关闭其他占用摄像头的应用。");
    }
  };

  const pauseOrResumeRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder) {
      return;
    }

    if (recorderState === "recording") {
      recorder.pause();
      setRecorderState("paused");
      setNotice("录制已暂停。");
    } else if (recorderState === "paused") {
      recorder.resume();
      setRecorderState("recording");
      setNotice("录制已继续。");
    }
  };

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return;
    }

    setRecorderState("processing");
    stopPrompt();
    recorder.stop();
  };

  const handlePromptModeChange = (mode: PromptMode) => {
    updateSettings("promptMode", mode);
    if (!promptRunning) {
      return;
    }

    if (mode === "speech") {
      startSpeechRecognition();
    } else {
      stopSpeechRecognition();
      setNotice("已切换到匀速滚屏。");
    }
  };

  const handleScriptChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setScript(event.target.value);
    syncPromptProgress(0);
    speechHistoryRef.current = "";
    currentSpeechSessionRef.current = "";
  };

  const clearScript = () => {
    setScript("");
    stopPrompt();
    syncPromptProgress(0);
    setSpokenPreview("");
  };

  return (
    <main className="studio-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <span />
          </span>
          <span>
            <strong>屿录</strong>
            <small>Prompt Recorder</small>
          </span>
        </div>
        <div className="topbar-status">
          <span className="privacy-pill">
            <span className="status-dot safe" />
            本地处理 · 不上传素材
          </span>
          <span className="browser-pill">Chrome / macOS</span>
        </div>
      </header>

      <section className="workspace">
        <aside className="control-panel source-panel">
          <div className="panel-heading">
            <span className="eyebrow">01 · 输入源</span>
            <h2>准备画面</h2>
          </div>

          <div className="source-list">
            <button
              className={`source-button ${screenReady ? "active" : ""}`}
              type="button"
              onClick={chooseScreen}
              disabled={isRecordingLocked}
            >
              <span className="source-icon screen-icon" aria-hidden="true" />
              <span>
                <strong>{screenReady ? "更换屏幕" : "选择屏幕"}</strong>
                <small>{screenReady ? "已接入共享画面" : "窗口、标签页或全屏"}</small>
              </span>
              <span className={`status-dot ${screenReady ? "live" : ""}`} />
            </button>

            <button
              className={`source-button ${cameraReady ? "active" : ""}`}
              type="button"
              onClick={toggleCamera}
              disabled={isRecordingLocked}
            >
              <span className="source-icon camera-icon" aria-hidden="true" />
              <span>
                <strong>{cameraReady ? "关闭摄像头" : "开启摄像头"}</strong>
                <small>{cameraReady ? "已接入画中画" : "最高可请求 4K"}</small>
              </span>
              <span className={`status-dot ${cameraReady ? "live" : ""}`} />
            </button>

            <button
              className={`source-button ${microphoneReady ? "active" : ""}`}
              type="button"
              onClick={toggleMicrophone}
              disabled={isRecordingLocked}
            >
              <span className="source-icon mic-icon" aria-hidden="true" />
              <span>
                <strong>{microphoneReady ? "关闭麦克风" : "开启麦克风"}</strong>
                <small>{microphoneReady ? "降噪已开启" : "录制人声"}</small>
              </span>
              <span className={`status-dot ${microphoneReady ? "live" : ""}`} />
            </button>
          </div>

          <div className="divider" />

          <div className="panel-heading compact">
            <span className="eyebrow">02 · 录制参数</span>
            <h2>清晰度</h2>
          </div>

          <label className="field-label" htmlFor="quality">
            输出分辨率
          </label>
          <select
            id="quality"
            className="select-control"
            value={settings.quality}
            onChange={(event) =>
              updateSettings("quality", event.target.value as QualityPreset)
            }
            disabled={isRecordingLocked}
          >
            <option value="source">原始分辨率（推荐）</option>
            <option value="2160p">4K · 3840 × 2160</option>
            <option value="1080p">1080p · 1920 × 1080</option>
          </select>

          <label className="field-label output-format-label" htmlFor="output-format">
            文件格式
          </label>
          <select
            id="output-format"
            className="select-control"
            value={settings.outputFormat}
            onChange={(event) =>
              updateSettings(
                "outputFormat",
                event.target.value as OutputFormat,
              )
            }
            disabled={isRecordingLocked}
          >
            {Object.entries(OUTPUT_FORMAT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <div className="two-column-fields">
            <div>
              <label className="field-label" htmlFor="fps">
                帧率
              </label>
              <select
                id="fps"
                className="select-control"
                value={settings.fps}
                onChange={(event) =>
                  updateSettings("fps", Number(event.target.value) as 30 | 60)
                }
                disabled={isRecordingLocked}
              >
                <option value={60}>60 fps</option>
                <option value={30}>30 fps</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="bitrate">
                视频码率
              </label>
              <select
                id="bitrate"
                className="select-control"
                value={settings.bitrate}
                onChange={(event) =>
                  updateSettings(
                    "bitrate",
                    Number(event.target.value) as 20 | 40 | 60,
                  )
                }
                disabled={isRecordingLocked}
              >
                <option value={60}>60 Mbps</option>
                <option value={40}>40 Mbps</option>
                <option value={20}>20 Mbps</option>
              </select>
            </div>
          </div>

          <label className="toggle-row">
            <span>
              <strong>自然画面增强</strong>
              <small>轻微提升对比度与色彩</small>
            </span>
            <input
              type="checkbox"
              checked={settings.enhancePicture}
              onChange={(event) =>
                updateSettings("enhancePicture", event.target.checked)
              }
            />
            <span className="toggle-track" aria-hidden="true" />
          </label>

          <div className="quality-note">
            <span aria-hidden="true">i</span>
            <p>
              “原始分辨率”会跟随共享源尺寸。实际画质仍受屏幕、摄像头和浏览器编码器限制。
            </p>
          </div>
        </aside>

        <section className="stage-column">
          <div className="stage-card">
            <div className="stage-toolbar">
              <div>
                <span className="stage-title">实时合成预览</span>
                <span className="resolution-readout">
                  {outputResolution[0]} × {outputResolution[1]}
                </span>
              </div>
              <div className="stage-indicators">
                {speechActive ? (
                  <span className="stage-chip speech-chip">
                    <span className="wave-bars" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    语音跟随
                  </span>
                ) : null}
                {recorderState === "recording" ||
                recorderState === "paused" ? (
                  <span className="stage-chip recording-chip">
                    <span className="record-dot" />
                    {recorderState === "paused" ? "已暂停" : "REC"}{" "}
                    {formatDuration(elapsedSeconds)}
                  </span>
                ) : (
                  <span className="stage-chip">待机</span>
                )}
              </div>
            </div>

            <div className="canvas-wrap">
              <canvas
                ref={canvasRef}
                width={1920}
                height={1080}
                aria-label="录制画面实时预览"
              />
              <canvas
                ref={promptOverlayCanvasRef}
                className="prompt-preview-overlay"
                width={1920}
                height={1080}
                aria-hidden="true"
              />
              {!hasVisualSource && !promptRunning ? (
                <div className="empty-stage">
                  <span className="empty-stage-icon" aria-hidden="true">
                    <span />
                  </span>
                  <strong>画面还未接入</strong>
                  <p>选择屏幕或开启摄像头后，这里会显示最终录制构图。</p>
                  <button type="button" onClick={chooseScreen}>
                    选择屏幕
                  </button>
                </div>
              ) : null}
              {countdown ? (
                <div className="countdown-overlay" aria-live="assertive">
                  {countdown}
                </div>
              ) : null}
            </div>

            <div className="notice-bar" role="status" aria-live="polite">
              <span className="notice-icon" aria-hidden="true">
                i
              </span>
              <span>{notice}</span>
            </div>
          </div>

          <div className="transport-card">
            <div className="transport-copy">
              <span className="transport-time">
                {formatDuration(elapsedSeconds)}
              </span>
              <span>
                {recorderState === "processing"
                  ? "正在生成所选格式…"
                  : recorderState === "recording"
                    ? "正在录制"
                    : recorderState === "paused"
                      ? "录制已暂停"
                      : "准备就绪"}
              </span>
            </div>
            <div className="transport-actions">
              {recorderState === "recording" ||
              recorderState === "paused" ? (
                <>
                  <button
                    className="secondary-action round-action"
                    type="button"
                    onClick={pauseOrResumeRecording}
                  >
                    {recorderState === "paused" ? "继续" : "暂停"}
                  </button>
                  <button
                    className="stop-action"
                    type="button"
                    onClick={stopRecording}
                  >
                    <span aria-hidden="true" />
                    停止录制
                  </button>
                </>
              ) : (
                <button
                  className="record-action"
                  type="button"
                  onClick={startRecording}
                  disabled={!canStartRecording || recorderState === "processing"}
                >
                  <span className="record-action-dot" aria-hidden="true" />
                  {recorderState === "processing" ? "处理中…" : "开始录制"}
                </button>
              )}
            </div>
          </div>

          {recordingUrl ? (
            <div className="result-card">
              {recordingFormat === "wav" ? (
                <audio controls>
                  <source
                    src={recordingUrl}
                    type={getOutputMimeType(recordingFormat)}
                  />
                </audio>
              ) : (
                <video controls playsInline>
                  <source
                    src={recordingUrl}
                    type={getOutputMimeType(recordingFormat)}
                  />
                </video>
              )}
              <div className="result-copy">
                <span className="result-kicker">录制完成 · {recordingSize}</span>
                <strong>
                  {recordingFormat === "wav" ? "音频" : "视频"}已在本地生成
                </strong>
                <p>关闭页面前请下载保存；页面不会把素材上传到服务器。</p>
              </div>
              <a
                className="download-action"
                href={recordingUrl}
                download={getDownloadName(recordingFormat)}
              >
                下载 {recordingFormat.toUpperCase()}
              </a>
            </div>
          ) : null}
        </section>

        <aside className="control-panel prompt-panel">
          <div className="panel-heading prompt-heading">
            <div>
              <span className="eyebrow">03 · 提词器</span>
              <h2>你的文案</h2>
            </div>
            <span className="autosave-label">自动本地保存</span>
          </div>

          <textarea
            className="script-editor"
            value={script}
            onChange={handleScriptChange}
            placeholder="在这里粘贴或输入你的提词文案…"
            aria-label="提词文案"
          />
          <div className="editor-meta">
            <span>{script.length} 字</span>
            <button type="button" onClick={clearScript} disabled={!script}>
              清空
            </button>
          </div>

          <div className="mode-switch" aria-label="滚屏模式">
            <button
              className={settings.promptMode === "speech" ? "active" : ""}
              type="button"
              onClick={() => handlePromptModeChange("speech")}
            >
              语音跟随
              <small>说到哪，滚到哪</small>
            </button>
            <button
              className={settings.promptMode === "manual" ? "active" : ""}
              type="button"
              onClick={() => handlePromptModeChange("manual")}
            >
              匀速滚屏
              <small>按设定速度前进</small>
            </button>
          </div>

          <div className="prompt-output-switch" aria-label="字幕写入方式">
            <button
              className={!settings.promptInRecording ? "active" : ""}
              type="button"
              onClick={() => updateSettings("promptInRecording", false)}
            >
              仅自己看
              <small>预览可见，不合成进文件</small>
            </button>
            <button
              className={settings.promptInRecording ? "active" : ""}
              type="button"
              onClick={() => updateSettings("promptInRecording", true)}
            >
              写入成片
              <small>字幕合成到录制画面</small>
            </button>
          </div>

          <div className="prompt-controls">
            <div className="range-heading">
              <label htmlFor="prompt-progress">当前进度</label>
              <span>{promptProgress}%</span>
            </div>
            <input
              id="prompt-progress"
              className="range-control"
              type="range"
              min={0}
              max={100}
              value={promptProgress}
              onChange={(event) =>
                syncPromptProgress(Number(event.target.value) / 100)
              }
            />
            {settings.promptMode === "speech" ? (
              <p className="speech-preview">
                {spokenPreview
                  ? `已听到：${spokenPreview}`
                  : "使用 Chrome 语音识别；首次启动会请求权限。"}
              </p>
            ) : null}
          </div>

          <div className="settings-grid">
            <div className="setting-row wide">
              <div className="range-heading">
                <label htmlFor="font-size">字体大小</label>
                <span>{settings.promptFontSize}px</span>
              </div>
              <input
                id="font-size"
                className="range-control"
                type="range"
                min={24}
                max={76}
                value={settings.promptFontSize}
                onChange={(event) =>
                  updateSettings("promptFontSize", Number(event.target.value))
                }
              />
            </div>

            <div className="setting-row wide">
              <div className="range-heading">
                <label htmlFor="prompt-height">提词框高度</label>
                <span>{settings.promptHeight}%</span>
              </div>
              <input
                id="prompt-height"
                className="range-control"
                type="range"
                min={18}
                max={60}
                value={settings.promptHeight}
                onChange={(event) =>
                  updateSettings("promptHeight", Number(event.target.value))
                }
              />
            </div>

            {settings.promptMode === "manual" ? (
              <div className="setting-row wide">
                <div className="range-heading">
                  <label htmlFor="prompt-speed">滚屏速度</label>
                  <span>{settings.promptSpeed}px/s</span>
                </div>
                <input
                  id="prompt-speed"
                  className="range-control"
                  type="range"
                  min={8}
                  max={120}
                  value={settings.promptSpeed}
                  onChange={(event) =>
                    updateSettings("promptSpeed", Number(event.target.value))
                  }
                />
              </div>
            ) : null}

            <label className="setting-field">
              <span>文字颜色</span>
              <span className="color-control">
                <input
                  type="color"
                  value={settings.promptColor}
                  onChange={(event) =>
                    updateSettings("promptColor", event.target.value)
                  }
                />
                {settings.promptColor.toUpperCase()}
              </span>
            </label>

            <label className="setting-field">
              <span>显示位置</span>
              <select
                className="select-control"
                value={settings.promptPosition}
                onChange={(event) =>
                  updateSettings(
                    "promptPosition",
                    event.target.value as PromptPosition,
                  )
                }
              >
                <option value="top">画面上方</option>
                <option value="center">画面中央</option>
                <option value="bottom">画面下方</option>
              </select>
            </label>

            <div className="setting-row wide">
              <div className="range-heading">
                <label htmlFor="prompt-background">背景深度</label>
                <span>{settings.promptBackground}%</span>
              </div>
              <input
                id="prompt-background"
                className="range-control"
                type="range"
                min={0}
                max={90}
                value={settings.promptBackground}
                onChange={(event) =>
                  updateSettings(
                    "promptBackground",
                    Number(event.target.value),
                  )
                }
              />
            </div>

            <div className="setting-row wide">
              <div className="range-heading">
                <label htmlFor="prompt-width">提词框宽度</label>
                <span>{settings.promptWidth}%</span>
              </div>
              <input
                id="prompt-width"
                className="range-control"
                type="range"
                min={50}
                max={94}
                value={settings.promptWidth}
                onChange={(event) =>
                  updateSettings("promptWidth", Number(event.target.value))
                }
              />
            </div>
          </div>

          <div className="prompt-run-row">
            <button
              className={promptRunning ? "stop-prompt" : "start-prompt"}
              type="button"
              onClick={promptRunning ? stopPrompt : startPrompt}
              disabled={!script.trim()}
            >
              {promptRunning ? "停止提词" : "预演提词"}
            </button>
            <button
              className="reset-prompt"
              type="button"
              onClick={() => syncPromptProgress(0)}
              disabled={!script.trim()}
            >
              回到开头
            </button>
          </div>

          <div className="divider" />

          <div className="panel-heading compact">
            <span className="eyebrow">04 · 画中画</span>
            <h2>摄像头样式</h2>
          </div>

          <div className="settings-grid camera-settings">
            <label className="setting-field">
              <span>位置</span>
              <select
                className="select-control"
                value={settings.cameraPosition}
                onChange={(event) =>
                  updateSettings(
                    "cameraPosition",
                    event.target.value as CameraPosition,
                  )
                }
              >
                <option value="top-left">左上角</option>
                <option value="top-right">右上角</option>
                <option value="bottom-left">左下角</option>
                <option value="bottom-right">右下角</option>
              </select>
            </label>

            <label className="setting-field">
              <span>形状</span>
              <select
                className="select-control"
                value={settings.cameraShape}
                onChange={(event) =>
                  updateSettings(
                    "cameraShape",
                    event.target.value as CameraShape,
                  )
                }
              >
                <option value="rounded">圆角矩形</option>
                <option value="circle">圆形头像</option>
              </select>
            </label>

            <div className="setting-row wide">
              <div className="range-heading">
                <label htmlFor="camera-size">画面大小</label>
                <span>{settings.cameraSize}%</span>
              </div>
              <input
                id="camera-size"
                className="range-control"
                type="range"
                min={12}
                max={36}
                value={settings.cameraSize}
                onChange={(event) =>
                  updateSettings("cameraSize", Number(event.target.value))
                }
              />
            </div>
          </div>

          <label className="toggle-row compact-toggle">
            <span>
              <strong>镜像摄像头</strong>
              <small>更接近照镜子的观看习惯</small>
            </span>
            <input
              type="checkbox"
              checked={settings.mirrorCamera}
              onChange={(event) =>
                updateSettings("mirrorCamera", event.target.checked)
              }
            />
            <span className="toggle-track" aria-hidden="true" />
          </label>
        </aside>
      </section>

      <footer className="studio-footer">
        <span>录制与合成全部在浏览器本地完成</span>
        <span>建议连接电源并关闭高负载应用，以获得稳定的 4K / 60fps 录制</span>
      </footer>

      <video ref={screenVideoRef} className="hidden-media" muted playsInline />
      <video ref={cameraVideoRef} className="hidden-media" muted playsInline />
    </main>
  );
}
