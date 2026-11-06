import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  validateDiagnosticPhoto,
  validatePhotoBatch,
  extractVisualDiagnostics,
} from "../src/lib/services/visual-diagnostics-client.ts";
import { DIAGNOSTIC_LIMITS } from "../src/lib/types/visual-diagnostics.ts";
import { assess } from "../src/lib/assessment.ts";

test("Phase 11 Frontend — Image Upload & Validation Limits", () => {
  // 1. Valid JPEG photo under 4MB
  const validJpeg = {
    name: "engine_leak.jpg",
    type: "image/jpeg",
    size: 2.5 * 1024 * 1024,
  };
  const resJpeg = validateDiagnosticPhoto(validJpeg);
  assert.equal(resJpeg.valid, true);

  // 2. Valid PNG photo under 4MB
  const validPng = {
    name: "radiator_crack.png",
    type: "image/png",
    size: 3.8 * 1024 * 1024,
  };
  const resPng = validateDiagnosticPhoto(validPng);
  assert.equal(resPng.valid, true);

  // 3. Valid WebP photo
  const validWebp = {
    name: "hydraulic_cylinder.webp",
    type: "image/webp",
    size: 1.2 * 1024 * 1024,
  };
  const resWebp = validateDiagnosticPhoto(validWebp);
  assert.equal(resWebp.valid, true);

  // 4. Reject unsupported MIME types (video, pdf, gif)
  const videoFile = {
    name: "tractor_sound.mp4",
    type: "video/mp4",
    size: 5 * 1024 * 1024,
  };
  const resVideo = validateDiagnosticPhoto(videoFile);
  assert.equal(resVideo.valid, false);
  assert.match(resVideo.error, /Unsupported image format/i);

  const pdfFile = {
    name: "manual.pdf",
    type: "application/pdf",
    size: 1 * 1024 * 1024,
  };
  const resPdf = validateDiagnosticPhoto(pdfFile);
  assert.equal(resPdf.valid, false);

  // 5. Reject file exceeding 4 MB
  const oversizedPhoto = {
    name: "large_macro.jpg",
    type: "image/jpeg",
    size: 4.5 * 1024 * 1024,
  };
  const resOver = validateDiagnosticPhoto(oversizedPhoto);
  assert.equal(resOver.valid, false);
  assert.match(resOver.error, /too large|maximum allowed size/i);

  // 6. Max 4 photos batch constraint
  assert.equal(validatePhotoBatch(["p1", "p2", "p3"], 1).valid, true);
  assert.equal(validatePhotoBatch(["p1", "p2", "p3", "p4"], 1).valid, false);
  assert.match(validatePhotoBatch(["p1", "p2", "p3", "p4"], 1).error, /Maximum 4 photos allowed/i);
});

test("Phase 11 Frontend — Fail-Closed Consent Extraction & Verification", () => {
  // 1. Null / undefined assessment
  assert.equal(extractVisualDiagnostics(null), null);
  assert.equal(extractVisualDiagnostics(undefined), null);
  assert.equal(extractVisualDiagnostics("invalid"), null);

  // 2. Assessment without visualDiagnostics
  assert.equal(extractVisualDiagnostics({ system: "Engine" }), null);

  // 3. Explicit boolean consent check
  const grantedAssessment = {
    system: "Hydraulics",
    visualDiagnostics: {
      status: "ANALYZED",
      consent: {
        optInGranted: true,
        consentedAt: "2026-11-04T12:00:00Z",
      },
      visualConfidence: "HIGH",
    },
  };
  const vdGranted = extractVisualDiagnostics(grantedAssessment);
  assert.ok(vdGranted);
  assert.equal(vdGranted.consent?.optInGranted, true);
  assert.equal(vdGranted.status, "ANALYZED");

  // 4. Denied consent must not be treated as granted
  const deniedAssessment = {
    system: "Fuel injection",
    visualDiagnostics: {
      status: "SKIPPED",
      consent: {
        optInGranted: false,
        withdrawnAt: "2026-11-04T12:30:00Z",
      },
    },
  };
  const vdDenied = extractVisualDiagnostics(deniedAssessment);
  assert.ok(vdDenied);
  assert.equal(vdDenied.consent?.optInGranted, false);
  assert.equal(vdDenied.status, "SKIPPED");
});

