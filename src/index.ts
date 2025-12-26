import fs from 'fs';
import { MemoryStore } from './MemoryStore';
import { MemoryAgent } from './MemoryAgent';
import { Invoice, ReferenceData, HumanCorrectionLog } from './types';

async function main() {
  console.log("=== FlowBit AI Memory Agent Demo ===\n");

  // Load Data
  const invoices: Invoice[] = JSON.parse(fs.readFileSync('data/invoices.json', 'utf-8'));
  const referenceData: ReferenceData = JSON.parse(fs.readFileSync('data/reference.json', 'utf-8'));
  const corrections: HumanCorrectionLog[] = JSON.parse(fs.readFileSync('data/corrections.json', 'utf-8'));

  // Init System
  const memoryStore = new MemoryStore();
  memoryStore.reset(); // Start fresh for demo
  const agent = new MemoryAgent(memoryStore);

  const processedInvoices: Invoice[] = [];

  for (const invoice of invoices) {
    console.log(`\n--------------------------------------------------
`);
    console.log(`Processing Invoice: ${invoice.invoiceId} (${invoice.vendor})
`);
    
    // 1. Run Agent
    const result = agent.process(invoice, referenceData, processedInvoices);

    // Output Result
    console.log(`Confidence: ${result.confidenceScore.toFixed(2)}`);
    console.log(`Requires Review: ${result.requiresHumanReview}`);
    if (result.reasoning) console.log(`Reasoning: ${result.reasoning}`);
    
    if (result.proposedCorrections.length > 0) {
      console.log("Proposed Corrections:");
      result.proposedCorrections.forEach(c => {
        console.log(`  - [${c.field}] ${c.from} -> ${c.to} (${c.reason})`);
      });
    }

    // 2. Simulate Human Review / Learning
    // Check if we have a "ground truth" correction log for this invoice
    const humanInput = corrections.find(c => c.invoiceId === invoice.invoiceId);
    
    if (humanInput) {
      console.log(`\n[Human Action] Corrections received for ${invoice.invoiceId}. Learning...
`);
      agent.learn(invoice, humanInput);
      // In a real system, we'd update the invoice with accepted corrections before saving to history.
      // Here, for history, we'll assume the human corrections are the truth.
      // We manually patch the invoice for 'processedInvoices' list
      const correctedInvoice = JSON.parse(JSON.stringify(invoice));
      humanInput.corrections.forEach(c => {
        // Simple patch for top-level fields
        if (!c.field.includes('[')) {
             correctedInvoice.fields[c.field] = c.to;
        }
      });
      processedInvoices.push(correctedInvoice);
    } else {
       // If no correction, assume system output (or original if no corrections proposed) was accepted?
       // For this demo, let's assume the normalized result is accepted if confidence is high, or just push original.
       processedInvoices.push(invoice);
    }
  }

  console.log("\n\n=== Final Memory State ===");
  // console.log(JSON.stringify(memoryStore['data'], null, 2)); 
  // Accessing private property via any cast for demo dump
  console.log(JSON.stringify((memoryStore as any).data, null, 2));
}

main().catch(err => console.error(err));
