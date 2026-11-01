/**
 * Client-side Audio Recording & Signal Activity Utilities
 * Handles MediaRecorder MIME type detection, microphone stream lifecycle,
 * real-time Web Audio API signal activity measurement, and transcript text assembly.
 */

export type VoiceRecordingState = "IDLE" | "RECORDING" | "TRANSCRIBING" | "SUCCESS" | "ERROR";

export interface SupportedAudioFormat {
  mimeType: string;
  extension: string;
}

export interface AudioActivityStats {
  hasAudioActivity: boolean;
  peakLevel: number;
  averageLevel: number;
}

export interface AudioActivityTracker {
  getCurrentLevel: () => number;
  getStats: () => AudioActivityStats;
  cleanup: () => void;
}

export interface RecordingValidationResult {
  valid: boolean;
  error?: string;
}

// Activity threshold for distinguishing vocal audio from silence/ambient zero floor
export const AUDIO_ACTIVITY_THRESHOLD = 0.02;

/**
 * Requests microphone access with echo cancellation, noise suppression, and auto gain control.
 * Gracefully falls back to unconstrained audio if specific constraints fail.
 */
export async function getMicrophoneStream(): Promise<MediaStream> {
  if (typeof window === "undefined" || !navigator?.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is not supported on this browser.");
  }

  const audioConstraints: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  try {
    return await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
  } catch (err: unknown) {
    // If overconstrained or specific constraints are rejected, fall back to basic audio
    if (
      err instanceof Error &&
      (err.name === "OverconstrainedError" || err.name === "ConstraintNotSatisfiedError")
    ) {
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    throw err;
  }
}

/**
 * Detects the best available audio MIME type and corresponding file extension supported
 * by the current browser's MediaRecorder implementation.
 */
export function detectSupportedAudioFormat(): SupportedAudioFormat {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return { mimeType: "audio/webm", extension: "webm" };
  }

  const candidates: SupportedAudioFormat[] = [
    { mimeType: "audio/webm;codecs=opus", extension: "webm" },
    { mimeType: "audio/webm", extension: "webm" },
    { mimeType: "audio/mp4", extension: "mp4" },
    { mimeType: "audio/m4a", extension: "m4a" },
    { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
    { mimeType: "audio/ogg", extension: "ogg" },
    { mimeType: "audio/wav", extension: "wav" },
  ];

  for (const candidate of candidates) {
    try {
      if (
        typeof MediaRecorder.isTypeSupported === "function" &&
        MediaRecorder.isTypeSupported(candidate.mimeType)
      ) {
        return candidate;
      }
    } catch {
      // Ignore browsers where isTypeSupported throws
    }
  }

  return { mimeType: "", extension: "webm" };
}

/**
 * Measures real-time microphone input activity via Web Audio API.
 * Tracks peak RMS signal level and average activity during recording.
 */
export function createAudioActivityTracker(stream: MediaStream): AudioActivityTracker | null {
  if (typeof window === "undefined") return null;

  const AudioContextClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextClass) return null;

  try {
    const audioContext = new AudioContextClass();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.2;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let peakLevel = 0;
    let sumLevels = 0;
    let sampleCount = 0;
    let hasAudioActivity = false;

    const checkLevel = (): number => {
      analyser.getByteTimeDomainData(dataArray);
      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const val = dataArray[i] ?? 128;
        const normalized = (val - 128) / 128; // -1.0 to 1.0
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / dataArray.length); // 0 to 1
      if (rms > peakLevel) {
        peakLevel = rms;
      }
      sumLevels += rms;
      sampleCount++;
      if (rms >= AUDIO_ACTIVITY_THRESHOLD) {
        hasAudioActivity = true;
      }
      return rms;
    };

    return {
      getCurrentLevel: () => checkLevel(),
      getStats: () => {
        checkLevel();
        const averageLevel = sampleCount > 0 ? sumLevels / sampleCount : 0;
        return {
          hasAudioActivity: hasAudioActivity || peakLevel >= AUDIO_ACTIVITY_THRESHOLD,
          peakLevel: Number(peakLevel.toFixed(4)),
          averageLevel: Number(averageLevel.toFixed(4)),
        };
      },
      cleanup: () => {
        try {
          source.disconnect();
          analyser.disconnect();
          if (audioContext.state !== "closed") {
            void audioContext.close();
          }
        } catch {
          // ignore cleanup errors
        }
      },
    };
  } catch (err) {
    console.warn("Could not initialize audio activity tracker:", err);
    return null;
  }
}

/**
 * Pure evaluation function for audio signal activity.
 */
export function evaluateAudioSignalActivity(
  peakLevel: number,
  averageLevel: number,
  threshold: number = AUDIO_ACTIVITY_THRESHOLD,
): boolean {
  return peakLevel >= threshold || averageLevel >= threshold * 0.5;
}

/**
 * Validates recording duration, container size, and actual audio signal activity
 * prior to uploading to the transcription server.
 */
export function validateRecordingSignal(options: {
  durationSeconds: number;
  blobSize: number;
  activityStats?: AudioActivityStats | null;
  minDurationSeconds?: number;
  minBlobBytes?: number;
}): RecordingValidationResult {
  const {
    durationSeconds,
    blobSize,
    activityStats,
    minDurationSeconds = 1,
    minBlobBytes = 500,
  } = options;

  if (durationSeconds < minDurationSeconds) {
    return {
      valid: false,
      error: "Recording was too short. Please speak your description before stopping.",
    };
  }

  if (blobSize < minBlobBytes) {
    return {
      valid: false,
      error: "Recording is empty or incomplete. Please check your microphone and try again.",
    };
  }

  // When activityStats is available (Web Audio supported), check for actual signal presence
  if (activityStats && !activityStats.hasAudioActivity) {
    return {
      valid: false,
      error:
        "No sound was detected from your microphone. Please check that your microphone is unmuted and input volume is turned up, or type below.",
    };
  }

  return { valid: true };
}

/**
 * Formats elapsed recording time into mm:ss display format.
 */
export function formatRecordingTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

/**
 * Combines an existing description with a newly transcribed voice snippet,
 * preserving all previously typed text and trimming extraneous whitespace.
 */
export function appendTranscriptToDescription(existing: string, transcript: string): string {
  const cleanExisting = (existing || "").trim();
  const cleanTranscript = (transcript || "").trim();
  if (!cleanTranscript) return existing;
  if (!cleanExisting) return cleanTranscript;
  return `${cleanExisting} ${cleanTranscript}`;
}

/**
 * Maps common browser getUserMedia error names to actionable, farmer-friendly messages.
 */
export function getMicrophoneErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) {
    return "Could not access microphone. Please type your description instead.";
  }

  switch (err.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Microphone permission was denied. Please allow microphone access in your browser settings to record your voice, or type below.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No microphone was detected on this device. You can type your description below.";
    case "NotSupportedError":
      return "Voice recording is not supported on this browser or platform. Please use keyboard typing.";
    case "SecurityError":
      return "Voice recording requires a secure (HTTPS) connection. Please type your description below.";
    case "AbortError":
      return "Microphone access was interrupted. Please try again.";
    default:
      return err.message || "Failed to start voice recording. Please type your description.";
  }
}
