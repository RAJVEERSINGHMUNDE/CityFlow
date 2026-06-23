# CityFlow — Cue Cards

> **One card per slide. Read the prose aloud.** Bullets and formulas live in the PPT itself — the cue cards carry the narration. UI slides are written as if you're physically walking the audience through the dashboard in real time.

---

## SLIDE 1 · Title

Welcome to CityFlow — Event-Driven Congestion Intelligence for Bengaluru. This is a graph-AI digital twin for the traffic control room, built for Problem Statement Two of the hackathon. The whole thing rests on four pillars you'll see again and again: forecast, route, deploy, learn. We trained and tested on the city's own incident log — 8,205 events, the real Bengaluru road graph, Kannada and English radio reports. The UI is dark and minimal, designed to feel like a command center rather than yet another Bootstrap dashboard.

→ Next: Part 1 divider.

---

## SLIDE 2 · Part 1 Divider

Part 1 is the math, the ML, and the systems. Before I show you anything on screen, here's what's actually under the hood, because every UI decision in Part 2 is driven by one of these foundations.

→ Next: The Problem.

---

## SLIDE 3 · The Problem

Every day in Bengaluru, the city loses hours of productivity because we can't answer three questions: how bad will this event be, where should the police go, and which routes should drivers take. Today, all three are answered by experience and gut feel. Nobody learns from the last event — the same mistakes get repeated, the same corners get blocked, the same officers get misallocated. CityFlow is a decision-support system that turns eight thousand past Bengaluru traffic incidents into a learnable, mathematically grounded playbook for every event that disrupts the city.

→ Next: The Data.

---

## SLIDE 4 · The Data

We trained and tested on the city's own incident log, dataset slash 2 dot csv — eight thousand two hundred and five rows spanning a hundred and fifty-one days from November 2023 to April 2024. Seven thousand seven hundred and six are unplanned, that's ninety-four percent; four hundred and sixty-seven are planned. Eight hundred and seventy of the operator descriptions are in Kannada. Two thousand nine hundred and eighty-three rows have both a start and a close timestamp — these are the ones we use for survival analysis — and a thousand and seven are still active at the export boundary, so we treat them as right-censored. One hundred and thirty-seven events have a route path line-string, which we snap to real OSM edges for planned events. The headline number is this: a BMTC bus takes a mean of seventy-seven and a half minutes to clear; a private car takes thirty-eight and a half. That two-times gap is visible in the raw data before any model touches it.

> Source: `dataset/2.csv`, 47 columns.

→ Next: Architecture.

---

## SLIDE 5 · Architecture

Every component is replaceable. The web is not a black box. Reading top to bottom: the CSV goes into a data pipeline that cleans, filters, and separates planned from unplanned. Then four ML models run in parallel — the severity predictor, the Cox PH survival forecaster, the hotspot analyzer, and the LaBSE multilingual NLP classifier. The graph engine loads a cached Bengaluru OSMnx graph — one hundred and fifty-five thousand nodes, three hundred and ninety-three thousand edges. The congestion simulator runs the BPR shockwave, Dijkstra on the adjusted graph, picks barricades, builds the diversion plan. The manpower allocator runs a linear formula and refits it from operator feedback. The Flask API has an async task queue backed by SQLite. And the React + Vite dashboard is the five-step story view you're about to see.

> Source: `src/simulator/`, `src/api/`, `src/dashboard/`.

→ Next: BPR.

---

## SLIDE 6 · BPR Travel Time

Every road has a free-flow time. As it fills up, travel time grows non-linearly. We use the Bureau of Public Roads formula — t equals t-naught times one plus alpha times V over C to the beta. Alpha is zero point one five, beta is four. The beta equals four exponent is what gives the curve its characteristic hockey stick — travel time stays close to free-flow until V over C approaches zero point eight, then it explodes. A subtle point: a naïve implementation multiplies every edge by the same scalar, which is mathematically useless, because if every edge is scaled by the same number, the shortest path between two nodes is unchanged. We need per-class differentiation, which we'll see in the time-of-day slide.

