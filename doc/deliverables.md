# CityFlow 2.0 - Phase 2 Deliverables

Deliverables for the CityFlow Digital Twin submission: here is the checklist of deliverables required for submission:

## 1. Source Code Repository
- **Description**: The complete, functional codebase of the CityFlow Digital Twin.
- **Format**: Public or Private GitHub Repository URL (make sure to grant access to judges if private).
- **Status**: **READY** (The `src/` directory contains the full React + Flask stack).

### Submission-readiness features
- Operator-created planned and unplanned scenarios (`event_type` routing with attendance-aware spillover)
- Event-affected arterial flow selection (volume-aware, ranked by `distance × capacity_score`)
- Do-nothing versus intervention travel-time comparison (with police compliance simulation)
- Differential time-of-day routing (per-class hourly multiplier, route changes between peak/off-peak)
- Closure-avoiding diversion, barricade validation, and structured diversion plan artifact
- Attendance-aware staffing, spillover radius, and severity adjustments
- Pre-event traffic impact forecast (delay-minutes, queue length, vehicle count, response tier)
- Realtime data adapter (pluggable interface with historical-replay mode)
- SQLite-backed outcomes, forecast-error reporting, and model retraining pipeline
- Automated graph intervention and persistence tests (5 unit tests passing)

## 2. Technical Architecture & Documentation
- **Description**: A comprehensive technical whitepaper outlining the mathematical foundations (Reverse-BFS, Dijkstra), algorithms (Continuous Flow Barricading), and system architecture (Asynchronous Polling).
- **Format**: PDF Document or Markdown File.
- **Status**: **READY — synced to BPR architecture** (`doc/technical_whitepaper.md`).

## 3. Pitch Deck / Presentation
- **Description**: A slide deck explaining the problem, the CityFlow solution, the impact, and the business/city-level value. Keep it concise and visually appealing.
- **Format**: PDF Document (usually 5-10 slides max).
- **Status**: *To Be Created* by the team.

## 4. Demonstration Video
- **Description**: A short video (usually 2-3 minutes) demonstrating the working application. It should show a user clicking on an event, the system processing it, and the final interactive map rendering the diversion route and barricades.
- **Format**: YouTube or Google Drive Link (ensure permissions are set to 'Anyone with link can view').
- **Status**: *To Be Recorded* by the team.

---
*Note: Make sure to double-check the final submission form on HackerEarth to ensure there are no additional hidden fields or specific naming conventions requested.*



