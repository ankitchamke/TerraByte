# Phase 12: Multilingual Farmer Experience Implementation Plan

> **Scope**: Farmer Portal (`/farmer/*`, intake wizard, tracking stepper, quotes, equipment fleet)  
> **Supported Languages**: English (`en`), Hindi (`hi`), Marathi (`mr`)  
> **Status**: Ready for Implementation (Awaiting Explicit User Authorization)  
> **Author**: TerraByte Architecture Team  
> **Date**: 2026-11-06  

---

## 1. Executive Summary & Confirmed Decisions

Phase 12 delivers a culturally accessible, trilingual interface tailored specifically to Vidarbha rural operators, extending the farmer-facing portal to support **English (`en`)**, **Hindi (`hi`)**, and **Marathi (`mr`)**.

### Confirmed Architectural Decisions:
1. **Target Audiences & Portal Scope**:
   - **Farmer Portal (`/farmer/*`)**: Fully localized in English, Hindi, and Marathi. Covers equipment registration, breakdown reporting wizard, repair tracking stepper, quote review & authorization, and message communication.
   - **Technician & Service Centre Portals (`/technician/*`, `/admin/*`)**: Remain strictly in English for the current scope.
2. **Speech-to-Text & Canonical Voice Transcript Preservation**:
   - The existing voice transcription service (`src/lib/services/transcription-service.ts`) uses Groq Whisper Large V3 with automatic language detection across Marathi, Hindi, and English.
   - Spoken audio transcripts are preserved as the **canonical record** in their original spoken language.
   - The application **must never automatically overwrite original spoken transcripts with machine translations**.
3. **Free-Tier & Zero External Cost Guarantee**:
   - All services and localization components must remain 100% free of cost.
   - Zero paid translation APIs, per-token cloud MT endpoints, or commercial i18n SDKs.
   - Zero risk of surprise charges or billing plan auto-upgrades.
4. **Lightweight, Type-Safe Architecture**:
   - Pure TypeScript dictionary approach (`src/lib/i18n/`) with compile-time type safety.
   - Zero heavy external runtime bundles.
   - User language preference stored in `localStorage` with fallback to browser language, and optional synchronization with `profiles.preferred_language`.
5. **Typography & Mobile Responsiveness**:
   - Use Google Fonts **Noto Sans Devanagari** web font stack for pristine rendering of Hindi and Marathi conjuncts, ligatures, and matras.
   - Verified zero horizontal overflow and zero button/card clipping on 320px–375px viewports under Devanagari text length expansion (typically +15% to +35% character width compared to English).
6. **Automated Verification**:
   - Translation key parity test enforcing 100% parity across `en`, `hi`, and `mr` dictionaries.
   - Mobile responsive regression tests for 320px–375px viewports.

---

## 2. Technical Architecture & Component Design

### 2.1 Dictionary Structure (`src/lib/i18n/`)

```text
src/lib/i18n/
├── dictionaries/
│   ├── en.ts        # Canonical English dictionary (source of truth schema)
│   ├── hi.ts        # Hindi translations (Devanagari script)
│   └── mr.ts        # Marathi translations (Devanagari script)
├── types.ts         # Inferred TranslationSchema, SupportedLanguage ('en' | 'hi' | 'mr')
└── index.ts         # Language context/hook: useTranslation(), setLanguage(), currentLanguage
```

#### Type Definition:
```typescript
export type SupportedLanguage = 'en' | 'hi' | 'mr';

export type TranslationDictionary = typeof import('./dictionaries/en').en;
```

### 2.2 UI Language Selector

- Embedded seamlessly in the main navigation bar/header (`src/components/Navigation.tsx` / `src/routes/__root.tsx` or farmer layout).
- Compact, farmer-friendly selector rendering native language names:
  - English: `English`
  - Hindi: `हिन्दी`
  - Marathi: `मराठी`
- Mobile-optimized touch target ($\ge 44\text{px}$) with active state badge.

### 2.3 Key Localization Domains