```
t  =  t₀  ·  ( 1  +  α  ·  ( V / C ) ^ β )     α = 0.15, β = 4
```

> Source: `src/simulator/simulator.py:simulate_congestion_shockwave`.

→ Next: Shockwave.

---

## SLIDE 7 · Reverse-BFS Shockwave

Naïve simulators draw a circle around the event and block everything inside it. That's physically wrong — congestion propagates upstream along connected roads, not radially. CityFlow runs a reverse breadth-first search from the epicenter. For each upstream edge at graph distance d from the event, the capacity decays linearly. If d is within the closure radius of fifty meters, capacity drops to five percent. If d is within the spillover radius of a thousand meters, capacity recovers linearly — at six hundred meters, you keep sixty-four percent. Beyond a thousand meters, no change. Because we traverse the actual road graph, a parallel highway three hundred meters away but separated by a river is correctly left alone. A dead-end alley two hundred meters away is correctly identified as one edge deep, not as twelve and a half acres of gridlock. This single change is what made our Phase-1 evaluation go from "the wrong roads get blocked" to "the right roads, every time."

```
if d ≤ 50m:                capacity ← capacity × 0.05
elif d ≤ 1000m:            capacity ← capacity × (0.1 + 0.9 · d / 1000)
else:                     capacity unchanged
```

> Source: `src/simulator/simulator.py:simulate_congestion_shockwave`.

→ Next: Flow selection.

---

## SLIDE 8 · Volume-Aware Flow Selection

Where will traffic actually try to go? We pick up to three arterial origin-destination movements that pass through the event. For every boundary node on the upstream side and every boundary node on the downstream side, we run Dijkstra from origin to epicenter, then from epicenter to destination, and concatenate. Each candidate is scored by distance times the average road capacity along the route. That's a volume proxy: longer, more arterial routes carry more vehicles. We pick the top three, with the constraint that no two share the same origin or destination, so we never end up with two flows that are really the same corridor.

```
score = distance_km × average_road_capacity_along_route
```

> Source: `src/simulator/simulator.py:find_affected_flows`.

→ Next: Police Compliance.

---

## SLIDE 9 · Police Compliance

A barricade without police is not a barricade — it's a suggestion. Bengaluru compliance with un-manned barricades is around forty percent. We model this with a single binary flag. When police are not deployed, closed edges stay in the graph but their travel time is multiplied by one over zero point four, which is two and a half times. That captures the non-compliance cost without removing the edge's existence. When police are deployed, closed edges are removed from the graph entirely and Dijkstra routes around them — that's the ninety-five percent compliance case. Every recommended diversion is evaluated under both scenarios, and the API returns time-saved with-police, time-saved without-police, and the police compliance benefit in minutes, so the operator can see exactly how much of the win comes from police presence versus geometry alone.

> Source: `src/simulator/simulator.py:calculate_diversion`.

→ Next: Time-of-Day.

---

## SLIDE 10 · Per-Class Time-of-Day Weighting

We want the recommended route to actually differ between six PM and three AM. A uniform scalar can't do that. So we calibrate a per-hour, per-road-class multiplier. The hourly multiplier is the historical event density at that hour, normalized so its twenty-four-hour mean is one. The class sensitivity is highway-specific: motorways get one point six, primary roads one point four, residential roads zero point seven. At rush hour, with hourly multiplier around one point six, a primary road gets a multiplier of one point eight four, a residential road one point four two. The relative cost of arterials rises, so Dijkstra routes more flow through residential streets — exactly the behavior a real driver takes. At three AM, the relationship inverts. The max zero point one floor is there to prevent negative weights when a high-sensitivity road meets a low-traffic hour. This is what made the Phase-4 evaluation go from zero out of ten routes changing between peak and night to "the route actually differs."

```
multiplier = max(0.1,  1 + (hourly_mult − 1) × sensitivity[highway])
```

> Source: `src/simulator/simulator.py:_apply_time_of_day_weights`.

