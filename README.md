# TerraByte — Agricultural Equipment Repair Ecosystem

TerraByte is a specialized digital agricultural equipment repair ecosystem designed to coordinate the complete journey from machinery breakdown to verified repair and back into the field.

## Core Mission

In rural agriculture, machinery breakdown (tractors, harvesters, power tillers, irrigation pumps) causes devastating field downtime during narrow seasonal sowing and harvest windows.

**Core Outcome**: **REDUCE THE TIME BETWEEN EQUIPMENT BREAKDOWN AND GETTING BACK TO WORK.**

---

## Key Capabilities

* **Farmer Portal**: Rapid 2-minute breakdown reporting, voice input description, photo evidence capture, live 7-step repair tracking, itemized quote review & authorization, and permanent equipment service history.
* **Technician Workbench**: Qualified repair dispatch feed, itemized quotation builder, parts-on-hold delay tracking, and post-repair load testing verification.
* **Service Centre Operations**: Central dispatch oversight, regional equipment fleet tracking, technician account verification, and manual triage/reassignment.
* **Assistive Diagnostic Engine**: Instant preliminary symptom evaluation identifying likely affected mechanical systems, parts categories, and immediate safety advice.
* **Multi-Factor Technician Matching**: Algorithmic ranking based on manufacturer brand specialization, system expertise, live availability, and travel ETA.
* **Model Context Protocol (MCP)**: Server integration exposing diagnostic and matching tools.

---

## Tech Stack

* **Frontend**: [TanStack Start](https://tanstack.com/start) + [React 19](https://react.dev) + [TanStack Router](https://tanstack.com/router)
* **Styling**: [Tailwind CSS 4](https://tailwindcss.com) + [Radix UI](https://www.radix-ui.com) + [Lucide Icons](https://lucide.dev)
* **Backend**: [Supabase](https://supabase.com) (PostgreSQL 17, Supabase Auth, Supabase Storage, Row Level Security)
* **Protocol**: Model Context Protocol (MCP)

---

## Development Setup

### Prerequisites
* Node.js (v20+ recommended)
* npm (v10+ recommended)

### Quick Start

```sh
# Clone repository
git clone https://github.com/ankitchamke/TerraByte.git
cd TerraByte

# Install dependencies
npm install

# Start development server
npm run dev

# Production build
npm run build
```

The application runs on `http://localhost:8080/` by default.

---

## License

Private repository. Copyright © 2026 TerraByte. All rights reserved.
