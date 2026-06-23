# CityFlow — Video Presentation Script

> **Read-aloud script.** Part 1 covers the math and technical foundations in depth; Part 2 walks through every single visible feature of the UI in order. Each section is self-contained so you can skip to any part while recording.

---

# PART 1 — MATH & TECHNICAL FOUNDATIONS

---

## Slide 1 — The Problem

Political rallies. Festivals. Sports events. Construction. Sudden breakdowns. Every day in Bengaluru, the city loses hours of productivity because we cannot answer three questions:

1. **How bad will this event be?**
2. **Where should the police go?**
3. **Which routes should drivers take?**

Today, all three are answered by experience and gut feel. Nobody learns from the last event. CityFlow is a decision-support system that turns eight thousand past Bengaluru traffic incidents into a learnable, mathematically grounded playbook for every event that disrupts the city.

---

## Slide 2 — The Data

We trained and tested on the city's own event log — `2.csv` — eight thousand two hundred and five rows, spanning a hundred and fifty-one days from November 2023 to April 2024.

- 7,706 unplanned incidents (94.3%)
- 467 planned events (5.7%)
- 6,813 free-text operator descriptions
- 870 of those descriptions are in Kannada
- 2,983 rows have both start and close timestamps — these are the rows we use for survival analysis
- 1,007 rows are still active at the export boundary — they are right-censored
- 137 events have a `route_path` line-string — we use these to snap closures to real OSM edges
- Mean events per day: fifty-three

A practical headline number we will use later: a BMTC bus takes a mean of 77.5 minutes to clear, a private car takes 38.5 minutes. The gap is 2× and is visible in the raw data without any modelling.

---

## Slide 3 — System Architecture (one slide, four pillars)

```
   dataset/2.csv
        │
        ▼
   DataPipeline  ─── cleans, filters, separates planned vs unplanned
        │
        ├─► SeverityPredictor  (GBM regressor + RF classifier)
        ├─► ClearanceForecaster (Cox Proportional Hazards)
        ├─► HotspotAnalyzer     (junction rankings, hourly curve)
        └─► NLPImpactClassifier (LaBSE embeddings + logistic head)
        │
        ▼
   GraphEngine  ─── cached Bengaluru road graph (155K nodes, 393K edges)
        │
        ▼
   CongestionSimulator
        ├─ find_affected_flows     (volume-aware OD selection)
        ├─ simulate_congestion_shockwave  (BPR + reverse-BFS)
        ├─ evaluate_interventions   (baseline vs diverted, with/without police)
        ├─ recommend_barricades     (continuous-flow)
        └─ synthesize_diversion_plan
        │
        ▼
   ManpowerAllocator  ─── linear formula, refit via np.linalg.lstsq
        │
        ▼
   Flask API  ───  async task queue, SQLite memory
        │
        ▼
   React + Vite Dashboard
```

Every component is replaceable. The web is not a black box.

---

## Slide 4 — Math Foundation #1: BPR Travel Time

Every road segment in the city has a length, a free-flow speed, and a free-flow travel time. As traffic builds, that travel time grows non-linearly. We use the **Bureau of Public Roads** formula:

```
t = t₀ · ( 1 + α · (V / C)^β )
```

where `t₀` is the free-flow travel time, `V` is the volume, `C` is the capacity, and the standard coefficients are α = 0.15 and β = 4. The exponent of 4 is what gives the curve its characteristic "hockey stick" — travel time stays close to free-flow until V/C approaches 0.8, then explodes.

A naïve implementation multiplies every edge by the same scalar, which is mathematically useless: if every edge is scaled by the same number, the shortest path between two nodes is unchanged. We will fix that in slide 8.

---

## Slide 5 — Math Foundation #2: Reverse-BFS Shockwave

Naive simulators draw a Euclidean circle around the event and block everything inside it. That is physically wrong — congestion propagates **upstream along connected roads**, not radially.

CityFlow runs a **reverse Breadth-First Search** from the epicenter. For each upstream edge at distance `d` from the event:

```
if d ≤ closure_radius:        capacity ← capacity × 0.05      (closed)
elif d ≤ spillover_radius:    capacity ← capacity × (0.1 + 0.9 · d / spillover_radius)   (linear recovery)
```

So a road 50 metres from the event is essentially shut. A road 600 metres upstream, in a 1 km spillover, keeps 0.64 of its original capacity. A road 1.2 km away is unaffected.

Because we traverse the *actual road graph*, the spillover respects topology. A parallel highway 300 m away but separated by a river is untouched. A dead-end alley 200 m away is correctly identified as one edge deep, not as a region of 12.5 acres.

This single change is what made our Phase-1 evaluation go from "47 false positives eliminated across 10 events" to "the right roads are blocked, every time".

---

## Slide 6 — Math Foundation #3: Volume-Aware Flow Selection

A digital twin has to answer "where will traffic actually try to go?" We pick up to three **arterial origin-destination movements** that pass through the event.

For every boundary node on the upstream side and every boundary node on the downstream side, we run Dijkstra from the origin to the epicenter and from the epicenter to the destination. The full route is the concatenation.

We then score each candidate movement:

