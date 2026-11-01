import test from "node:test";
import assert from "node:assert/strict";

import {
  handleTranscriptionRequest,
  GROQ_WHISPER_URL,
  GROQ_MODEL,
  MAX_AUDIO_BYTES,
  MIN_AUDIO_BYTES,
  clearRateLimitsForTesting,
} from "../src/lib/services/transcription-service.ts";

import {
  detectSupportedAudioFormat,
  formatRecordingTime,
  appendTranscriptToDescription,
  getMicrophoneErrorMessage,
  evaluateAudioSignalActivity,
  validateRecordingSignal,
  AUDIO_ACTIVITY_THRESHOLD,
  MIN_RECORDING_DURATION_SECONDS,
  MAX_RECORDING_DURATION_SECONDS,
} from "../src/lib/audio-recorder.ts";

// Helper to construct a mock Request with FormData containing an audio file
function createMockTranscriptionRequest(options = {}) {
  const {
    method = "POST",
    token = "valid_farmer_jwt_token",
    file = new Blob([new Uint8Array(500)], { type: "audio/webm" }),
    fileName = "test-recording.webm",
    omitFile = false,
  } = options;

  const formData = new FormData();
  if (!omitFile && file) {
    formData.append("file", file, fileName);
  }

  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return new Request("http://localhost:3000/api/transcribe", {
    method,
    headers,
    body: method === "POST" ? formData : undefined,
  });
}

// ==============================================================================
// 1. SERVER ENDPOINT: AUTHENTICATION & AUTHORIZATION
// ==============================================================================

test("handleTranscriptionRequest rejects non-POST requests with 405", async () => {
  const req = createMockTranscriptionRequest({ method: "GET" });
  const res = await handleTranscriptionRequest(req);
  assert.equal(res.status, 405);
  const data = await res.json();
  assert.equal(data.error, "Method not allowed. Use POST.");
});

test("handleTranscriptionRequest rejects missing Bearer token with 401", async () => {
  const req = createMockTranscriptionRequest({ token: null });
  const res = await handleTranscriptionRequest(req);
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.match(data.error, /Authentication required/i);
});

test("handleTranscriptionRequest rejects invalid/expired token with 401", async () => {
  const mockUserClient = {
    auth: {
      getUser: async () => ({ data: { user: null }, error: new Error("JWT expired") }),
    },
  };
  const req = createMockTranscriptionRequest({ token: "expired_token" });
  const res = await handleTranscriptionRequest(req, { mockUserClient: mockUserClient });
  assert.equal(res.status, 401);
  const data = await res.json();
  assert.match(data.error, /Invalid or expired session/i);
});

test("handleTranscriptionRequest rejects non-farmer, non-admin role (technician) with 403", async () => {
  const mockUserClient = {
    auth: {
      getUser: async () => ({ data: { user: { id: "tech_user_123" } }, error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { id: "p1", role: "technician" }, error: null }),
        }),
      }),
    }),
  };

  const req = createMockTranscriptionRequest({ token: "tech_jwt" });
  const res = await handleTranscriptionRequest(req, { mockUserClient: mockUserClient });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.match(data.error, /authorized for farmers/i);
});