→ Next: Barricades.

---

## SLIDE 11 · Continuous-Flow Barricades

The naïve algorithm is: for every closed edge, place a barricade at the immediate upstream node. The flaw is obvious once you think about it: if that node is a dead-end intersection where the only outgoing path was the closed edge, cars hit the barricade and can't turn around, and you gridlock the street. CityFlow's algorithm walks upstream from each closed edge until it finds a node whose safe out-degree is at least one — meaning at least one outgoing edge is open and doesn't go back to the epicenter. If we run out of upstream nodes, the barricade is dropped — the road is too small to justify one. Every recommended barricade is then validated: it must block at least one closure entry and offer at least one alternate exit. The validation result is exposed in the API so the dashboard can show "four barricades, four validated."

> Source: `src/simulator/simulator.py:recommend_barricades · validate_barricades`.

→ Next: Severity.

---

## SLIDE 12 · Severity Prediction (two heads)

We predict two things at once. The first head is a Gradient Boosting regressor on log space — we log-transform resolution time because it's heavily right-skewed. The features are cause, event type, closure requirement, priority, hour of day encoded cyclically as sin and cos, day of week, zone, a KMeans spatial cluster, and a junction hotspot score. Five-fold cross-validation, R-squared reported. The second head is a Random Forest classifier with three response levels: Green for under an hour, Amber for under eight hours, Red otherwise. For planned events, where the training set is small, we add transparent rule-based modifiers on top: thirty-five thousand attendance gets plus one to the score and a one point three five multiplier on minutes. Five thousand gets plus zero point five and one point one five. Full closure gets plus zero point five and one point two.

> Source: `src/simulator/severity_model.py`.

→ Next: Cox.

---

## SLIDE 13 · Cox Proportional Hazards

The naïve thing is to drop the censored rows — the incidents that were still active at the data export, where we never saw them close. That throws away a thousand and seven rows and biases the mean downward. CityFlow uses Cox Proportional Hazards with right-censoring, via the lifelines library. For each row, T is the close time minus the start time in minutes, and E is one if we actually saw the close, zero if censored at the observation boundary. The covariates are vehicle type, corridor class, closure requirement, and hour of day. The model is fit with a small L2 penalty of zero point one for stability. We report the concordance index — the probability that given two random incidents, the model correctly orders them by clearance time. Our training run hits a C-index in the zero point five five to zero point seven range, which is reasonable for real-world traffic data with this much residual variance. The eightieth-percentile clearance time, t-eighty, is then used directly to set the shift duration recommendation, which is why our "how long to deploy" answer is statistically grounded rather than a hand-tuned clamp.

> Source: `src/simulator/survival_model.py`.

→ Next: LaBSE.

---

## SLIDE 14 · LaBSE Multilingual NLP

Of the six thousand eight hundred and thirteen free-text operator descriptions, eight hundred and seventy are in Kannada. A model that only reads English misses a sixth of the dataset. We use LaBSE — Language-agnostic BERT Sentence Embedding. It's a ninety-megabyte sentence-transformer that produces a seven-hundred-sixty-eight-dimensional multilingual embedding. Kannada "nidhana" meaning slow and English "heavy traffic" land close together in that space. We attach a logistic regression head trained on weak labels extracted from the descriptions themselves: any text containing "slow", "closed", "blocked", "gridlock", "heavy", or the Kannada equivalents is labeled disrupted. Any text containing "no problem", "normal", "moving", "clear", "cleared" is labeled contained. The model outputs a probability and the specific tokens that triggered the score. In the UI, those tokens are highlighted in red on the operator's report, so they can see exactly why the AI thinks this is severe. The output is also folded back into the simulator as a capacity factor: a high-disruption reading on a corridor that historically closes often drops edge capacity further than the same reading on a quiet lane.

> Source: `src/simulator/nlp_impact.py`.

→ Next: Manpower.

---

## SLIDE 15 · Manpower Linear Allocator