```
score = distance_km × average_road_capacity_along_route
```

This is a volume proxy: longer, more arterial routes carry more vehicles. We pick the top 3 by score, **with the constraint that no two share the same origin or destination** — so we never get two flows that are really the same corridor.

---

## Slide 7 — Math Foundation #4: Police Compliance

A barricade without police is not a barricade — it is a suggestion. Bengaluru compliance with un-manned barricades is approximately 40%.

We model this with a binary flag:

- **`police_deployed = True`** — closed edges are removed from the graph entirely. Effective compliance 95%.
- **`police_deployed = False`** — closed edges stay in the graph, but their travel time is multiplied by **1 / 0.4 = 2.5**. This penalises the diversion graph for the non-compliance cost, without removing the edge's existence.

Every recommended diversion is evaluated under both scenarios. The reported "time saved" uses the with-police case, but the API also returns `time_saved_no_police_minutes` and `police_compliance_benefit_minutes` so the operator can see exactly how much of the win comes from police presence versus geometry alone.

---

## Slide 8 — Math Foundation #5: Per-Class Time-of-Day Weighting

We want the recommended route to be **different at 6 PM than at 3 AM**. A uniform scalar cannot do this. So we calibrate a per-hour, per-road-class multiplier:

```
multiplier = max(0.1,  1 + (hourly_mult − 1) × sensitivity[highway])
```

where `hourly_mult` is the historical event-density at that hour, normalised so its 24-hour mean is 1.0, and `sensitivity[highway]` is class-specific:

| Highway class | Sensitivity |
|---|---|
| motorway | 1.6 |
| trunk | 1.5 |
| primary | 1.4 |
| secondary | 1.2 |
| tertiary | 1.1 |
| residential | 0.7 |
| living_street | 0.6 |
| service | 0.6 |
| unclassified | 0.9 |

At rush hour, `hourly_mult ≈ 1.6`. A primary road gets a multiplier of 1.84, a residential road gets 1.42. The relative cost of arterials rises, so Dijkstra routes more flow through residential streets — exactly the behaviour a real driver takes. At 3 AM, the relationship inverts.

The `max(0.1, …)` floor exists for a reason: a residential road at sensitivity 0.7 with `hourly_mult = 0.1` would otherwise produce a multiplier of 0.79 — but with sensitivity 1.6, the same input gives −0.44, which is nonsense. The floor prevents negative weights.

This is what made the Phase-4 evaluation go from "0/10 routes changed between peak and night" to "the route actually differs between the two time-of-day buckets".

---

## Slide 9 — Math Foundation #6: Continuous-Flow Barricade Algorithm

A naïve algorithm: for every closed edge `(u, v)`, place a barricade at the immediate upstream node `u`. **The flaw**: if `u` is a dead-end intersection where the only outgoing path was `(u, v)`, vehicles hit the barricade, can't turn around, and gridlock.

CityFlow's algorithm walks **upstream** from each closed edge until it finds a node `n` where the safe out-degree is at least 1:

```
safe_out_degree(n) = |{ v : (n, v) is open and v ≠ epicenter }|
```

If `n` has no safe exit, we walk to the next upstream node. If we run out of upstream nodes (a true dead end), the barricade is dropped — the road is too small to justify one.

Every recommended barricade is then validated: it must block at least one closure entry *and* offer at least one alternate exit. The validation result is exposed in the API so the dashboard can show "4 barricades, 4 validated".

---

## Slide 10 — ML #1: Severity Prediction (two heads)

We predict two things at once: a continuous resolution time, and a discrete response level.

**Head 1 — Gradient Boosting Regressor on log space:**
```
y = log(1 + resolution_minutes)
features = [ cause, event_type, requires_closure, priority, hour_sin, hour_cos, day_of_week, zone, spatial_cluster, junction_hotspot_score ]
```
We log-transform the target because resolution time is heavily right-skewed. The model is 5-fold cross-validated, R² reported on the training set for transparency.

**Head 2 — Random Forest Classifier:**
```
Green:  resolution_min ≤ 60
Amber:  resolution_min ≤ 480
Red:    otherwise
```

A scenario with an expected attendance of 35,000 and a full closure gets additional operational modifiers on top: a `+1.0` score bonus and a `×1.35` resolution-time multiplier. The 5,000-attendee rally gets `+0.5` and `×1.15`. These modifiers are transparent and rule-based — they let the model act on information that was never in the historical training set (because planned events are rare).

---

## Slide 11 — ML #2: Cox Proportional Hazards for Clearance

The naive thing is to drop censored rows (incidents that were still active at the data export — we never saw them close). That throws away a third of the data and biases the mean downward.

CityFlow uses **Cox Proportional Hazards** with right-censoring, via the `lifelines` library. For each row:

```
T = (close_time − start_time) in minutes
E = 1 if close_time observed,  0 if censored at observation boundary
```

Covariates: vehicle type (BMTC, heavy, LCV), corridor class (highway vs non-corridor), closure requirement, hour-of-day (sin/cos encoding). The model is fit with a small L2 penalty (0.1) for stability.

