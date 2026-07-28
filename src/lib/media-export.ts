export type OutputFormat = "webm" | "mp4" | "mov" | "wav";

interface ConvertRecordingOptions {
  format: OutputFormat;
  videoBitrate: number;
  onProgress?: (progress: number) => void;
}

export const OUTPUT_FORMAT_LABELS: Record<OutputFormat, string> = {
  webm: "WebM · VP9 / Opus",
  mp4: "MP4 · H.264 / AAC",
  mov: "MOV · H.264 / AAC",
  wav: "WAV · 24-bit / 48 kHz",
};

export function getOutputMimeType(format: OutputFormat) {
  if (format === "mp4") return "video/mp4";
  if (format === "mov") return "video/quicktime";
  if (format === "wav") return "audio/wav";
  return "video/webm";
}

export async function convertRecording(
  source: Blob,
  { format, videoBitrate, onProgress }: ConvertRecordingOptions,
) {
  if (format === "webm") {
    return source;
  }

  const {
    ALL_FORMATS,
    BlobSource,
    BufferTarget,
    Conversion,
    Input,
    MovOutputFormat,
    Mp4OutputFormat,
    Output,
    WavOutputFormat,
  } = await import("mediabunny");

  const target = new BufferTarget();
  const outputFormat =
    format === "mp4"
      ? new Mp4OutputFormat({ fastStart: "in-memory" })
      : format === "mov"
        ? new MovOutputFormat({ fastStart: "in-memory" })
        : new WavOutputFormat({ large: true });
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(source),
  });
  const output = new Output({ format: outputFormat, target });
  const conversion = await Conversion.init({
    input,
    output,
    tracks: "primary",
    video:
      format === "wav"
        ? { discard: true }
        : {
            codec: "avc",
            bitrate: videoBitrate,
            keyFrameInterval: 2,
            hardwareAcceleration: "prefer-hardware",
            forceTranscode: true,
          },
    audio:
      format === "wav"
        ? {
            codec: "pcm-s24",
            sampleRate: 48_000,
            forceTranscode: true,
          }
        : {
            codec: "aac",
            bitrate: 320_000,
            sampleRate: 48_000,
            forceTranscode: true,
          },
    showWarnings: false,
  });

  if (!conversion.isValid) {
    const reasons = conversion.discardedTracks
      .map(({ reason }) => reason)
      .join(", ");
    input.dispose();
    throw new Error(reasons || "unsupported_conversion");
  }

  conversion.onProgress = (progress) => onProgress?.(progress);
  await conversion.execute();
  input.dispose();

  if (!target.buffer) {
    throw new Error("empty_output");
  }

  return new Blob([target.buffer], { type: getOutputMimeType(format) });
}
