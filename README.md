# FlowBit AI Memory Agent

This project implements an AI Agent Memory Layer for invoice processing. It sits on top of an extraction layer (simulated inputs) and learns from human corrections to improve future automation.

## Features

- **Recall Memory:** Retrieves vendor-specific patterns and preferences.
- **Apply Memory:** Automatically corrects missing fields (e.g., Service Date) and maps data (e.g., SKU mapping) based on past learnings.
- **Decision Logic:** Uses heuristics (Tax validation, PO matching, Duplicate detection) to flag issues or auto-approve.
- **Learn:** Updates memory based on human corrections using:
  - **Regex Discovery:** Learns extraction patterns from raw text (handles date formats, labels).
  - **Flexible Token Matching:** Learns loose patterns for terms like "Skonto" even if exact text varies slightly.
  - **Static Mapping:** Maps line item descriptions to SKUs.

## Architecture

- **`src/MemoryAgent.ts`**: Core logic for processing invoices and learning.
- **`src/MemoryStore.ts`**: Persistence layer (JSON-based) for storing learned patterns.
- **`src/index.ts`**: CLI Runner that demonstrates the learning loop.

## How to Run

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Run the Demo:**
   ```bash
   npx ts-node src/index.ts
   ```

## Demo Flow (Expected Outcomes)

The runner processes a sequence of invoices (`data/invoices.json`) and applies corrections (`data/corrections.json`) where available.

1. **Supplier GmbH (Pattern Learning):** 
   - Initial: Missing `serviceDate`. Human corrects it.
   - **Learned:** System learns `Leistungsdatum` regex.
   - **Result:** `INV-A-002` automatically fills `serviceDate`.

2. **Parts AG (Heuristics & Correction):**
   - **Tax Fix:** `INV-B-001` detects "incl. VAT" and recalculates Net/Tax.
   - **Currency:** `INV-B-003` missing currency is learned from "Currency: EUR" in text.

3. **Freight & Co (Advanced Learning):**
   - **Skonto:** `INV-C-001` correction triggers a flexible regex learning for "2% Skonto...".
   - **SKU Mapping:** `INV-C-002` maps "Seefracht" to "FREIGHT".

4. **Duplicates:**
   - System flags `INV-A-004` and `INV-B-004` as duplicates.

## Memory Storage

Memory is persisted in `memory/memory.json`. It tracks:
- **Patterns:** Regexes for text extraction.
- **StaticCorrections:** Fixed value mappings.