We report the **concordance index** — the probability that, given two randomly chosen incidents, the model correctly orders them by clearance time. Our current training run hits a C-index in the 0.55 to 0.70 band, which is reasonable for real-world traffic data with this much residual variance.

The 80th-percentile clearance time (`t80`) is then used directly to set the **shift duration** recommendation. That is why our "how long to deploy" answer is statistically grounded, not a hand-tuned clamp.

---

## Slide 12 — ML #3: LaBSE Multilingual NLP

Of the 6,813 free-text operator descriptions, 870 are in Kannada. A model that only reads English misses a sixth of the dataset. We use **LaBSE** (Language-agnostic BERT Sentence Embedding) — a 90 MB sentence-transformer that produces a 768-dimensional multilingual embedding. Kannada "ನಿಧಾನ" ("slow") and English "heavy traffic" land close together in that embedding space.

We then attach a **logistic regression head** trained on weak labels extracted from the descriptions themselves:

```
disrupted = 1  if any of { "slow", "closed", "blocked", "gridlock", "heavy", "ನಿಧಾನ", "ಸಮಸ್ಯ", "ನಿಂತಿದೆ", "ಕ್ಲೋಸ್" } in text
contained = 1  if any of { "no problem", "normal", "moving", "clear", "cleared" } in text
```

The model outputs a `disrupted_prob` in [0, 1] and the specific tokens that triggered the score. In the UI, those tokens are highlighted in red on the operator's report — so the operator can see *why* the AI thinks this is severe.

The output is also folded back into the simulator: `capacity_factor = 1 − disrupted_prob × corridor_closure_weight × 0.5`. A high-probability disruption on a corridor that historically closes often drops capacity further than the same score on a quiet lane.

---

## Slide 13 — ML #4: Manpower Linear Allocator

The number of officers to deploy at a barricade is a learned linear function:

```
officers_per_barricade = intercept
                       + w_severity  × severity_score
                       + w_attendance × (expected_attendance / 1000)
                       + w_rush_hour  × is_rush_hour
                       + w_closure    × requires_closure
```

The default weights are hand-tuned: `0.5, 0.35, 0.15, 1.2, 2.0`. But here is the critical bit — **the weights are not fixed**. After every 10 feedback entries, CityFlow runs `np.linalg.lstsq` on the operator-supplied outcomes and refits all five weights. The new weights are persisted to `manpower_weights.json` and used for every subsequent event.

This is what closes the post-event learning loop. The first event is calibrated on history. The twentieth event is calibrated on your specific corridor, your specific operator, your specific truth.

---

## Slide 14 — ML #5: Post-Event Learning (no catastrophic forgetting)

The NLP classifier has the same learning requirement, but with a twist. If we just refit the logistic head on the latest 10 feedback rows, the model **forgets** the original 1,000+ weak-labelled descriptions. After 50 feedback entries it has seen the 50 most-recent operator labels and nothing else — a textbook case of catastrophic forgetting.

CityFlow solves this by concatenating:

```
X_train = vstack( X_original_weak_labels , X_feedback )
y_train = concat( y_original_weak_labels , y_feedback )
```

Both the base embeddings and the augmented matrix are re-saved to `nlp_model.pkl`. The classifier is re-fit on the full set. The base set grows by exactly the number of feedback rows each cycle. No forgetting.

The result: as more operators log outcomes, the model gets *both* more accurate (more data) *and* more durable (the original label distribution is preserved).

---

## Slide 15 — Impact Forecast

Before the event happens, we want to quantify what the event will cost the city. The `ImpactForecaster` answers four questions:

- **Affected vehicle count** — sum of vehicle throughput across all identified flows, scaled by route length.
- **Person-delay minutes** — affected vehicles × average delay per vehicle.
- **Queue length in metres** — `spillover_radius × √duration_hours × 0.6`. Queue grows as the square root of duration.
- **Area Congestion Index (ACI)** — `0-1` score combining closed edges, spillback edges, and attendance.

A 0-1 ACI of 0.5 corresponds to moderate gridlock. 0.8 is severe. The recommended response tier (Green / Amber / Red) is derived from a weighted sum of ACI, total delay, and attendance — not just from the cause of the event. A 200-person pot-hole on ORR at rush hour is not the same as a 200-person pot-hole on a residential lane at 3 AM, and the impact forecast reflects that.

---

## Slide 16 — Asynchronous Architecture

Graph operations are CPU- and I/O-bound. A single synchronous simulation in Flask will hang the server for 20 to 30 seconds. The dashboard would freeze for every user.

CityFlow's pattern:

1. **Frontend** sends `POST /api/simulate/<id>`.
2. **Flask** generates a `uuid4`, spawns a `threading.Thread`, returns `{ "task_id": "…", "status": "pending" }` immediately.
3. The thread does the heavy work: load the local subgraph, run the BPR shockwave, evaluate interventions, recommend barricades, allocate manpower, render the Folium map, write the result to the `tasks` table.
4. **Frontend** polls `GET /api/status/<task_id>` every 2 seconds.
5. When the thread finishes, the next poll returns `{ "status": "success", "result_json": {…}, "map_url": "…" }` and the dashboard renders the iframe.

