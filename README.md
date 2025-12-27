# FlowBitAI - Intelligent Invoice Memory Agent

FlowBitAI is a prototype for an adaptive invoice processing system. It uses an agentic approach to "learn" from human corrections, progressively building a memory of vendor-specific patterns and rules to improve automation rates over time.

## 🧠 Core Concept

The system simulates a continuous improvement loop:
1.  **Process**: The Agent attempts to extract and normalize invoice data using its current memory and heuristics.
2.  **Review**: If confidence is low or anomalies are detected, the invoice is flagged for human review.
3.  **Learn**: When a human corrects the data (provided via `corrections.json`), the Agent analyzes the discrepancy.
    *   If the correct value exists in the raw document text, it learns a **Regex Pattern** (context-aware).
    *   If the correct value is a mapping (e.g., Description to SKU), it learns a **Static Correction**.
4.  **Recall**: On subsequent invoices from the same vendor, the Agent recalls these patterns to automatically fix missing or incorrect data.

## 🏗 Architecture

### 1. Memory Agent (`src/MemoryAgent.ts`)
The brain of the operation. It orchestrates the processing workflow:
*   **Duplicate Check**: Detects double submissions.
*   **Memory Application**: Queries the `MemoryStore` for vendor-specific rules to fill gaps (e.g., missing `serviceDate` or `currency`).
*   **Heuristics**:
    *   **PO Matching**: Matches invoices to Purchase Orders in `reference.json` based on vendor, date, and line items.
    *   **Tax Validation**: Verifies `Net + Tax = Gross` and recalculates based on "Incl. VAT" logic if needed.
*   **Learning**: Updates the memory store based on human feedback.

### 2. Memory Store (`src/MemoryStore.ts`)
A persistent SQLite database that stores:
*   **Extraction Patterns**: Regex rules linked to specific fields and vendors.
*   **Static Corrections**: Fixed mappings (e.g., "Seefracht" -> "FRT-001") triggered by specific values.
*   **Confidence Metrics**: Tracks usage and confidence of learned rules.

### 3. Data Simulation
*   `data/invoices.json`: Raw invoice data (simulating OCR output) with intentional defects.
*   `data/corrections.json`: "Ground truth" corrections simulating human operator actions.
*   `data/reference.json`: Master data (POs, Delivery Notes) for validation.

## 🚀 Getting Started

### Prerequisites
*   Node.js (v18+)
*   npm

### Installation
```bash
npm install
```

### Run the Demo
The demo script runs the full simulation: processing invoices, applying logic, simulating human review, and showing the "learning" in real-time.

```bash
npm run demo
```

## 📊 Demo Output Explained

When you run the demo, you will see a log for each invoice:

1.  **Processing**: The agent attempts to extract data.
2.  **Proposed Corrections**: The agent lists what it changed based on Memory or Heuristics (e.g., `[serviceDate] null -> 01.01.2024`).
3.  **Human Action**: If a correction log exists, the system simulates a human fixing the remaining errors.
4.  **Learning**: The agent reports if it successfully learned a new pattern from the human correction.
5.  **Final Memory State**: At the end, the system dumps the learned rules (Regex/Mappings) for each vendor, showing how the "Brain" has evolved.

## 🛠 Tech Stack
*   **TypeScript**: Type-safe logic.
*   **SQLite**: Lightweight, persistent storage for the Agent's memory.
*   **Node.js**: Runtime environment.