The number of officers to deploy at a barricade is a learned linear function. Officers per barricade equals intercept plus w-severity times severity score plus w-attendance times expected attendance over a thousand plus w-rush-hour times is-rush-hour plus w-closure times requires-closure. The default weights are hand-tuned at zero point five, zero point three five, zero point one five, one point two, and two point zero. But here's the critical bit: the weights are not fixed. After every ten feedback entries, CityFlow runs numpy linear least squares on the operator-supplied outcomes and refits all five weights. The new weights are persisted to manpower weights dot json and used for every subsequent event. This is what closes the post-event learning loop. The first event is calibrated on history. The twentieth event is calibrated on your specific corridor, your specific operator, your specific truth.

```
officers = intercept
        + w_severity  × severity_score
        + w_attendance × (expected_attendance / 1000)
        + w_rush_hour  × is_rush_hour
        + w_closure    × requires_closure
```

> Source: `src/simulator/manpower.py`.

→ Next: Learning.

---

## SLIDE 16 · Post-Event Learning (no forgetting)

The NLP classifier has the same learning requirement, but with a twist. If we just refit the logistic head on the latest ten feedback rows, the model forgets the original thousand-plus weak-labeled descriptions. After fifty feedback entries, it has seen the fifty most recent operator labels and nothing else — a textbook case of catastrophic forgetting. CityFlow solves this by concatenating: the X training matrix is the vertical stack of the original weak-label embeddings and the feedback embeddings, the Y training vector is the concatenation of the original labels and the feedback labels. The classifier is re-fit on the full set, the augmented matrix is re-saved to NLP model dot pkl. The base set grows by exactly the number of feedback rows each cycle. No forgetting — the model gets both more accurate and more durable.

> Source: `src/simulator/nlp_impact.py:retrain_from_feedback`.

→ Next: Impact Forecast.

---

## SLIDE 17 · Impact Forecast

Before the event happens, we want to quantify what it will cost the city. The impact forecaster answers four questions. Affected vehicle count is the sum of vehicle throughput across all identified flows, scaled by route length. Person-delay minutes is affected vehicles times average delay per vehicle. Queue length in metres is spillover radius times square root of duration hours times zero point six — queue grows as the square root of duration. Area Congestion Index is a zero-to-one score combining closed edges, spillback edges, and attendance. The recommended response tier, Green Amber or Red, is derived from a weighted sum of those three, not just from the cause of the event. A two-hundred-person pot-hole on ORR at rush hour is not the same as a two-hundred-person pot-hole on a residential lane at three AM, and the impact forecast reflects that.

> Source: `src/simulator/impact_forecast.py`.

→ Next: Async Architecture.

---

## SLIDE 18 · Asynchronous Architecture

Graph operations are CPU and I-O bound. A single synchronous simulation in Flask will hang the server for twenty to thirty seconds. The dashboard would freeze for every user. CityFlow's pattern is: the frontend sends a POST to slash API slash simulate slash event id. Flask generates a uuid4, spawns a background thread, returns a "pending" status with a task id immediately. The thread does the heavy work — load the local subgraph, run the BPR shockwave, evaluate interventions, recommend barricades, allocate manpower, render the Folium map, write the result to the tasks table. The frontend polls GET slash API slash status slash task id every two seconds. When the thread finishes, the next poll returns success with the result JSON and the map URL, and the dashboard renders the iframe. This is the same pattern Celery and Redis give you, but with a single-process SQLite backend — perfectly adequate for a single traffic-control-room deployment, and zero new infrastructure.

> Source: `src/api/app.py`.

→ Next: Part 2 divider.

---

## SLIDE 19 · Part 2 Divider

Part 2 is the UI walkthrough. I'm going to physically take you through the website — every screen, every feature, in order. The first thing you'll see when the page loads is the home screen with the sidebar, and we're going to click through it together.

→ Next: UI overview.

---

## SLIDE 20 · UI Tour Overview