| Domain | Keys Required | Examples (EN / HI / MR) |
| :--- | :--- | :--- |
| **Common / Navigation** | Actions, roles, statuses, buttons | Back, Save, Submit, Cancel / वापस, सहेजें, जमा करें, रद्द करें / मागे, जतन करा, सबमिट करा, रद्द करा |
| **Breakdown Intake** | Machine select, symptoms, voice, photo consent | "Report Breakdown", "Engine overheating", "Record Voice" / "समस्या दर्ज करें", "इंजन अधिक गर्म होना", "आवाज़ रिकॉर्ड करें" / "समस्या नोंदवा", "इंजिन गरम होणे", "आवाज रेकॉर्ड करा" |
| **Visual Diagnostics** | Consent disclaimer, component tags, severity | "AI Analysis", "Authoritative physical check", "Critical" / "एआई विश्लेषण", "भौतिक निरीक्षण अधिकृत है", "गंभीर" / "एआय विश्लेषण", "प्रत्यक्ष तपासणी अधिकृत आहे", "गंभीर" |
| **Tracking Stepper** | Lifecycle steps, dispatch notes, ETAs | "Technician Dispatched", "Work in Progress", "Completed" / "कारीगर निकल चुके हैं", "काम जारी है", "काम पूरा हुआ" / "तंत्रज्ञ रवाना झाले", "काम चालू आहे", "काम पूर्ण झाले" |
| **Quote Review** | Itemized breakdown, approve, dispute | "Review Quotation", "Approve Quote", "Dispute Line Item" / "कोटेशन देखें", "कोटेशन स्वीकारें", "आपत्ति दर्ज करें" / "कोटेशन पहा", "कोटेशन मंजूर करा", "तक्रार नोंदवा" |
| **Equipment Fleet** | Machine cards, registration, health | "Add Machinery", "Tractor", "Harvester" / "उपकरण जोड़ें", "ट्रैक्टर", "हार्वेस्टर" / "यंत्रसामग्री जोडा", "ट्रॅक्टर", "हार्वेस्टर" |

---

## 3. Implementation Steps (Work Queue)

When authorized, Phase 12 will proceed through the following orderly steps:

### Step 1: Foundation & Dictionary Schema
- Define `TranslationDictionary` schema in `src/lib/i18n/types.ts`.
- Author `en.ts` capturing all farmer-facing user strings.
- Author `hi.ts` with accurate, rural Vidarbha Hindi terminology.
- Author `mr.ts` with idiomatic, rural Vidarbha Marathi terminology.
- Implement `I18nProvider` and `useTranslation()` hook with `localStorage` persistence and fallback handling.

### Step 2: Typography & Devanagari Font Stack
- Integrate Google Font **Noto Sans Devanagari** in index HTML / CSS root (`src/index.css` / `styles.css`).
- Ensure font fallback stack: `'Noto Sans Devanagari', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`.
- Test rendering of complex ligatures (e.g., ट्रैक्टर / ट्रॅक्टर, दुरुस्ती / मरम्मत).

### Step 3: Farmer Navigation & Language Selector
- Add language switcher widget to navbar / farmer layout.
- Ensure 1-click switching with instantaneous reactive UI re-render without page refresh.

### Step 4: Farmer Route Localization
- Localize `/farmer` dashboard.
- Localize `/farmer/report-breakdown` wizard.
- Localize `/farmer/repair/$id` detail view, tracking stepper, and quote review modal.
- Localize `<VisualDefectDiagnosticViewer />` farmer-facing disclaimers and status badges.
- Localize `/farmer/equipment` fleet view and machine registration dialog.

### Step 5: Canonical Voice Preservation Verification
- Verify that Groq Whisper transcriptions in Marathi, Hindi, and English are written to the breakdown description as spoken.
- Verify that language switching does not replace or overwrite original spoken text with translated variants.

### Step 6: Automated Testing & Mobile Viewport Audit
- Implement `tests/i18n-dictionary-parity.test.mjs` verifying 100% key match across `en`, `hi`, and `mr`.
- Verify 320px, 360px, and 375px viewports for zero text clipping or horizontal layout breaking.
- Run complete test suite (`npm test`) and full production build (`npm run build`).

---

## 4. Acceptance Criteria & Safeguards

- [ ] **100% Key Parity**: Zero missing keys across `en.ts`, `hi.ts`, and `mr.ts`.
- [ ] **Zero Cost Invariant**: No paid APIs, external SaaS, or automated billing upgrades.
- [ ] **English Portals Untouched**: `/technician/*` and `/admin/*` routes remain in English.
- [ ] **Canonical Transcripts Intact**: Spoken audio text never overwritten by translations.
- [ ] **Mobile Layout Integrity**: Zero horizontal scrollbar or broken layouts at 320px–375px screen width.
- [ ] **Zero Regressions**: All 160 baseline tests pass, and SSR/client builds succeed with zero errors.