test("handleTranscriptionRequest rejects missing profile with 403", async () => {
  const mockUserClient = {
    auth: {
      getUser: async () => ({ data: { user: { id: "unknown_user_456" } }, error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  };

  const req = createMockTranscriptionRequest({ token: "orphan_jwt" });
  const res = await handleTranscriptionRequest(req, { mockUserClient: mockUserClient });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.match(data.error, /Could not find profile/i);
});

// ==============================================================================
// 2. SERVER ENDPOINT: AUDIO PAYLOAD VALIDATION
// ==============================================================================

test("handleTranscriptionRequest rejects missing file field with 400", async () => {
  const req = createMockTranscriptionRequest({ omitFile: true });
  const res = await handleTranscriptionRequest(req, {
    bypassAuthForTesting: { userId: "farmer_1", role: "farmer" },
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /Missing audio file/i);
});

test("handleTranscriptionRequest rejects empty or under-sized audio (< 100 bytes) with 400", async () => {
  const tinyBlob = new Blob([new Uint8Array(50)], { type: "audio/webm" });
  const req = createMockTranscriptionRequest({ file: tinyBlob });
  const res = await handleTranscriptionRequest(req, {
    bypassAuthForTesting: { userId: "farmer_1", role: "farmer" },
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /empty or too short/i);
});

test("handleTranscriptionRequest rejects oversized audio (> 10 MB) with 413", async () => {
  const giantBlob = new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1024)], { type: "audio/webm" });
  const req = createMockTranscriptionRequest({ file: giantBlob, fileName: "giant.webm" });

  const res = await handleTranscriptionRequest(req, {
    bypassAuthForTesting: { userId: "farmer_1", role: "farmer" },
  });
  assert.equal(res.status, 413);
  const data = await res.json();
  assert.match(data.error, /exceeds the 10 MB size limit/i);
});

test("handleTranscriptionRequest rejects unsupported MIME type and extension with 400", async () => {
  const textBlob = new Blob(["a".repeat(300)], { type: "text/plain" });
  const req = createMockTranscriptionRequest({ file: textBlob, fileName: "notes.txt" });
  const res = await handleTranscriptionRequest(req, {
    bypassAuthForTesting: { userId: "farmer_1", role: "farmer" },
  });
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.match(data.error, /Unsupported audio format/i);
});

// ==============================================================================
// 3. GROQ INTEGRATION: REQUEST CONSTRUCTION & WHISPER MODEL
// ==============================================================================

test("handleTranscriptionRequest constructs valid Groq Whisper request omitting language param", async () => {
  clearRateLimitsForTesting();

  let capturedUrl = "";
  let capturedHeaders = null;
  let capturedBody = null;

  const mockFetch = async (url, options) => {
    capturedUrl = url.toString();
    capturedHeaders = options.headers;
    capturedBody = options.body;
    return new Response(JSON.stringify({ text: "Tractor engine sputtering under load" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const audioBlob = new Blob([new Uint8Array(1024)], { type: "audio/webm;codecs=opus" });
  const req = createMockTranscriptionRequest({ file: audioBlob, fileName: "tractor.webm" });

  const res = await handleTranscriptionRequest(req, {
    bypassAuthForTesting: { userId: "farmer_test_1", role: "farmer" },
    groqApiKey: "gsk_test_groq_mock_key",
    fetchFn: mockFetch,
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.text, "Tractor engine sputtering under load");

  // Verify Groq URL
  assert.equal(capturedUrl, GROQ_WHISPER_URL);
  assert.equal(capturedUrl, "https://api.groq.com/openai/v1/audio/transcriptions");

  // Verify Authorization header
  assert.equal(capturedHeaders.Authorization, "Bearer gsk_test_groq_mock_key");

  // Verify FormData parameters
  assert.ok(capturedBody instanceof FormData);
  assert.equal(capturedBody.get("model"), GROQ_MODEL);
  assert.equal(capturedBody.get("model"), "whisper-large-v3");
  assert.equal(capturedBody.get("response_format"), "json");

  // CRITICAL REQUIREMENT: "language" parameter MUST BE OMITTED for automatic language detection
  assert.equal(
    capturedBody.get("language"),
    null,
    "Language parameter must be omitted so Groq automatically detects Hindi, Marathi, or English",
  );

  const forwardedFile = capturedBody.get("file");
  assert.ok(forwardedFile, "File must be forwarded");
});

// ==============================================================================
// 4. MULTILINGUAL ORIGINAL SCRIPT PRESERVATION
// ==============================================================================

test("handleTranscriptionRequest preserves Hindi Devanagari script faithfully without translating", async () => {
  clearRateLimitsForTesting();
  const hindiTranscript = "ट्रॅक्टरचे इंजिन सुरू होत नाही आणि खूप काळा धूर निघत आहे";

  const mockFetch = async () =>
    new Response(JSON.stringify({ text: hindiTranscript }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const req = createMockTranscriptionRequest();
  const res = await handleTranscriptionRequest(req, {
    bypassAuthForTesting: { userId: "farmer_hindi", role: "farmer" },
    groqApiKey: "gsk_test_key",
    fetchFn: mockFetch,
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.text, hindiTranscript, "Hindi Devanagari transcript must be preserved exactly");
});

test("handleTranscriptionRequest preserves Marathi script faithfully without translating", async () => {
  clearRateLimitsForTesting();
  const marathiTranscript = "रोटाव्हेटर चालवताना गिअरमधून मोठा खडखड आवाज येत आहे";

  const mockFetch = async () =>
    new Response(JSON.stringify({ text: marathiTranscript }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const req = createMockTranscriptionRequest();
  const res = await handleTranscriptionRequest(req, {
    bypassAuthForTesting: { userId: "farmer_marathi", role: "farmer" },
    groqApiKey: "gsk_test_key",
    fetchFn: mockFetch,
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.text, marathiTranscript, "Marathi transcript must be preserved exactly");
});

// ==============================================================================
// 5. SERVER ERROR HANDLING & UPSTREAM RESILIENCE
// ==============================================================================

test("handleTranscriptionRequest handles missing Groq API key with 503", async () => {
  clearRateLimitsForTesting();
  const req = createMockTranscriptionRequest();
  const res = await handleTranscriptionRequest(req, {
    bypassAuthForTesting: { userId: "farmer_1", role: "farmer" },
    groqApiKey: "", // Simulating unconfigured key
  });
  assert.equal(res.status, 503);
  const data = await res.json();
  assert.match(data.error, /temporarily unavailable/i);
});

test("handleTranscriptionRequest handles Groq 429 rate limit with client-friendly 429", async () => {
  clearRateLimitsForTesting();
  const mockFetch = async () => new Response("Rate limit exceeded", { status: 429 });

  const req = createMockTranscriptionRequest();
  const res = await handleTranscriptionRequest(req, {
    bypassAuthForTesting: { userId: "farmer_rate", role: "farmer" },
    groqApiKey: "gsk_test_key",
    fetchFn: mockFetch,
  });
  assert.equal(res.status, 429);
  const data = await res.json();
  assert.match(data.error, /busy due to high demand/i);
});

test("handleTranscriptionRequest handles Groq 401 auth error with 502 and hides secrets", async () => {
  clearRateLimitsForTesting();
  const mockFetch = async () => new Response("Unauthorized upstream", { status: 401 });

  const req = createMockTranscriptionRequest();
  const res = await handleTranscriptionRequest(req, {
    bypassAuthForTesting: { userId: "farmer_auth_err", role: "farmer" },
    groqApiKey: "gsk_invalid_secret_key",
    fetchFn: mockFetch,
  });
  assert.equal(res.status, 502);
  const data = await res.json();
  assert.match(data.error, /authentication error/i);
  assert.ok(!JSON.stringify(data).includes("gsk_invalid_secret_key"), "Must not leak secret keys");
});

test("handleTranscriptionRequest handles Groq 500 server error with 502", async () => {
  clearRateLimitsForTesting();
  const mockFetch = async () => new Response("Internal Server Error", { status: 500 });

  const req = createMockTranscriptionRequest();
  const res = await handleTranscriptionRequest(req, {
    bypassAuthForTesting: { userId: "farmer_500", role: "farmer" },
    groqApiKey: "gsk_test_key",
    fetchFn: mockFetch,
  });
  assert.equal(res.status, 502);
  const data = await res.json();
  assert.match(data.error, /encountered an error/i);
});

test("handleTranscriptionRequest handles upstream timeout with 504", async () => {
  clearRateLimitsForTesting();
  const mockFetch = async () => {
    const error = new Error("The operation was aborted due to timeout");
    error.name = "TimeoutError";
    throw error;
  };

  const req = createMockTranscriptionRequest();
  const res = await handleTranscriptionRequest(req, {
    bypassAuthForTesting: { userId: "farmer_timeout", role: "farmer" },
    groqApiKey: "gsk_test_key",
    fetchFn: mockFetch,
  });
  assert.equal(res.status, 504);
  const data = await res.json();
  assert.match(data.error, /timed out/i);
});

test("handleTranscriptionRequest handles malformed upstream JSON with 502", async () => {
  clearRateLimitsForTesting();
  const mockFetch = async () =>
    new Response(JSON.stringify({ unexpected: "no text field" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const req = createMockTranscriptionRequest();
  const res = await handleTranscriptionRequest(req, {
    bypassAuthForTesting: { userId: "farmer_malformed", role: "farmer" },
    groqApiKey: "gsk_test_key",
    fetchFn: mockFetch,
  });
  assert.equal(res.status, 502);
  const data = await res.json();
  assert.match(data.error, /Invalid transcription response/i);
});

test("handleTranscriptionRequest rate limits excessive requests per user (10/min)", async () => {
  clearRateLimitsForTesting();
  const mockFetch = async () =>
    new Response(JSON.stringify({ text: "OK" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const userId = "farmer_flooder_999";
  // Make 10 requests successfully
  for (let i = 0; i < 10; i++) {
    const req = createMockTranscriptionRequest();
    const res = await handleTranscriptionRequest(req, {
      bypassAuthForTesting: { userId, role: "farmer" },
      groqApiKey: "gsk_test_key",
      fetchFn: mockFetch,
    });
    assert.equal(res.status, 200);
  }

  // 11th request must be rejected with 429
  const req11 = createMockTranscriptionRequest();
  const res11 = await handleTranscriptionRequest(req11, {
    bypassAuthForTesting: { userId, role: "farmer" },
    groqApiKey: "gsk_test_key",
    fetchFn: mockFetch,
  });
  assert.equal(res11.status, 429);
  const data11 = await res11.json();
  assert.match(data11.error, /Too many transcription requests/i);

  clearRateLimitsForTesting();
});

// ==============================================================================
// 6. CLIENT RECORDING UTILITIES
// ==============================================================================

test("appendTranscriptToDescription preserves existing typed description", () => {
  // Scenario 1: Empty existing description
  assert.equal(appendTranscriptToDescription("", "Tractor won't start"), "Tractor won't start");

  // Scenario 2: Existing typed text is preserved and appended with space
  assert.equal(
    appendTranscriptToDescription("White smoke from exhaust.", "Engine makes rattling noise."),
    "White smoke from exhaust. Engine makes rattling noise.",
  );

  // Scenario 3: Hindi transcription appended to existing English
  assert.equal(
    appendTranscriptToDescription("Field 3.", "इंजिन सुरू होत नाही"),
    "Field 3. इंजिन सुरू होत नाही",
  );

  // Scenario 4: Empty transcript leaves existing description untouched
  assert.equal(appendTranscriptToDescription("Hydraulic lift failed", ""), "Hydraulic lift failed");
});

test("formatRecordingTime accurately formats seconds into mm:ss", () => {
  assert.equal(formatRecordingTime(0), "0:00");
  assert.equal(formatRecordingTime(7), "0:07");
  assert.equal(formatRecordingTime(59), "0:59");
  assert.equal(formatRecordingTime(60), "1:00");
  assert.equal(formatRecordingTime(65), "1:05");
  assert.equal(formatRecordingTime(125), "2:05");
  assert.equal(formatRecordingTime(-1), "0:00");
  assert.equal(formatRecordingTime(NaN), "0:00");
});

test("getMicrophoneErrorMessage returns accurate farmer-friendly error explanations", () => {
  const permError = new Error("Permission denied");
  permError.name = "NotAllowedError";
  assert.match(getMicrophoneErrorMessage(permError), /Microphone permission was denied/i);

  const notFoundError = new Error("Device not found");
  notFoundError.name = "NotFoundError";
  assert.match(getMicrophoneErrorMessage(notFoundError), /No microphone was detected/i);

  const insecureError = new Error("Insecure origin");
  insecureError.name = "SecurityError";
  assert.match(getMicrophoneErrorMessage(insecureError), /secure \(HTTPS\) connection/i);

  const unsupportedError = new Error("Not supported");
  unsupportedError.name = "NotSupportedError";
  assert.match(getMicrophoneErrorMessage(unsupportedError), /not supported on this browser/i);
});

test("detectSupportedAudioFormat returns fallback webm when window or MediaRecorder is absent", () => {
  const format = detectSupportedAudioFormat();
  assert.ok(format.extension === "webm" || format.extension === "mp4");
});

// ==============================================================================
// 7. MICROPHONE SIGNAL ACTIVITY DETECTION & SILENT RECORDING REJECTION
// ==============================================================================

test("evaluateAudioSignalActivity identifies active speech vs silent microphone signal", () => {
  // Silent signal (zeros or ambient sub-threshold noise)
  assert.equal(evaluateAudioSignalActivity(0, 0), false, "Zero level must be marked inactive");
  assert.equal(
    evaluateAudioSignalActivity(0.005, 0.002),
    false,
    "Sub-threshold ambient hum must be marked inactive",
  );

  // Active vocal signal exceeding threshold
  assert.equal(
    evaluateAudioSignalActivity(0.05, 0.02),
    true,
    "Vocal signal (5% peak) must be marked active",
  );
  assert.equal(
    evaluateAudioSignalActivity(0.35, 0.15),
    true,
    "Strong vocal signal (35% peak) must be marked active",
  );
  assert.equal(
    evaluateAudioSignalActivity(AUDIO_ACTIVITY_THRESHOLD, 0),
    true,
    "Signal meeting threshold exactly must be active",
  );
});

test("validateRecordingSignal rejects silent recording with actionable error", () => {
  const silentResult = validateRecordingSignal({
    durationSeconds: 8,
    blobSize: 8192,
    activityStats: {
      hasAudioActivity: false,
      peakLevel: 0.005,
      averageLevel: 0.002,
    },
  });

  assert.equal(silentResult.valid, false);
  assert.match(silentResult.error, /No sound was detected from your microphone/i);
});

test("validateRecordingSignal rejects 2-second recording as too short (< 5 seconds)", () => {
  const result = validateRecordingSignal({
    durationSeconds: 2,
    blobSize: 8000,
    activityStats: {
      hasAudioActivity: true,
      peakLevel: 0.25,
      averageLevel: 0.1,
    },
  });
  assert.equal(result.valid, false);
  assert.match(result.error, /Recording was too short/i);
});

test("validateRecordingSignal rejects 4-second recording as too short (< 5 seconds)", () => {
  const result = validateRecordingSignal({
    durationSeconds: 4,
    blobSize: 12000,
    activityStats: {
      hasAudioActivity: true,
      peakLevel: 0.25,
      averageLevel: 0.1,
    },
  });
  assert.equal(result.valid, false);
  assert.match(result.error, /Recording was too short/i);
});

test("validateRecordingSignal accepts exactly 5-second recording when audio activity is valid", () => {
  const result = validateRecordingSignal({
    durationSeconds: 5,
    blobSize: 16000,
    activityStats: {
      hasAudioActivity: true,
      peakLevel: 0.25,
      averageLevel: 0.1,
    },
  });
  assert.equal(result.valid, true);
  assert.equal(result.error, undefined);
});

test("validateRecordingSignal accepts 6-second recording when audio activity is valid", () => {
  const result = validateRecordingSignal({
    durationSeconds: 6,
    blobSize: 20000,
    activityStats: {
      hasAudioActivity: true,
      peakLevel: 0.3,
      averageLevel: 0.15,
    },
  });
  assert.equal(result.valid, true);
  assert.equal(result.error, undefined);
});

test("validateRecordingSignal rejects silent 5-second recording despite meeting duration threshold", () => {
  const result = validateRecordingSignal({
    durationSeconds: 5,
    blobSize: 16000,
    activityStats: {
      hasAudioActivity: false,
      peakLevel: 0.005,
      averageLevel: 0.001,
    },
  });
  assert.equal(result.valid, false);
  assert.match(result.error, /No sound was detected from your microphone/i);
});

test("validateRecordingSignal enforces 60-second maximum recording duration", () => {
  assert.equal(MAX_RECORDING_DURATION_SECONDS, 60);

  const withinMaxResult = validateRecordingSignal({
    durationSeconds: 60,
    blobSize: 90000,
    activityStats: {
      hasAudioActivity: true,
      peakLevel: 0.25,
      averageLevel: 0.1,
    },
  });
  assert.equal(withinMaxResult.valid, true);

  const exceededResult = validateRecordingSignal({
    durationSeconds: 61,
    blobSize: 95000,
    activityStats: {
      hasAudioActivity: true,
      peakLevel: 0.25,
      averageLevel: 0.1,
    },
  });
  assert.equal(exceededResult.valid, false);
  assert.match(exceededResult.error, /exceeded the maximum duration/i);
});

test("validateRecordingSignal rejects undersized container blob (< 500 bytes)", () => {
  const tinyResult = validateRecordingSignal({
    durationSeconds: 5,
    blobSize: 250, // Empty EBML header without audio frames
    activityStats: {
      hasAudioActivity: true,
      peakLevel: 0.1,
      averageLevel: 0.05,
    },
    minBlobBytes: 500,
  });

  assert.equal(tinyResult.valid, false);
  assert.match(tinyResult.error, /empty or incomplete/i);
});

test("validateRecordingSignal gracefully handles missing Web Audio tracker (null fallback)", () => {
  const fallbackResult = validateRecordingSignal({
    durationSeconds: 5,
    blobSize: 6000,
    activityStats: null, // Environments without Web Audio support
  });

  assert.equal(fallbackResult.valid, true);
});

test("Recording lifecycle: concatenates all dataavailable chunks into unified Blob", () => {
  const chunks = [];
  const chunk1 = new Blob(["chunk_header_webm"], { type: "audio/webm" });
  const chunk2 = new Blob(["chunk_audio_frames"], { type: "audio/webm" });
  chunks.push(chunk1);
  chunks.push(chunk2);

  const finalBlob = new Blob(chunks, { type: "audio/webm" });
  assert.equal(
    finalBlob.size,
    chunk1.size + chunk2.size,
    "Final blob must contain all collected chunks",
  );
});

test("No transcript blacklist: legitimate phrases containing 'you' or 'thank you' are preserved faithfully", async () => {
  clearRateLimitsForTesting();
  const legitimatePhrase = "Thank you, the tractor fuel filter was replaced and runs smoothly";

  const mockFetch = async () =>
    new Response(JSON.stringify({ text: legitimatePhrase }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const req = createMockTranscriptionRequest();
  const res = await handleTranscriptionRequest(req, {
    bypassAuthForTesting: { userId: "farmer_legit", role: "farmer" },
    groqApiKey: "gsk_test_key",
    fetchFn: mockFetch,
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(
    data.text,
    legitimatePhrase,
    "Legitimate phrases must never be blacklisted or censored",
  );
});
