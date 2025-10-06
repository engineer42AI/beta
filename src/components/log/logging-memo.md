# 🧭 Engineer42 Logging System — Architecture & Notes

_Last updated: Oct 2025_

---

## 🎯 Purpose

The logging system was redesigned to **make sense of complex UI–logic flows** between the **Console (tabs, manifests)** and **Pages (route views)** — without flooding the log with irrelevant or redundant entries.

Our goal was to have **clear, human-readable logs** that:

1. Help verify **tab ↔ page linkages (contracts)**
2. Confirm **message transmission** between the Console and the Page
3. Surface **warnings or errors** when the tab–page bindings are inconsistent
4. Remain **quiet** on noise (UI clicks, normal re-renders, React dev quirks)

---

## 🧩 File Structure Overview

Below is the structure of the key files that make up the logging system:
src/
├── components/
│   └── log/
│       └── LogPanel.tsx            # The main UI component that renders logs (with filters, copy button, etc.)
│
├── lib/
│   └── logger.ts                   # Central logging API (logSystem, logAction, logWarn, logError)
│
├── stores/
│   ├── logger-store.ts             # Global store (Zustand) holding all logs, categories, filters, levels
│   └── console-store.ts            # Core console logic — now emits structured logs for tab/page validation
│
└── app/
    └── (protected)/
        └── system-b/
            └── browse-cert-specs-V4/
                └── page.tsx        # Page-level logic with focused logs for tab–page contract validation

---

⚙️ How It Works

1. lib/logger.ts

This is the central logging utility.
It defines four main log functions:
	•	logAction() — for user-triggered operations (e.g. creating or closing a tab).
	•	logSystem() — for system or internal state changes (e.g. tab↔page binding established).
	•	logWarn() — for warnings, such as validation issues or skipped actions.
	•	logError() — for actual failures or unexpected states.

Each function automatically timestamps entries, assigns a category/channel (like console/bind or page/v4), and stores them in the logger-store.
Optionally, logs can include a short human-readable headline (“System: created link between this tab and page”).

⸻

2. stores/logger-store.ts

A small Zustand store that maintains the full list of log entries, filtering, and persistence.
The Log Panel reads directly from this store.
Each entry includes:
	•	timestamp
	•	severity (info / warn / error)
	•	source channel
	•	headline (plain English summary)
	•	structured JSON payload

⸻

3. components/log/LogPanel.tsx

The user-facing console view that displays logs in real time.
Includes category filters (Info / Warn / Error / Action / System) and a copy button for individual entries.
It subscribes to logger-store.ts and re-renders whenever new entries arrive.

⸻

4. stores/console-store.ts

Handles the manifest-driven tab ↔ page relationship that connects UI tabs to their corresponding page instances.
It uses logging in a surgical way:
	•	Logs when a new tab is created (User: created new AI tab).
	•	Logs when a tab is linked or re-linked to a page (System: created link between tab and page).
	•	Logs when data is transmitted via the bus (System: message sent to page or System: message received from page).
	•	Runs lightweight validation of tab↔page bindings and logs warnings when mismatched.

All noisy “UI clicks” or repetitive state changes have been removed — only meaningful transitions are logged.

⸻

5. page.tsx (example in browse-cert-specs-V4/)

This page demonstrates clean logging for runtime validation of tab↔page contracts:
	•	Logs when a contract is established (first link between tab and page).
	•	Logs when a contract is switched (user changes active tab).
	•	Logs when messages arrive from the console or are sent back to it.
	•	Validates bindings on each contract change and warns about inconsistencies.

We intentionally removed mount/unmount logs to eliminate duplicates caused by React StrictMode.
The page now provides just the essential signal for developers debugging the manifest flow.