This is the same pattern Celery+Redis gives you, but with a single-process SQLite backend — perfectly adequate for a single-traffic-control-room deployment, and zero new infrastructure.

---

## Slide 17 — Cloudflare Pages Proxy (production deployment)

The React dashboard is hosted as a static bundle on Cloudflare Pages. The Flask backend is on a raw VPS. A mixed-content error blocks `https://cityflow.pages.dev` from calling `http://vps:8000`.

The fix: two serverless edge functions at `src/dashboard/functions/api/[[path]].js` and `src/dashboard/functions/maps/[[path]].js`. When the browser hits `https://cityflow.pages.dev/api/events`, the edge function intercepts, forwards to the VPS over plain HTTP, and returns the response. The browser only ever sees HTTPS. No NGINX, no Let's Encrypt, no CORS.

For local development, the same proxying behaviour is mirrored in `vite.config.js` — Vite proxies `/api` and `/maps` to `localhost:8000`. So `npm run dev` works identically to the production deployment.

---

# PART 2 — UI WALKTHROUGH (every visible feature)

> This part is structured as a click-along tour. For each feature, I'll tell you: **where it is**, **what it does**, **what math backs it up**, and **the one or two sentences to say out loud**.

---

## Tour 0 — What the user sees when they first open the app

When the user lands on `localhost:3000`, three things are visible:

1. A **white blurred sidebar** (the glassmorphism effect) on the left, with the title "Events" and a list of 8,057 historical events.
2. A **central welcome panel** with a blue pill reading "Smart traffic planning for Bengaluru", the headline "Welcome to CityFlow", and a three-tile "Try it now" panel.
3. A **header** at the top with the CityFlow logo (a dark slate rounded square with a route icon), the "8,057 historical events" count, a Help button, and a Sun/Moon icon for the theme toggle.

> *Say:* "This is CityFlow. Light theme by default, dark mode one click away. On the left, every historical Bengaluru traffic event is one click away. In the middle, the welcome screen — click Load demo to see the system work on a real event in five seconds."

---

## Tour 1 — The Theme Toggle (top right)

A button with a Sun icon (when in dark mode) or a Moon icon (when in light mode). Clicking it:

- Toggles the `dark` class on `<html>`.
- The Tailwind `dark:` variants repaint every surface.
- The choice is persisted to `localStorage` under the key `cityflow-theme`.
- An inline script in `index.html` reads the value before React mounts, so there is no flash of incorrect theme.

> *Say:* "One click, light or dark. Your preference survives a refresh."

---

## Tour 2 — The Help Modal (top right, next to the theme toggle)

A "?" button. Clicking it opens a modal with three tabs:

- **Glossary** — ten plain-language definitions: Severity level, Expected resolution time, Diversion route, Barricade, Officers deployed, Affected traffic flows, Time saved, Affected vehicles, Person-delay minutes, Historical hotspots.
- **FAQ** — five questions: Where does the prediction come from? How accurate is it? Can I trust the recommendations? What if the event is a "what-if" I made up? What is the "demo" button for?
- **About** — a two-paragraph explanation of what CityFlow is, with a numbered how-to-use list.

The modal is dismissable by clicking outside, pressing the X, or pressing the "Got it" button at the bottom.

> *Say:* "Every metric has a plain-language explanation. The Help modal is always one click away — even during a live event, an operator can pause and look up what 'area congestion index' means."

---

## Tour 3 — The Sidebar Header

At the top of the sidebar:

- A two-line title: "Events" (bold) and "63 total" (small, right-aligned, slate-500).
- A description: "Pick an event to plan for. Each card is a real Bengaluru traffic event."
- Two buttons side by side: **Load demo** (emerald fill) and **New event** (white outline).

The "63 total" reflects cached events + operator-created scenarios. The list scrolls independently of the main panel.

> *Say:* "The sidebar is a single scrollable list of every event the system has ever seen. Load demo injects three pre-built scenarios. New event opens a form for a custom what-if."

---

## Tour 4 — The Event Cards (in the sidebar)

Each card is a tappable row. From top to bottom:

- A **square icon** in the top-left — orange triangle (unplanned) or violet calendar (planned).
- The event **cause** in 14 px medium-weight slate-900 text.
- A **timestamp** below in 11 px slate-500 — "15 May 2024, 06:00 pm".
- A row of **badges**:
  - **Planned** (violet pill with calendar icon) or **Unplanned** (orange pill with triangle).
  - **Closure** (rose pill with flag icon) if the event requires road closure.
  - **Custom** (slate pill) if the event was created via the scenario form.
- An **attendance line** in 11 px slate-500 with a people icon, shown only if attendance > 0.

A selected card has a subtle blue-50 background. Hover shows slate-50.

> *Say:* "Each card is a real Bengaluru incident. The badges tell you event type, whether it needs a closure, and whether you made it up yourself."

---

## Tour 5 — The Scenario Form (New event button)

Clicking **New event** expands an inline form with eight fields:

1. **What is happening?** — free text (e.g., "Marathon, protest, concert").
2. **Latitude** — numeric.
3. **Longitude** — numeric.
4. **When does it start?** — datetime-local picker.
5. **Event type** — dropdown: Planned (announced) or Unplanned (sudden).
6. **Road impact** — dropdown: Partial closure or Full closure.
7. **Expected crowd** — numeric.
8. **Duration (hours)** — numeric, min 0.5.
9. **Roads affected** — free text, optional.
10. A **checkbox** — "Roads will need to be closed".

A green "Create & plan" button submits the form. A grey "Cancel" closes it. The form is validated client-side; server-side, the API checks that coordinates fall inside the Bengaluru bounding box and that the attendance is non-negative.

On successful submit, the scenario is prepended to the event list, the form collapses, and the new scenario is auto-selected — severity and simulation fire immediately.

> *Say:* "New event is your what-if sandbox. The form has the same fields the city control room would have on a real incident report."

---

## Tour 6 — Load Demo (one click, three scenarios)

The green **Load demo** button injects three pre-made scenarios that showcase the system:

1. **Cricket Match** — M. Chinnaswamy Stadium, 35,000 expected attendance, partial closure, 4-hour duration. This exercises the "large event" attendance modifier and the attendance-derived spillover radius.
2. **Heavy Vehicle Breakdown** — Outer Ring Road, full closure, no attendance, unplanned. This exercises the barricade validation and the police-compliance differential.
3. **Accident / Radio Report** — Mekhri Circle area, Kannada description: "ಟ್ರಾಫಿಕ್ ತುಂಬಾ ನಿಧಾನವಾಗಿದೆ. Heavy traffic moving slow near Mekhri Circle." This exercises the LaBSE multilingual classifier and the keyword highlighting in the UI.

The first demo event is auto-selected, so a reviewer sees the full analysis in one click.

> *Say:* "Three clicks to a complete demo: a planned mega-event, an unplanned breakdown, and a Kannada radio report. The system handles all three identically."

---

## Tour 7 — Onboarding (the home screen)

When no event is selected, the main panel shows:

- A blue **pill** above the headline: "Smart traffic planning for Bengaluru" with a sparkle icon.
- A **headline**: "Welcome to CityFlow" — 36 px bold slate-900.
- A **subtitle**: "CityFlow helps traffic teams answer three questions before any event: how bad will it be? where should the police go? and which routes should drivers take?"
- A **3-step "How it works" panel**: three rounded cards in a row — "Pick an event", "See the analysis", "Get the plan" — each with a numbered circle, an icon, and a one-line description.
- A **"Try it now" panel** with three coloured tiles:
  - **Load demo events** (emerald) — three ready-made events.
  - **Create your own** (violet) — what-if event.
  - **See past hotspots** (amber) — opens the Folium heatmap in a new tab.
- A footer note about hovering over info icons.

> *Say:* "This is the front door. The three-step panel answers the inevitable 'how does this work?' in seven seconds. The three tiles get you from zero to a real simulation in one click."

---

## Tour 8 — The Analysis View (top of the page)

When an event is selected, the right panel switches to a 5-step "Story" view. The page header shows:

- The event cause in slate-900 with the cause in blue-700.
- A small "•" separator.
- A **view toggle** on the right: **Story view** (book icon) or **Plan view** (shield icon). The default is Story view.

The Story view walks the operator through five numbered steps. Each step has a numbered blue circle, an icon, a title, a one-line description, and a content card.

> *Say:* "Story view is the guided experience — five steps, top to bottom. Plan view drops the narrative and shows everything in one screen for experienced operators."

---

## Tour 9 — Step 1: What is happening (Situation Card)

The first card shows:

- A **blue flag icon** in a 40 px rounded square (blue-50 bg, blue-700 ring, 20% opacity).
- The **event cause** in 18 px bold.
- Badges: **Planned** or **Unplanned** pill, plus a **Road closure** rose pill if applicable.
- A metadata line: 📅 datetime · 👥 ~35,000 expected · 📍 roads_affected.
- The **SeverityBadge** in the top-right (large variant): "All clear" (green) / "Heads up" (amber) / "Urgent action" (red), each a pill with a coloured dot.
- A short **headline** in a slate-50 inset: "This event will cause moderate disruption. Expected to take about ~2.0 hrs to clear."
- A **model confidence note** if confidence < 60% — a small amber line explaining the conservative estimate.
- The **Radio / log report** — the original operator description with **NLP-flagged words highlighted in rose**. Hovering over the words shows the icon, but they are visually distinct inline.
- A small line below: "AI read of this report: 87% likely to disrupt traffic" — the `disrupted_prob` from the LaBSE classifier.

> *Say:* "This is the event itself, plus the AI's first read. The severity pill on the right is the colour-coded threat level. The radio report below shows the operator's original words, with the words that triggered the disruption score highlighted in red."

---

## Tour 10 — Step 2: How bad is it? (Impact Assessment)

The second card has a **left-border accent** whose colour matches the severity level — rose for Red, amber for Amber, emerald for Green. Inside:

- A **summary sentence** in slate-900: "Traffic will be affected" / "Traffic is going to break down" / "Traffic should keep moving".
- A **one-line explanation** in slate-500.
- A **2x2 grid of stat tiles**:
  - **How long to clear** (clock icon, with info hover) — "~2.0 hrs" in 24 px bold, "Worst-case ~13h 21m" beneath.
  - **People delayed** (people icon) — "60,000 min" with "~4,000 vehicles" beneath.
  - **Backed-up queue** (layers icon) — "848 m" with metres unit.
  - **Congestion score** (bolt icon) — "23%" — a 0-1 index rounded to percent.
- A **"What history says"** inset: "In the last few years, 702 similar events happened within 2 km of this location, and 68 of them needed road closures." Plus three small cause chips with counts: others ×70, pot holes ×41, tree fall ×20.

Every value has a hover tooltip. The four icons have descriptive help text.

> *Say:* "The headline answer to 'how bad is it?' The four big numbers are what an operator needs at a glance: how long, how many people, how long the queue, how bad the congestion. The history panel underneath shows what the city's own past says about this exact location."

---

## Tour 11 — Step 3: What does the city look like (Map Comparison)

The third card is the **map comparison**. It has a small tab strip with three options:

- **Side-by-side** (default) — two iframes, left and right.
  - **Left**: "Without action — What happens if we do nothing" — the red chaos map.
  - **Right**: "With CityFlow's plan — Diversions + barricades" — the green recommended plan.
- **Plan only** — a single iframe of the recommended plan.
- **Past hotspots** — a single iframe of the historical heatmap.

Each iframe is the actual Folium HTML produced by the simulator, with the epicenter marked, the original (red) shortest path, the AI diversion (cyan), and the validated barricades (orange circles).

A **legend bar** at the bottom shows the four colour codes: red = original route, cyan = AI diversion, orange = barricade, red = event location.

The card has a loading state (large spinner with "Working out the best routes…" and "This usually takes 5-15 seconds") and an error state (a rose-bordered card with a retry button) for when the simulation fails.

> *Say:* "This is the single most important screen. Two maps, side by side. The left is what happens if you do nothing — the original route gets stuck. The right is CityFlow's plan: the new route, the barricades, the traffic flow that doesn't gridlock."

---

## Tour 12 — Step 4: What does CityFlow recommend (Resource Plan)

The fourth card has a **blue left-border accent** (the brand colour). It is the most data-dense card.

**The big-number headline**: "With this plan, the average trip through the area is **874.3 min faster**. That's about **85.7%** less delay per trip across 3 main traffic routes."

**The resource grid** — three side-by-side tiles:
- **Officers** (people icon): "44" in 24 px bold, "11 per barricade" beneath.
- **Barricades** (shield icon): "4" with "4 validated" beneath.
- **Shift** (clock icon): "8h" with "352 officer-hrs" beneath.

Each tile has a small info icon that explains the calculation on hover.

**Routes protected** — a small list of up to three flow IDs (flow-1, flow-2, flow-3). Each row has a green dot if the intervention was valid, with the time-saved in monospace font, or a slate dot with "no better route" if no improvement was found.

**Barricade locations** — a numbered list of each validated barricade, showing the lat/lon in monospace and the validation reason ("Blocks 2 closure entries and offers 3 alternate exits").

**Urgency note** — a final amber-bordered callout: "Severe disruption — full closure protocol, immediate response."

> *Say:* "This is the answer to 'where should the police go?'. The big number is the headline win. The three resource tiles give you officers, barricades, and shift length. The list below shows exactly which routes are protected and which intersections get the barricades — with the lat/lon so a dispatcher can brief an officer."

---

## Tour 13 — Plan Summary (the four small stat cards under the plan)

A 2x2 grid of compact stat cards:

- **Roads blocked** — the raw count of closed edges from the simulator.
- **Spillover zone** — the radius in km (e.g., "1.0 km").
- **Diversions set up** — a fraction: "3/3" — three valid diversions out of three flows analysed.
- **Time of day** — "Rush Hour" / "Off-Peak" / "Night" — the label applied by the time-of-day weighting.

> *Say:* "Four small numbers to summarise the scale of the response."

---

## Tour 14 — Step 5: After it ends (Feedback Panel)

The fifth card is the **post-event learning input**. It has a "quiet" tone (subtle slate-50 background) and a green check icon.

A description: "Once the event is over and you know the actual numbers, fill this in. The system compares your answer to its prediction and adjusts future plans."

**The form** has six fields:

1. **How long did it actually take? (min)** — numeric, with placeholder showing the predicted value.
2. **How serious was it really?** — dropdown: Green / Amber / Red.
3. **Officers actually used** — numeric.
4. **Barricades actually used** — numeric.
5. **Did the diversion plan work?** — two radio cards (Yes / No), styled as selectable pills.
6. **Anything else worth remembering?** — free-text, optional.

A blue **"Save outcome"** button submits to `/api/feedback`. On success, a green toast appears: "Saved. N total outcomes recorded so far." The current outcome count is shown next to the button.

> *Say:* "This is the most important step. After the event is over and the dust has settled, the operator types in what actually happened. The system compares those numbers to its predictions and uses them to retrain the manpower weights and the NLP classifier. Every event makes the next one more accurate."

---

## Tour 15 — Plan View (alternative to Story view)

Clicking the shield icon in the page header toggles to **Plan view**. This drops the narrative cards and shows everything in a single, dense screen:

- The MapComparison at the top.
- The ResourcePlan below.
- The PlanSummary at the bottom.

Same data, no walkthrough text. Designed for an experienced operator who already knows what each card means.

> *Say:* "Plan view is for when you know the system. Story view is for when you don't."

---

## Tour 16 — The Header (recap)

Top of the page, always visible:

- **CityFlow logo** (left) — clicking goes back to the home screen.
- **Breadcrumb** — when in analysis view, a "All events" link with a back chevron.
- **Historical events count badge** — "8,057 historical events" with a layers icon. Pulses faintly.
- **Outcomes learned badge** — "N outcomes learned" with a check icon. Appears only after the first feedback entry.
- **Help button** — opens the modal.
- **Theme toggle** — Sun/Moon icon.

The header uses `backdrop-blur-md` so the map shows through subtly when you scroll.

> *Say:* "The header is your navigation and your always-on status bar: how many historical events are in the model, how many outcomes the system has learned from, and the help and theme controls."

---

## Tour 17 — The Folium Maps (inside the iframes)

Each map is a full Folium HTML render. The default tile is `CartoDB dark_matter` (dark grey basemap with high-contrast roads). Layers:

- **Red marker** with a warning icon at the event epicenter.
- **Red polyline** for the original shortest-path route.
- **Cyan / lime / magenta polylines** for the AI diversion routes (one colour per flow).
- **Orange circle markers** for the validated barricade locations.
- A red **left-side banner** on the baseline map: "Without action — What happens if we do nothing".
- An emerald **right-side banner** on the CityFlow plan: "With CityFlow's plan — Diversions + barricades".

The map has its own zoom, pan, and tile controls (Folium defaults).

> *Say:* "The maps are interactive — pan, zoom, click the markers. The left side is the do-nothing scenario, the right side is what CityFlow would do."

---

## Tour 18 — The Past Hotspots Map (the third tab)

A separate Folium map of all 8,057 historical events rendered as a heatmap, with the top-20 hotspot junctions overlaid as circle markers. The marker radius scales with event count; the colour matches the risk level (red = ≥40 events, amber = ≥20, green = <20).

A small legend in the bottom-left explains the colour code.

> *Say:* "This is the institutional memory of the city. Where have events happened before? The big red dots are the junctions to keep extra resources near."

---

## Tour 19 — The Error State (in the Map Comparison)

If the simulation fails — no events within the ego-graph, OSMnx timeout, anything — the map card shows a **rose-bordered empty state** with a triangle icon: "Could not calculate the plan. [error message]." A grey **"Try again"** button restarts the simulation.

> *Say:* "Errors are surfaced cleanly. One click and you try again — no page reload."

---

## Tour 20 — The Loading State (in the Map Comparison)

While the simulation is in flight, a **large spinner** appears with the text: "Working out the best routes…" and a sub-line: "This usually takes 5-15 seconds." The poll continues in the background every 2 seconds.

> *Say:* "The system is fast — most simulations complete in under fifteen seconds. The dashboard polls silently, so you can be reading the severity assessment while the map is rendering."

---

## Tour 21 — The Severity Badge (top right of SituationCard)

Three pill variants:

- **Green** (emerald-50 bg, emerald-700 text, emerald-600 dot): "All clear" — Green severity.
- **Amber** (amber-50 bg, amber-700 text, amber-600 dot): "Heads up" — Amber severity.
- **Red** (rose-50 bg, rose-700 text, rose-600 dot): "Urgent action" — Red severity.

Each has a `ring-1` for crispness. The badge appears in two sizes: small (12 px) in the SectionTitle row, and large (14 px) in the SituationCard hero.

> *Say:* "The same severity, three places. Small in titles, large on the situation hero. Always the same colours — you'll learn the meaning in one screen."

---

## Tour 22 — The EventTypeBadge (Planned / Unplanned)

A small pill in the SituationCard hero:

- **Planned** (violet-50 bg, violet-700 text, calendar icon): pre-announced.
- **Unplanned** (orange-50 bg, orange-700 text, triangle icon): sudden.

The same badge appears in the sidebar event cards.

> *Say:* "The first thing you know about an event is whether it was announced. CityFlow uses this to decide how to weight attendance versus historical severity."

---

## Tour 23 — The Help Modal — Glossary tab

Ten terms with icons:

- **Alert / Clock / Route / Shield / People / Layers / Bolt / Volume / Globe / Pin** icons, one per term.

Each card has: title in slate-900, a one-line "short" summary in bold, and a 2-3 sentence body explanation. Arranged in a 2-column grid.

> *Say:* "Plain-language definitions, no jargon. Every term the system uses is here."

---

## Tour 24 — The Help Modal — FAQ tab

Five Q&A pairs in a vertical list. Each question is bold with a help icon; the answer is in 12 px slate-600.

> *Say:* "The questions a real traffic manager would ask — answered in advance."

---

## Tour 25 — The Help Modal — About tab

A two-section page: "What is CityFlow?" and "How to use this dashboard". Both are rendered in the `prose` style for nice typography. The About page is also where the team can put their one-paragraph elevator pitch.