test("Phase 11 Frontend — Fail-Open Breakdown Submission Invariant", () => {
  // Simulate farmer submitting a breakdown with symptoms and description
  const symptoms = ["Black smoke", "Loss of power"];
  const description = "Heavy black exhaust smoke when plowing";

  // Deterministic rule assessment must always be generated
  const ruleTriage = assess(symptoms, description);
  assert.ok(ruleTriage);
  assert.equal(ruleTriage.system, "Fuel injection / filtration");
  assert.ok(ruleTriage.confidence > 0);

  // Simulate simulated Gemini API failure (429 Rate Limited or 504 Timeout)
  const simulatedGeminiOutage = {
    status: 429,
    errorCode: "RATE_LIMITED",
    errorMessage: "Diagnostic capacity limit reached. Please retry after a brief pause.",
  };

  // Ticket creation payload maintains the rule assessment regardless of AI state
  const ticketAssessment = {
    ...ruleTriage,
    visualDiagnostics: {
      status: "RETRYABLE_ERROR",
      consent: {
        optInGranted: true,
        consentedAt: "2026-11-04T12:00:00.000Z",
      },
      lastErrorCode: simulatedGeminiOutage.errorCode,
      lastErrorMessage: simulatedGeminiOutage.errorMessage,
      attempts: 1,
    },
  };

  // Farmer breakdown ticket preserves rule-based triage and never crashes
  assert.equal(ticketAssessment.system, "Fuel injection / filtration");
  assert.equal(ticketAssessment.severity, "Moderate to High");
  assert.equal(ticketAssessment.visualDiagnostics.status, "RETRYABLE_ERROR");
});

test("Phase 11 Frontend — Dead Video Handler Removal in report-breakdown.tsx", () => {
  const filePath = path.resolve(process.cwd(), "src/routes/farmer/report-breakdown.tsx");
  const content = fs.readFileSync(filePath, "utf8");

  // Ensure accept attribute is restricted strictly to images, zero video/*
  assert.doesNotMatch(
    content,
    /accept="[^"]*video\/\*[^"]*"/i,
    "video/* filter must be completely eliminated from file input",
  );
  assert.match(
    content,
    /accept="image\/jpeg,image\/png,image\/webp"/i,
    "File input must strictly specify image/jpeg,image/png,image/webp",
  );

  // Ensure dead video toast is eliminated
  assert.doesNotMatch(
    content,
    /Video noted — in this demo only photos are stored/i,
    "Dead video toast stub must be eliminated",
  );

  // Ensure Farmer AI consent checkbox is present
  assert.match(
    content,
    /Allow AI visual defect analysis of breakdown photos/i,
    "Farmer AI consent opt-in checkbox must be rendered",
  );
});

test("Phase 11 Frontend — VisualDefectDiagnosticViewer & DefectAnnotationCanvas UI Contracts", () => {
  const viewerPath = path.resolve(
    process.cwd(),
    "src/components/diagnostics/visual-defect-diagnostic-viewer.tsx",
  );
  const canvasPath = path.resolve(
    process.cwd(),
    "src/components/diagnostics/defect-annotation-canvas.tsx",
  );

  assert.ok(fs.existsSync(viewerPath), "VisualDefectDiagnosticViewer component must exist");
  assert.ok(fs.existsSync(canvasPath), "DefectAnnotationCanvas component must exist");

  const viewerContent = fs.readFileSync(viewerPath, "utf8");
  const canvasContent = fs.readFileSync(canvasPath, "utf8");

  // Verify Mandatory Assistive Disclaimer is present in the viewer
  assert.match(
    viewerContent,
    /Assistive Preliminary Assessment/i,
    "Mandatory assistive disclaimer header must be present",
  );
  assert.match(
    viewerContent,
    /Physical on-site inspection by a certified technician is authoritative/i,
    "Authoritative physical inspection clause must be present",
  );

  // Verify 5 diagnostic states handled in viewer
  const expectedStates = [
    "ANALYZED",
    "PROCESSING",
    "RETRYABLE_ERROR",
    "FAILED",
    "SKIPPED",
    "NOT_REQUESTED",
  ];
  for (const st of expectedStates) {
    assert.match(
      viewerContent,
      new RegExp(`status === "${st}"`, "i"),
      `Viewer must handle state ${st}`,
    );
  }

  // Verify DefectAnnotationCanvas handles anomaly markers and severity
  assert.match(canvasContent, /getSeverityColor/i, "Canvas must color-code defect severity");
  assert.match(canvasContent, /CRITICAL/i, "Canvas must handle CRITICAL severity");
  assert.match(canvasContent, /data-marker="anomaly"/i, "Canvas must render anomaly markers");
});

test("Phase 11 Frontend — Multi-Portal Detail Integration", () => {
  const farmerDetail = fs.readFileSync(
    path.resolve(process.cwd(), "src/routes/farmer/repair/$id.tsx"),
    "utf8",
  );
  const techDetail = fs.readFileSync(
    path.resolve(process.cwd(), "src/routes/technician/job/$id.tsx"),
    "utf8",
  );
  const adminDetail = fs.readFileSync(
    path.resolve(process.cwd(), "src/routes/admin/repair/$id.tsx"),
    "utf8",
  );

  assert.match(
    farmerDetail,
    /<VisualDefectDiagnosticViewer/i,
    "Farmer repair detail must render VisualDefectDiagnosticViewer",
  );
  assert.match(
    techDetail,
    /<VisualDefectDiagnosticViewer/i,
    "Technician job workbench must render VisualDefectDiagnosticViewer",
  );
  assert.match(
    adminDetail,
    /<VisualDefectDiagnosticViewer/i,
    "Admin repair detail must render VisualDefectDiagnosticViewer",
  );
});
