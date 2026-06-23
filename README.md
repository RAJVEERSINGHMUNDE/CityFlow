# CityFlow: Event-Driven Congestion Intelligence
**A Graph AI & Operations Research Digital Twin for Bengaluru**

CityFlow is a macro-level decision-support system that predicts traffic congestion caused by planned events (e.g., rallies, festivals) and unplanned incidents (e.g., accidents, breakdowns). It replaces guesswork with mathematically grounded Operations Research, generating optimal barricade placements and diversion plans based on topological network shockwaves.

---

## Hackathon Compliance & Architecture Report

This repository successfully addresses **Problem Statement 2: Event-Driven Congestion** by implementing all required pillars.

### 1. Pre-Event Traffic Impact Forecasting
> *Requirement: Use historical incident data to forecast the expected severity, duration, and traffic impact of an event before it happens.*

**How CityFlow Solves It:**
- **Severity Prediction (`severity_model.py`):** Uses a Gradient Boosting + Random Forest ensemble trained on Bengaluru traffic history. Predicts a Response Level (Green, Amber, Red) based on location, time of day, and event type.
- **Cox Proportional Hazards Model (`survival_model.py`):** Predicts the clearance time (duration) accounting for right-censoring in traffic datasets.
- **NLP Weak-Label Classification (`nlp_impact.py`):** Uses Google's `LaBSE` transformer to extract disruption severity directly from Kannada/English operator logs (e.g., highlighting "ನಿಧಾನ" or "heavy traffic").

### 2. Live Spatial-Temporal Route Planning
> *Requirement: Suggest diversion routes that avoid congested arterial roads.*

**How CityFlow Solves It:**
- **Topological Shockwave (`simulator.py`):** Instead of using naive Euclidean radius logic (which incorrectly blocks parallel, unaffected roads), CityFlow uses a reverse-BFS queue to propagate capacity decay *upstream* along the actual road graph.
- **BPR Capacity Decay with V/C Spillover Penalties:** Implements the Bureau of Public Roads (BPR) capacity formula. If the Volume/Capacity (V/C) ratio exceeds 0.85, a strict spillover penalty multiplier is applied, forcing Dijkstra's algorithm to find truly free-flowing alternative routes.
- **Volume-Aware Flows:** Arterial flows are selected based on a mathematically rigorous composite score (Route Distance × Average Hourly Capacity), prioritizing heavy vehicle corridors.

### 3. Data-Driven Manpower & Barricade Allocation
> *Requirement: Suggest the optimal number of police personnel and barricades based on real-time event scale and attendance.*

**How CityFlow Solves It:**
- **Continuous Flow Barricading:** Computationally traces upstream from closed segments until it finds an intersection with a safe out-degree ($\geq 1$). This ensures barricades do not create dead-ends or U-turn traps.
- **Explainable Staffing (`manpower.py`):** Generates an exact staffing plan using weights calibrated against historical feedback. It considers `severity`, `closure scale`, `attendance`, and `time of day`, solving the "Cold Start" problem with a seeded data-driven configuration.

### 4. Post-Event Learning Loop
> *Requirement: Learn from past events to improve future predictions.*

**How CityFlow Solves It:**
- **Incremental NLP Retraining:** Whenever an operator confirms an event's severity via the `/api/feedback` endpoint, the `LaBSE` logistic head is retrained iteratively *without catastrophic forgetting*, allowing the system to learn new traffic jargon on the fly.
- **Least Squares Weight Refit:** Manpower weights dynamically shift based on historical resolution efficacy.

---

## Quick Start

We've bundled the Flask API and the React/Vite dashboard into a straightforward local setup.

### 1. Start the Backend API
Open a terminal and run the following commands:
```bash
# Install Python dependencies
pip install -r src/requirements.txt

# Start the Flask server
python src/run_all.py
```
*The API will run on `http://localhost:8000`*

### 2. Start the Frontend Dashboard
Open a new terminal and navigate to the dashboard directory:
```bash
cd src/dashboard

# Install Node dependencies
npm install

# Start the development server
npm run dev
```
*The Dashboard UI will run on `http://localhost:3000`*

---

## Demo Guide for Judges

To experience CityFlow's capabilities, open the Dashboard (`localhost:3000`) and click **"Load Demo"** in the left panel. This pre-loads three distinct edge-cases into the memory:

1. **Planned Mega-Event:** A cricket match at M. Chinnaswamy Stadium (35,000 attendance). Notice how the system automatically expands the congestion spillover radius due to the massive scale.
2. **Unplanned Incident:** A heavy multi-axle breakdown on the Outer Ring Road.
3. **Multilingual NLP Explainability:** An incident reported via radio transcript in Kannada ("ಟ್ರಾಫಿಕ್ ತುಂಬಾ ನಿಧಾನವಾಗಿದೆ"). Observe the **NLP Explainability Widget** in the right panel highlighting exactly which keywords triggered the severe disruption score.

### The Split-Screen "With vs Without" View
When a simulation completes, the central view displays two synchronized maps:
- **Baseline (Chaos):** Shows the expected queue spillbacks without police intervention.
- **CityFlow Active:** Shows strategic barricade placements and clean, penalty-validated diversion routes.

---