> *Say:* "The elevator pitch and the how-to-use, in case a reviewer is on a tight schedule."

---

## Tour 26 — Dark mode (the full alternate theme)

Click the Moon icon. Every surface repaints:

- The body goes from slate-100 to slate-950 (near-black).
- The cards stay white in the dark variant, but with darker borders (slate-700/800).
- The severity accents use a darker tinted background instead of the light pastel (e.g., emerald-950/20 instead of emerald-50).
- The map iframes inherit the dark backdrop automatically.
- The text inverts: slate-900 becomes slate-50, slate-500 becomes slate-400.

The change is instant. The choice is persistent. Reload the page and you're still in dark mode.

> *Say:* "Traffic control rooms run dark to reduce eye strain on long shifts. One click, and every surface, every border, every accent adjusts. The map shows up better against the darker UI, the severity colours pop, and the data-dense cards stay readable."

---

## Tour 27 — The end-to-end demo flow (90 seconds)

> *This is the canonical demo script for the video. Every step is one click.*

1. **Land on the home screen.** "Welcome to CityFlow." Three tiles: Load demo, Create your own, See past hotspots. (5 sec)
2. **Click Load demo.** Three scenarios appear in the sidebar. The first auto-selects. (3 sec)
3. **Step 1 — Situation.** Severity badge appears in the top-right. Headline: "This event will cause moderate disruption." NLP highlights visible in the radio report. (8 sec)
4. **Step 2 — Impact.** Big numbers: 60,000 person-delay minutes, 848 m queue, 23% congestion score. History panel shows 702 similar events. (10 sec)
5. **Step 3 — Maps.** Two iframes load. Left: red chaos. Right: green plan. Cyan diversion line, orange barricade dots. (15 sec)
6. **Step 4 — Plan.** "874.3 min faster." 44 officers, 4 barricades, 8h shift, 3 routes protected. (15 sec)
7. **Step 5 — Feedback.** Type 180 in the resolution field, pick Amber, type 42 in the officers field. Save. Green toast. (15 sec)
8. **Click "Plan view"** in the header. Everything collapses to a single dense screen. (5 sec)
9. **Click the Sun icon** to switch to dark mode. (3 sec)
10. **Click Help.** Glossary. Click FAQ. Click About. Click outside to close. (10 sec)
11. **Click "All events"** in the breadcrumb. Back to the home screen. (3 sec)

Total: 92 seconds. Add 30 seconds for transitions and a closing shot.

> *Say:* "That's the full system in ninety seconds. From blank page to a complete operational plan, with learning, with dark mode, with a help system. This is what every traffic control room could have."

---

## Tour 28 — What the API gives you (for the developer audience)

- `GET /api/events` — list of top events + operator scenarios.
- `GET /api/severity/<id>` — severity, clearance forecast, NLP score, nearby history, impact forecast.
- `POST /api/simulate/<id>` — async task, returns task_id.
- `GET /api/status/<task_id>` — poll for simulation result.
- `POST /api/feedback` — record outcome, triggers retrain every 10 entries.
- `GET /api/feedback/summary` — total outcomes, mean resolution error, diversion success rate.
- `GET /api/hotspots` — top 20 junctions, temporal patterns, heatmap URL.
- `GET /api/realtime/incidents?as_of=ISO` — historical-replay live feed.
- `POST /api/scenarios` — create a what-if.
- `POST /api/scenarios/demo` — load the three demo events.

> *Say:* "Every screen you just saw is backed by a single JSON API. Swap the React frontend for a CLI, a Jupyter notebook, a Slack bot, or a voice interface — the math doesn't care."

---

## Tour 29 — The limits (be honest)

- The NLP model requires ~2 GB RAM to train. On a 4 GB server, the patch in `deploy/patch_nlp.py` disables it; the system still works but `nlp_disruption_prob` falls back to 0.5.
- There is no live traffic feed in the prototype. The `RealtimeFeed` interface is in place; the default implementation replays the historical dataset. Swapping in HERE / TomTom / a CCTV pipeline is a single class change.
- The OSMnx graph is cached, so first start takes a few minutes to download. After that it's a 170 MB file on disk.
- The Cox PH model has a C-index in the 0.55–0.70 band. Better than chance, but no replacement for a human dispatcher's local knowledge.
- CityFlow is a **graph-based intervention planner**. It is not a vehicle-level microscopic simulator (SUMO / AIMSUN). It cannot tell you the exact trajectory of a specific car.

> *Say:* "The system is honest about its limits. The math is rigorous, but the recommendations are a starting point, not a verdict. Every event teaches it something new."

---

## Tour 30 — Closing

CityFlow takes 8,205 historical Bengaluru traffic events, the city's own road network, and the operator's own radio reports, and turns them into a data-driven playbook for the next rally, the next breakdown, the next festival.

The four pillars — **forecast, route, deploy, learn** — are real, they are measured, and they are auditable. The math is in the code, not in a slide. The system is open source. It runs on a laptop. It deploys to a control room.

> *Say:* "CityFlow — mathematical routing intelligence, not just coloured lines on a map. Thank you."

---

# END OF SCRIPT
