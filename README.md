# PahaadSaathi 2.0 (पहाड़ साथी)

[![Tests](https://img.shields.io/badge/tests-39%20passed-brightgreen.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)]()
[![React Native](https://img.shields.io/badge/React%20Native-0.88-black.svg)]()
[![Expo](https://img.shields.io/badge/Expo%20SDK-58-black.svg)]()
[![NVIDIA AI](https://img.shields.io/badge/NVIDIA%20AI-PaliGemma%20Vision-76B900.svg)]()
[![Supabase](https://img.shields.io/badge/Supabase-Realtime%20%2B%20PostGIS-3ECF8E.svg)]()

> **Autonomous Mountain-Road Safety, Offline BLE Mesh & NVIDIA AI Vision Verification Companion**  
> Built for the Himalayan terrain, Char Dham Yatra pilgrims, local mountain communities, and District Emergency Control Rooms in Uttarakhand.

---

## 🏔️ Overview

Travelling across high-altitude Himalayan corridors (Badrinath, Kedarnath, Joshimath, Uttarkashi, Devprayag, Dhari Devi) poses extreme hazards: sudden cloudbursts, falling rocks, seasonal landslides, road subsidence, and total cellular blackouts.

**PahaadSaathi 2.0** solves these challenges by combining:
1. **Instant Crowdsourced Hazard Reporting** with GPS coordinates and photo evidence.
2. **NVIDIA PaliGemma Vision AI Verification** running on the backend to evaluate visual photo evidence against reported claims, filtering misinformation and optical noise.
3. **Multi-Device Real-Time Sync & Feed** that immediately broadcasts verified hazards and photos from Phone A to Phone B across geographic wards.
4. **Offline-First Store-and-Forward Mesh** leveraging SQLite queues, BLE (Bluetooth Low Energy) multi-hop relays (up to 5 hops), and GSM 03.38 septet-counted Emergency SMS when Internet connectivity drops to zero.
5. **Smart Mountain Routing & 3-Letter Autocomplete** with curated Himalayan passes and Valhalla vehicle-specific hazard collision analysis (Car, 4x4, Motorcycle, Heavy Truck).
6. **District Control Room Dashboard** giving disaster response officers real-time triage tools, AI evidence audit trails, and road closure authority.

---

## 🔄 End-to-End System Workflow

```mermaid
flowchart TD
    %% STAGE 1: EDGE INCIDENT CAPTURE
    subgraph S1 ["1. Edge Capture & Local Attestation (t = 0ms)"]
        A["📱 Citizen / Traveller on Mountain Highway"] --> B["📸 Live Camera Capture (EXIF Freshness ≤ 60 min)"]
        B --> C["📍 High-Precision GPS Geotag + Sector Resolution"]
        C --> D["⚡ Priority Assignment (P0: SOS | P1: High Hazard | P2: Normal)"]
    end

    %% STAGE 2: PSEP INTELLIGENT COMPRESSION & FINGERPRINTING
    subgraph S2 ["2. PSEP Semantic Evidence Pipeline (t = +350ms)"]
        D --> E["🗜️ Adaptive Multi-Tier Compression Engine"]
        E --> F1["💾 Original Source (Preserved Locally for Evidence)"]
        E --> F2["🖼️ Evidence Derivative (1280px / 0.80 Q ≈ 184 KB)"]
        E --> F3["🔍 Micro-Preview Thumbnail (320px / 0.55 Q ≈ 18 KB)"]
        F2 --> G["🔐 Dual Hash: SHA-256 (Integrity) + 64-bit dHash (Duplicate Check)"]
        G --> H["📋 Semantic JSON Manifest (Visual Metadata, No Base64 Bloat)"]
    end

    %% STAGE 3: TRANSPORT DECOUPLING & OFFLINE-FIRST OUTBOX
    subgraph S3 ["3. Transport Decoupling & Queue (t = +400ms)"]
        H --> I{"🌐 Network State Evaluation"}
        I -- "Offline / Dead Zone" --> J["📦 SQLite Outbox WAL (P0-P4 Queue + Exponential Backoff)"]
        J --> K1["📡 BLE Mesh Store-and-Forward (5-Hop Relay)"]
        J --> K2["✉️ GSM 03.38 Septet-Optimized Emergency SMS"]
        I -- "Online / Weak 2G" --> L["🚀 Transport Decoupling Layer"]
        L --> M1["📨 Low-Latency Metadata via MQTT 5.0 WSS (< 684 Bytes)"]
        L --> M2["☁️ Media Payloads via HTTPS Supabase Storage"]
    end

    %% STAGE 4: MQTT 5-STAGE ZERO-LOSS GUARANTEE
    subgraph S4 ["4. MQTT 5.0 Event Ingress (t = +450ms .. 650ms)"]
        M1 --> N["⚙️ EMQX 5.0 Enterprise Broker (TLS WSS)"]
        N -- "Stage 2: PUBACK (28ms)" --> M1
        N --> O["⚡ Ingress Event Consumer & Deduplication Engine"]
        O -- "Stage 3: Dequeued" --> P["🗄️ Supabase PostgreSQL + PostGIS (180ms)"]
        P -- "Stage 4: DB Committed" --> Q["📢 Bidirectional Delivery ACK Coordinator"]
        Q -- "Stage 5: Client Confirmed" --> A
    end

    %% STAGE 5: NVIDIA PALIGEMMA AI TRUTH SHIELD
    subgraph S5 ["5. Autonomous AI Verification (t = +800ms)"]
        P --> R["🤖 NVIDIA PaliGemma Vision-Language Model"]
        M2 --> R
        R --> S{"Cross-Examine Photo vs User Claim"}
        S -- "Consistent (Landslide/Debris Detected)" --> T["✅ Mark Verified + Assign Trust Score"]
        S -- "Contradiction (Clean Dry Road Reported as Flood)" --> U["🚫 Auto-Reject Fake / Misinformation"]
        S -- "Obscured / Heavy Fog" --> V["⚠️ Escalate to Human Moderator Queue"]
    end

    %% STAGE 6: GEOSPATIAL RADAR & BROADCAST
    subgraph S6 ["6. Geospatial Dispatch & Radar (t = +900ms)"]
        T --> W["🎯 Haversine Proximity Filter (Strict 50 km Radius)"]
        W --> X1["🚨 Push Incident Warning to In-Range Drivers (< 50 km)"]
        W --> X2["🗺️ Live Interactive Map & Incident Feed Update"]
        T --> Y["🏢 District Control Room (DEOC / SDRF / NHAI Triage)"]
        Y --> Z["🚧 Official Road Closure & Diversion Broadcast"]
    end
```

---

### Detailed 6-Stage Engineering Lifecycle

| Stage | Subsystem | Latency Budget | Engineering Responsibility |
|---|---|---|---|
| **1. Edge Capture & Local Attestation** | Mobile Client (`Expo / React Native`) | `t = 0 ms` | User captures live incident. Enforces device hardware camera lock with EXIF timestamp validation (freshness window ≤ 60 min) and GPS geotagging to prevent gallery re-uploads. |
| **2. PSEP Semantic Evidence Engine** | `src/services/media/` | `t = +350 ms` | On-device pipeline creates 3 derivatives: Original (persisted locally), Evidence (1280px / 0.80, **15.4× reduction** to 184 KB), and Preview (320px / 0.55, 18 KB). Computes cryptographic SHA-256 and 64-bit dHash perceptual fingerprint with Hamming distance duplicate detection (≤ 8 bits). Generates compact `SemanticEvidenceManifest`. |
| **3. Transport Decoupling & Resilience** | `src/lib/sqlite/` & `src/lib/sms/` | `t = +400 ms` | **Decouples compact metadata from heavy media**. Metadata (< 684 B) is transmitted over MQTT 5.0 WSS while photographic assets upload asynchronously over HTTPS. In complete cellular blackouts, records drop into SQLite Outbox WAL and propagate via 5-hop BLE mesh relay or GSM 03.38 Emergency SMS. |
| **4. 5-Stage Zero-Loss Delivery Guarantee** | `src/services/mqtt/` | `t = +450 - 650 ms` | Protocol guarantee across all tiers: <br>1. `LOCALLY_QUEUED`: Saved in SQLite Outbox. <br>2. `BROKER_RECEIVED`: EMQX PUBACK confirmed (28 ms). <br>3. `BACKEND_RECEIVED`: Ingress processor dequeues message. <br>4. `DATABASE_PERSISTED`: Committed to PostgreSQL transaction (180 ms). <br>5. `CLIENT_CONFIRMED`: Originating client receives ACK and flushes outbox. |
| **5. Autonomous AI Truth Shield** | `NVIDIA PaliGemma VLM` | `t = +800 ms` | Multimodal server-side model compares photograph against user text. Emits `CONSISTENT`, `PARTIALLY_CONSISTENT`, `INCONSISTENT`, or `INSUFFICIENT_EVIDENCE`. Contradictory reports (fake news/hoaxes) are rejected automatically with visual evidence logged for audit. |
| **6. Geospatial Radar & Authority Dispatch** | `PostGIS` & `Control Room` | `t = +900 ms` | Haversine formula caps hazard alerts strictly to vehicles within a **50 km proximity radius**, preventing panic and notification fatigue. SDRF, Police, and NHAI engineers in the District Control Room review triage queues and issue verified highway closures and bypass routes with one click. |

---

## 📂 Repository Structure

```text
├── assets/                     # App branding, icons, and static graphics
├── docs/                       # Technical design documents & architecture specs
│   ├── CURRENT_ARCHITECTURE.md # Full architecture review
│   ├── DATABASE_SCHEMA.md      # Postgres / PostGIS schema definitions
│   ├── OFFLINE_ENGINE.md       # BLE store-and-forward & SQLite outbox spec
│   └── SMS_ARCHITECTURE.md     # GSM 03.38 septet calculation & fallback spec
├── src/
│   ├── app/                    # Expo Router screens
│   │   ├── (tabs)/             # Tab navigation (Home, Community, Map, Profile)
│   │   ├── control-room/       # District Emergency Control Room officer portal
│   │   ├── hazard/[id].tsx     # Hazard detail view with AI Verification Card
│   │   ├── report.tsx          # Incident reporting flow with camera & GPS
│   │   └── community.tsx       # Local Tehsil ecosystem (Feed, Help, Volunteers, Shelters)
│   ├── components/             # Reusable UI components
│   │   ├── HazardVerificationStatus.tsx # 7-state AI verification evidence UI
│   │   ├── GooglePlaceAutocompletePicker.tsx # 3-letter instant mountain search
│   │   └── BottomNavigation.tsx# Native responsive tab bar
│   ├── data/                   # Data layers & MobX/reactive stores
│   │   ├── hazardStore.ts      # Multi-device sync, real-time feed & offline outbox
│   │   └── communityStore.ts   # Tehsil-level emergency directory & volunteer posts
│   ├── lib/
│   │   ├── hazardVerification.ts # Core NVIDIA PaliGemma verification engine
│   │   ├── storage.ts          # Resilient Supabase photo upload
│   │   ├── supabase.ts         # Supabase client singleton & offline fallback
│   │   ├── routing/            # Valhalla routing & hazard proximity calculation
│   │   ├── relay/              # BLE mesh protocol & store-and-forward engine
│   │   └── sms/                # GSM-7 encoded emergency SMS dispatch
│   ├── theme/                  # Design tokens, Himalayan color palette, typography
│   └── types/                  # TypeScript contracts & verification data models
├── supabase/
│   ├── functions/
│   │   └── verify-hazard-image/# Supabase Deno Edge Function for PaliGemma
│   ├── migrations/             # Additive migrations (core schema + AI verification)
│   └── fix_columns.sql         # Idempotent database schema repair script
├── package.json
└── tsconfig.json
```

---

## 🛠️ Technology Stack

| Layer | Technologies |
| --- | --- |
| **Frontend Framework** | React Native 0.88, React 19, Expo SDK 58, Expo Router |
| **Language & Typings** | TypeScript 5.9 with strict type checking (0 errors) |
| **AI Vision Verification** | NVIDIA PaliGemma Vision Language Model (`vlm/google/paligemma`) |
| **Backend & Database** | Supabase, PostgreSQL 15, PostGIS, Deno Edge Functions |
| **Offline & Mesh Relay** | Expo SQLite, `munim-bluetooth`, `react-native-nitro-modules` (BLE) |
| **Routing & Geo-Search** | Valhalla Directions API, Photon Geocoder, Curated Himalayan Node Database |
| **Testing** | Node.js native test runner (`tsx --test`), 39 automated unit & integration tests |

---

## ⚙️ Environment Configuration

Create a `.env` file in the root directory (based on `.env.example`):

```bash
# Public Expo Variables (Bundled into client application)
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-key
EXPO_PUBLIC_VALHALLA_URL=https://valhalla1.openstreetmap.de

# Private Backend Variables (NEVER expose to client code or prefix with EXPO_PUBLIC_)
NVIDIA_API_KEY=nvapi-your-nvidia-paligemma-api-key
SUPABASE_SERVICE_ROLE_KEY=your-backend-service-role-key
```

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js 20 or newer
- npm 10 or newer
- Expo Go app on mobile (or Android Studio / Xcode for native BLE development)

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/Sagar264offici/PahaadSaathi2.0.git
cd PahaadSaathi2.0

# Install dependencies
npm install
```

### 3. Run Automated Tests
Verify all 39 tests across verification, offline outbox, BLE relay, and SMS encoding:
```bash
npm run test
```

### 4. Start Expo Development Server
```bash
npx expo start
```
Scan the QR code with **Expo Go** on your Android or iOS devices.

---

## 🧪 Database & Storage Setup

1. In your **Supabase Dashboard**, navigate to the **SQL Editor**.
2. Run [`supabase/fix_columns.sql`](supabase/fix_columns.sql) — this idempotently creates:
   - `hazards` table with geo-coordinates, photo URLs, and severity fields.
   - `ai_verification_*` columns (`status`, `result`, `verdict`, `model`, `error_code`, `attempts`).
   - `idx_hazards_ai_status_verdict` performance indexes and RLS read/write policies.
3. Ensure the storage bucket `Hazard-Photos` exists and has public read access for hazard imagery.

---

## 🛡️ AI Ethics, Safety & Limitations

- **Advisory Role Only**: The NVIDIA PaliGemma AI engine provides evidence analysis for human decision-makers. It never autonomously closes roads, cancels emergency alerts, or deletes community reports.
- **Privacy First**: User identifiers, phone numbers, and precise GPS coordinates are stripped before submitting images to the vision model.
- **Fail-Safe Operation**: If the AI model times out or encounters rate limits (HTTP 429), the hazard report remains fully accessible and is marked for manual officer review without interrupting app functionality.