Here's the lay of the land. On the left there's a sidebar with the event list — every Bengaluru traffic event in the database, scrollable, with badges for type, closure, and whether you made it up. The main panel is either the welcome screen or, when you select an event, the analysis view. The analysis view has a five-step story mode that walks you through situation, impact, maps, plan, and feedback, and a plan view that collapses everything into one screen. Up in the header there's a help button with a plain-language glossary, a Sun-Moon theme toggle that persists to local storage, and once we ship it, a presentation link. The map iframes are real Folium renders — original route in red, AI diversion in cyan, barricades as orange dots. Below the analysis view sits a feedback panel where the operator logs what actually happened. That's the system, from top to bottom.

→ Next: Step 1.

---

## SLIDE 21 · Story Step 1 — Situation Card

I'm going to click Load demo at the top of the sidebar — you can see it in emerald green. When I do, three pre-built scenarios inject into the list and the first one, the cricket match at M. Chinnaswamy Stadium, auto-selects. Watch the right panel: it transitions to the analysis view, and the first thing you'll see is the Situation card. In the top-left, a blue flag icon. Next to it, the event cause in bold — "Cricket Match" — with two pills underneath, "Planned" in violet and "Road closure" in rose. The metadata line shows the date, the expected attendance of around thirty-five thousand, and the roads affected. In the top-right, the severity badge — a pill with a coloured dot, currently amber meaning "Heads up". Below the headline, a model confidence note because the model's only at forty-eight percent — that's the conservative estimate kicking in. Then the radio log report — this is the original operator description in plain text, with the words that triggered the AI's disruption score highlighted in rose. Watch the highlighted words: "ನಿಧಾನ" and "ತುಂಬಾ" — those are the Kannada cues the LaBSE model picked up. Below the report, the AI read: eighty-seven percent likely to disrupt traffic.

> Source: `src/dashboard/src/components/SituationCard.jsx`.

→ Next: Step 2.

---

## SLIDE 22 · Story Step 2 — Impact Assessment

Scrolling down to step two — How bad is it? Notice the card has a left-border accent in amber, matching the severity. The summary sentence says "Traffic will be affected" and "Drivers will notice delays, action is recommended." Then four big stat tiles in a two-by-two grid. How long to clear — two hours, with a worst-case of thirteen hours and twenty-one minutes underneath. People delayed — sixty thousand minutes, with an estimate of around four thousand vehicles. Backed-up queue — eight hundred and forty-eight metres. Congestion score — twenty-three percent. Every one of those values has a hover tooltip — if I hover over the clock icon, I get the plain-language explanation. Below the tiles, the "What history says" panel — in the last few years, seven hundred and two similar events happened within two kilometres of this location, and sixty-eight of them needed road closures. Three cause chips below that, with the most common causes: others, pot holes, tree fall, each with a count. This is the answer to the first question, "how bad will it be?" — at a glance.

> Source: `src/dashboard/src/components/ImpactAssessment.jsx`.

→ Next: Step 3.

---

## SLIDE 23 · Story Step 3 — Map Comparison

Now we're at step three — the most important screen in the application. Two maps side by side, with a small pill strip above for tabs: Side-by-side, Plan only, and Past hotspots. The default is Side-by-side. The left iframe is the baseline — "Without action" with a red banner — and it shows what happens if we do nothing: the original shortest-path route in red, getting stuck at the epicenter. The right iframe is "With CityFlow's plan" with an emerald banner — and you can see three cyan and lime lines for the three AI diversion routes, each one curving around the closure, plus orange dots for the four validated barricade locations. If I click the Past hotspots tab, the right panel swaps to a dark heatmap of all eight thousand historical events with the top twenty hotspot junctions overlaid as coloured circles. The legend at the bottom tells you what each colour means: red line is the original route, cyan is the AI diversion, orange dots are barricades, red is the event location.

> Source: `src/dashboard/src/components/MapView.jsx`.

→ Next: Step 4.

---

## SLIDE 24 · Story Step 4 — Resource Plan

Scrolling to step four — "What does CityFlow recommend?" The card has a blue left-border accent, the brand color. The headline says "With this plan, the average trip through the area is 874.3 minutes faster — that's 85.7% less delay per trip across three main traffic routes." Three resource tiles underneath: Officers — forty-four total, eleven per barricade. Barricades — four, all four validated. Shift — eight hours, three hundred and fifty-two officer-hours. Each tile has an info icon for the calculation. Below the tiles, the Routes protected list — flow-1, flow-2, flow-3, each with its time saved in monospace. Then the Barricade locations list — four entries, each with the latitude and longitude in monospace and the validation reason, like "Blocks 2 closure entries and offers 3 alternate exits." At the bottom, an amber urgency note: "Severe disruption — full closure protocol, immediate response." Below this card, a four-up PlanSummary — roads blocked, spillover zone in kilometres, diversions set up as a fraction, and the time of day label.

> Source: `src/dashboard/src/components/Plan.jsx`.

→ Next: Step 5.

---

## SLIDE 25 · Story Step 5 — Feedback Panel

Step five is the most important step. The card has a quiet, subtle tone. It says: "Once the event is over and you know the actual numbers, fill this in. The system compares your answer to its prediction and adjusts future plans." I'm going to fill in the form. Actual resolution — let me say a hundred and eighty minutes. Observed severity — I'll change it from Amber to Red, because the cricket match actually caused a lot more disruption than predicted. Officers actually used — I had to bring in forty-two. Barricades actually used — five. Did the diversion plan work — yes. Notes — "Local police arrived early, helped a lot." Now I hit Save outcome. A green toast appears: "Saved. 1 total outcome recorded so far." This is the post-event learning loop, in one form. The feedback is stored in SQLite, and after every ten such entries, a background thread re-fits the NLP classifier and the manpower weights.

> Source: `src/dashboard/src/components/FeedbackPanel.jsx`.

→ Next: Recurring primitives.

---

## SLIDE 26 · Recurring UI Primitives

Before we leave the UI, a quick tour of the recurring shapes you'll see throughout the app. The SeverityBadge is a pill with a coloured ring and a dot — three colors, Green, Amber, Red, each with a friendly plain-language label, "All clear", "Heads up", "Urgent action". It comes in two sizes, small for section titles and large for the situation hero. The EventTypeBadge is similar, Planned in violet with a calendar icon, Unplanned in orange with a triangle. The Hint tooltips — those small circle-info icons — give you a plain-language explanation on hover; no jargon left unexplained. Cards use a four-pixel left-border accent in the severity colour rather than a tinted background, which keeps the data-dense look calm. The sidebar uses a glassmorphism effect — a white background with seventy-five percent opacity and a backdrop blur, so the map shows through subtly. And the dark mode toggle in the header — a Sun-Moon icon that flips the theme instantly, persists to local storage, and has no flash on reload because an inline script in the HTML sets the theme class before React even mounts.

→ Next: 90-second demo flow.

---

## SLIDE 27 · 90-Second Demo Flow

The canonical ninety-second walkthrough, click by click. Zero seconds: land on the home screen — Welcome to CityFlow, three tiles. Eight seconds: I click Load demo, three scenarios inject and the first one auto-selects. Fifteen seconds: step one — Situation card with the severity pill, the headline, the NLP highlight. Twenty-five seconds: step two — Impact, sixty thousand person-delay minutes, eight hundred and forty-eight metre queue, twenty-three percent ACI, seven hundred and two nearby historical events. Forty seconds: step three — Maps, two iframes load, red chaos on the left, green plan on the right. Fifty-five seconds: step four — Plan, 874.3 minutes faster, forty-four officers, four barricades, eight-hour shift. One minute ten: step five — Feedback, I type in the actual outcome and save. One minute twenty-five: I click the Plan view toggle in the header — everything collapses to one dense screen. One minute thirty: I click the Sun icon, one click and we're in dark mode. One minute thirty-five: I open Help — Glossary, FAQ, About, close. One minute fifty: I click "All events" in the breadcrumb, back to the home screen. That's the full system in ninety seconds.

→ Next: API surface.

---

## SLIDE 28 · API Surface

Every screen you just saw is backed by a single JSON API. Swap the React frontend for a CLI, a Jupyter notebook, a Slack bot, or a voice interface — the math doesn't care. The endpoints are: GET slash API slash events for the top events and operator scenarios. GET slash API slash severity slash id for severity, clearance forecast, NLP score, nearby history, and impact forecast in one call. POST slash API slash simulate slash id to start an async task, returns a task id. GET slash API slash status slash task id to poll for the result. POST slash API slash feedback to record an outcome, which triggers retraining every ten entries. GET slash API slash feedback slash summary for total outcomes, mean resolution error, and diversion success rate. GET slash API slash hotspots for the top twenty junctions, temporal patterns, and the heatmap URL. GET slash API slash realtime slash incidents with an as-of parameter for the historical-replay live feed. POST slash API slash scenarios to create a what-if. POST slash API slash scenarios slash demo to load the three demo events. That's the entire surface area — ten endpoints, all JSON.

> Source: `src/api/app.py` + `src/api/storage.py`.

→ Next: Part 3 divider.

---

## SLIDE 29 · Part 3 Divider

Part 3 is the close — limits, the four pillars, and the bottom line.

→ Next: Limits.

---

## SLIDE 30 · Limits

The system is honest about its limits. The NLP model requires about two gigabytes of RAM to train. On a four-gigabyte server, the patch in deploy slash patch underscore NLP dot py disables it; the system still works, but the NLP disruption probability falls back to a neutral zero point five. There is no live traffic feed in the prototype — the Realtime Feed interface is in place, but the default implementation replays the historical dataset. Swapping in HERE, TomTom, or a control-room CCTV pipeline is a single class change. First start is slow because OSMnx downloads the Bengaluru graph from OpenStreetMap; after that it's a hundred-and-seventy-megabyte file on disk. The Cox PH model has a C-index in the zero point five five to zero point seven range — better than chance, but not a replacement for a human dispatcher's local knowledge. And CityFlow is a graph-based intervention planner, not a vehicle-level microscopic simulator. It will not tell you the exact trajectory of a specific car. That's SUMO and AIMSUN territory.

→ Next: Four pillars.

---

## SLIDE 31 · The Four Pillars

The four pillars of the system, mapped to the code. Forecast: BPR reverse-BFS shockwave, Cox PH survival, LaBSE NLP, impact forecast — all in the simulator package. Route: volume-aware flow selection, police compliance model, Dijkstra on the capacity-adjusted graph — in simulator dot py's find underscore affected underscore flows and calculate underscore diversion. Deploy: continuous-flow barricades, manpower linear formula, validated locations — simulator dot py's recommend underscore barricades and validate underscore barricades, plus manpower dot py. Learn: feedback to SQLite, every ten entries a background thread refits, no catastrophic forgetting — app dot py's slash API slash feedback endpoint with the retrain hook, plus the NLP and manpower modules. Every pillar is real, every pillar is measured, every pillar is auditable.

> Source: `src/simulator/`, `src/api/app.py`, `src/dashboard/`.

→ Next: Closing.

---

## SLIDE 32 · Closing

CityFlow takes eight thousand two hundred and five historical Bengaluru traffic events, the city's own road network, and the operator's own radio reports — and turns them into a data-driven playbook for the next rally, the next breakdown, the next festival. The four pillars are real, they are measured, and they are auditable. The math is in the code, not in a slide. The system is open source, it runs on a laptop, and it deploys to a control room. Mathematical routing intelligence — not just coloured lines on a map. Thank you.

---

## ⏱ Pacing

- Part 1 (slides 1-18): ~3-4 min
- Part 2 (slides 19-28): ~2-3 min
- Part 3 (slides 29-32): ~30 sec
- **Total: ~6-8 min** if you read every card

For a 3-min cut, hit only slides 1, 3, 4, 5, 6, 11, 13, 17, 18, 23, 24, 25, 32.
