import { 
  Invoice, 
  InvoiceFields, 
  ProcessResult, 
  ReferenceData, 
  Correction, 
  HumanCorrectionLog, 
  ExtractionPattern,
  LineItem
} from './types';
import { MemoryStore } from './MemoryStore';

export class MemoryAgent {
  private memoryStore: MemoryStore;

  constructor(memoryStore: MemoryStore) {
    this.memoryStore = memoryStore;
  }

  async process(invoice: Invoice, referenceData: ReferenceData, pastInvoices: Invoice[] = []): Promise<ProcessResult> {
    const auditTrail: any[] = [];
    const normalizedInvoice = JSON.parse(JSON.stringify(invoice.fields)); // Deep copy
    const proposedCorrections: Correction[] = [];
    const memoryUpdates: string[] = [];
    let requiresHumanReview = false;
    let reasoning = "";

    const vendor = invoice.vendor;
    const memory = await this.memoryStore.getVendorMemory(vendor);

    auditTrail.push({ step: 'recall', timestamp: new Date().toISOString(), details: `Loaded memory for ${vendor}` });

    // 1. DUPLICATE CHECK
    const duplicate = pastInvoices.find(past => 
      past.vendor === vendor && 
      past.fields.invoiceNumber === invoice.fields.invoiceNumber &&
      past.invoiceId !== invoice.invoiceId // Ensure we don't match self if self is in list
    );

    if (duplicate) {
      requiresHumanReview = true;
      reasoning += `Potential duplicate of invoice ${duplicate.invoiceId}. `;
      proposedCorrections.push({
        field: "invoiceNumber",
        from: invoice.fields.invoiceNumber,
        to: "DUPLICATE-FLAG",
        reason: "Duplicate submission detected"
      });
      auditTrail.push({ step: 'decide', timestamp: new Date().toISOString(), details: "Flagged as duplicate." });
      
      return {
        normalizedInvoice,
        proposedCorrections,
        requiresHumanReview,
        reasoning: reasoning.trim(),
        confidenceScore: 0.0, // Low confidence if duplicate
        memoryUpdates,
        auditTrail
      };
    }

    // 2. APPLY MEMORY (Recall & Apply)
    // 2a. Patterns (Missing Data Recovery)
    for (const pattern of memory.patterns) {
      // Check if field is missing or we want to overwrite (usually only if missing)
      const currentVal = this.getFieldValue(normalizedInvoice, pattern.field);
      if (currentVal === null || currentVal === undefined || currentVal === "") {
        const extracted = this.extractWithRegex(invoice.rawText, pattern.regexPattern);
        if (extracted) {
          const correction: Correction = {
            field: pattern.field,
            from: currentVal,
            to: extracted,
            reason: `Memory applied: Found match in raw text using learned pattern for ${pattern.field}`
          };
          proposedCorrections.push(correction);
          this.setFieldValue(normalizedInvoice, pattern.field, extracted);
          auditTrail.push({ step: 'apply', timestamp: new Date().toISOString(), details: `Applied pattern for ${pattern.field}: ${extracted}` });
        }
      }
    }

    // 2b. Static Corrections (e.g. SKU mapping, Currency defaults)
    for (const rule of memory.staticCorrections) {
      if (rule.field.includes('lineItems')) {
        // Handle Line Items logic
        // Assumes field is like "lineItems[].sku" or "lineItems.sku"
        // We iterate all line items
        normalizedInvoice.lineItems.forEach((item: LineItem, index: number) => {
          if (rule.field.endsWith('.sku') && rule.triggerValue) {
             // Check if description matches trigger
             if (item.description && item.description.includes(rule.triggerValue) && !item.sku) {
               proposedCorrections.push({
                 field: `lineItems[${index}].sku`,
                 from: item.sku,
                 to: rule.correctedValue,
                 reason: `Memory applied: Mapped description '${item.description}' to SKU '${rule.correctedValue}'`
               });
               item.sku = rule.correctedValue;
             }
          }
        });
      } else {
        // Top level fields (e.g. Currency)
        const currentVal = this.getFieldValue(normalizedInvoice, rule.field);
        // Apply if missing or if rule says "always" (though for now assume missing/null)
        if (currentVal === null || rule.condition === 'always') {
           proposedCorrections.push({
             field: rule.field,
             from: currentVal,
             to: rule.correctedValue,
             reason: `Memory applied: Static correction for ${rule.field}`
           });
           this.setFieldValue(normalizedInvoice, rule.field, rule.correctedValue);
        }
      }
    }

    // 3. LOGIC & HEURISTICS (Apply) 
    
    // 3a. PO Matching
    // If PO is present (extracted or recovered), validate it.
    // If PO is missing, try to find one in reference data that matches this vendor + date range + line items
    if (!normalizedInvoice.poNumber) {
      const candidatePO = this.findMatchingPOWithVendor(normalizedInvoice, vendor, referenceData);
      if (candidatePO) {
        proposedCorrections.push({
          field: "poNumber",
          from: null,
          to: candidatePO.poNumber,
          reason: "Heuristic: Found matching PO based on vendor and line items."
        });
        normalizedInvoice.poNumber = candidatePO.poNumber;
      }
    }

    // 3b. Tax Validation
    // Check if Gross approx Net * (1+Tax)
    const calculatedGross = normalizedInvoice.netTotal * (1 + normalizedInvoice.taxRate);
    const taxCalcDiff = Math.abs(calculatedGross - normalizedInvoice.grossTotal);
    const sumDiff = Math.abs((normalizedInvoice.netTotal + normalizedInvoice.taxTotal) - normalizedInvoice.grossTotal);
    
    // Check 1: Do the extracted parts sum up?
    if (sumDiff > 1.0) {
         requiresHumanReview = true;
         reasoning += "Totals do not sum up (Net + Tax != Gross). ";
    }
    
    // Check 2: Does Net * TaxRate match Tax/Gross? (The "VAT logic" check)
    if (taxCalcDiff > 1.0) {
        // Mismatch between Math and Extracted.
        // Try to fix based on "incl. VAT" text presence
        const lcText = invoice.rawText.toLowerCase();
        if (lcText.includes("incl. vat") || lcText.includes("mwst. inkl")) {
            // Hypothesis: The Extracted Gross is the correct "Total to Pay".
            // The Extracted Net was likely just Gross copied, or wrong.
            // Recalculate Net and Tax from Gross.
            
            const realGross = normalizedInvoice.grossTotal; 
            const newNet = Number((realGross / (1 + normalizedInvoice.taxRate)).toFixed(2));
            const newTax = Number((realGross - newNet).toFixed(2));
            
            proposedCorrections.push({
                field: "netTotal",
                from: normalizedInvoice.netTotal,
                to: newNet,
                reason: "Detected 'incl. VAT' context, recalculated Net from Gross"
            });
             proposedCorrections.push({
                field: "taxTotal",
                from: normalizedInvoice.taxTotal,
                to: newTax,
                reason: "Recalculated Tax from Gross"
            });
            normalizedInvoice.netTotal = newNet;
            normalizedInvoice.taxTotal = newTax;
        } else {
             requiresHumanReview = true;
             reasoning += "Tax calculation invalid (Net * Rate != Gross). ";
        }
    }


    // 4. SCORING & DECISION
    let score = invoice.confidence;
    if (proposedCorrections.length > 0) {
        // Boost confidence if we fixed things using memory
        score += 0.1; 
        reasoning += "Applied corrections based on memory/heuristics. ";
    }
    
    // Cap score
    score = Math.min(0.99, score);

    // If specific fields are still missing, penalize or require review
    if (!normalizedInvoice.invoiceNumber || !normalizedInvoice.invoiceDate || !normalizedInvoice.currency) {
        requiresHumanReview = true;
        reasoning += "Critical fields missing. ";
    }

    if (score < 0.8) {
        requiresHumanReview = true; // High bar for automation
    }

    auditTrail.push({ step: 'decide', timestamp: new Date().toISOString(), details: `Review: ${requiresHumanReview}, Score: ${score.toFixed(2)}` });

    return {
      normalizedInvoice,
      proposedCorrections,
      requiresHumanReview,
      reasoning: reasoning.trim(),
      confidenceScore: score,
      memoryUpdates,
      auditTrail
    };
  }

  async learn(invoice: Invoice, humanLog: HumanCorrectionLog) {
    // invoice: The ORIGINAL invoice (before system corrections, or we check against system logic?)
    // Usually we learn from (Original Input) -> (Human Final Truth).
    // The human corrections apply to the original fields.

    if (humanLog.finalDecision === 'rejected') {
        // Negative reinforcement could go here
        return;
    }

    const vendor = invoice.vendor;
    
    // Iterate sequentially to support await
    for (const c of humanLog.corrections) {
        // 1. Text Extraction Learning
        // If the "to" value can be found in the raw text, learn the pattern.
        const minLength = c.field === 'currency' ? 3 : 4;
        
        if (typeof c.to === 'string' && c.to.length >= minLength) { // Min length to avoid noise
             let searchValues = [c.to];
             
             // If looks like ISO Date YYYY-MM-DD, try DD.MM.YYYY
             if (/^\d{4}-\d{2}-\d{2}$/.test(c.to)) {
                 const [y, m, d] = c.to.split('-');
                 searchValues.push(`${d}.${m}.${y}`);
                 searchValues.push(`${d}/${m}/${y}`);
             }

             let foundMatch = false;
             for (const val of searchValues) {
                 if (foundMatch) break;
                 
                 const escapedValue = this.escapeRegExp(val);
                 const index = invoice.rawText.indexOf(val);
                 
                 if (index !== -1) {
                     foundMatch = true;
                     // Get context before. e.g. "Leistungsdatum: "
                     const windowSize = 25;
                     const start = Math.max(0, index - windowSize);
                     const context = invoice.rawText.substring(start, index);
                     
                     // extract potential label (last word/token before value)
                     const cleanContext = context.replace(/\n/g, ' ').trim();
                     const labelMatch = cleanContext.match(/([A-Za-zäöüÄÖÜß]+):?\s*$/);
                     
                     if (labelMatch) {
                         const label = labelMatch[1]; 
                         let valuePattern = escapedValue.replace(/\d/g, '\\d'); // generic
                         
                         if (/\d{2}\.\d{2}\.\d{4}/.test(val)) {
                             valuePattern = '(\\d{2}\\.\\d{2}\\.\\d{4})';
                         } else if (/\d{2}\/\d{2}\/\d{4}/.test(val)) {
                             valuePattern = '(\\d{2}\/\\d{2}\/\\d{4})';
                         } else {
                             valuePattern = `(${valuePattern})`;
                         }

                         const regex = `${label}:?\\s*${valuePattern}`;

                         const pattern: ExtractionPattern = {
                             field: c.field,
                             regexPattern: regex,
                             confidence: 0.6,
                             usageCount: 1,
                             lastUsed: new Date().toISOString()
                         };
                         
                         await this.memoryStore.addPattern(vendor, pattern);
                     }
                 }
             }

             // Fallback: Flexible Token Match (e.g. for Skonto "2% Skonto if paid within..." vs "2% Skonto within...")
             if (!foundMatch && c.to.includes(' ')) {
                 // Create a pattern: word1.*word2.*word3
                 const words = c.to.split(/\s+/).filter((w: string) => w.length > 1); // Filter tiny words
                 if (words.length > 2) {
                     const flexiblePattern = words.map((w: string) => this.escapeRegExp(w)).join('.*');
                     const match = invoice.rawText.match(new RegExp(flexiblePattern, 'i'));
                     
                     if (match) {
                         // We found the loosely matching text in the document
                         // Let's create a pattern that captures this structure
                         // Simplistic approach: capture the whole matched sequence
                         // But we want to reuse the label logic if possible.
                         // Or just store this specific loose pattern as a "whole field" extractor
                         
                         const pattern: ExtractionPattern = {
                             field: c.field,
                             regexPattern: flexiblePattern, // Use the loose pattern itself to find it again
                             confidence: 0.5,
                             usageCount: 1,
                             lastUsed: new Date().toISOString()
                         };
                         await this.memoryStore.addPattern(vendor, pattern);
                     }
                 }
             }
        }

        // 2. Static Mapping Learning
        // e.g. "discountTerms" -> "2% Skonto..."
        // If the value seems constant or we want to map "Seefracht" -> "FREIGHT"
        if (c.field.includes('sku') && c.to) {
            // Find the description for this line item
            // Need to parse field path "lineItems[0].sku"
            const match = c.field.match(/lineItems\[(\d+)\]\.sku/);
            if (match) {
                const idx = parseInt(match[1]);
                const desc = invoice.fields.lineItems[idx]?.description;
                if (desc) {
                    // Learn: Description -> SKU
                    await this.memoryStore.addStaticCorrection(vendor, {
                        field: 'lineItems.sku', // Generic field
                        triggerValue: desc,     // Specific trigger
                        correctedValue: c.to,
                        confidence: 0.8,
                        usageCount: 1
                    });
                }
            }
        }
        
        // 3. Currency Learning
        if (c.field === 'currency' && c.to) {
             // If currency was missing and is now EUR, and it's in text
             if (invoice.rawText.includes(c.to)) {
                 // Maybe learn pattern "Currency: EUR"? 
                 // Or just static default?
                 // Let's add a static correction if it seems missing often.
                 // For now, let's treat it as a Pattern if found in text, or static if not found but corrected.
             }
        }
    }
  }

  // --- Helpers ---
  
  private escapeRegExp(string: string): string { 
    return string.replace(/[.*+?^${}()|[\\]/g, '\\$&'); 
  }

  private getFieldValue(fields: any, path: string): any {
    if (path.includes('[')) return null; // Logic for arrays handled separately or simplified
    return fields[path];
  }

  private setFieldValue(fields: any, path: string, value: any) {
    if (path.includes('[')) return;
    fields[path] = value;
  }

  private extractWithRegex(text: string, patternStr: string): string | null {
    try {
        const regex = new RegExp(patternStr, 'i'); // Case insensitive
        const match = text.match(regex);
        return match ? match[1] : null;
    } catch (e) {
        return null;
    }
  }

  // Re-implementing findMatchingPO correctly with context
  public findMatchingPOWithVendor(invoice: InvoiceFields, vendor: string, refData: ReferenceData): any {
      const invDate = this.parseDate(invoice.invoiceDate);
      if (!invDate) return null;

      const candidates = refData.purchaseOrders.filter(po => po.vendor === vendor);
      
      for (const po of candidates) {
          const poDate = this.parseDate(po.date);
          if (!poDate) continue;
          
          // Date check: PO must be before Invoice, max 60 days
          const diffTime = Math.abs(invDate.getTime() - poDate.getTime());
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
          
          if (invDate >= poDate && diffDays < 60) {
              // Item Match
              // Check if at least one SKU matches
              const skuMatch = po.lineItems.some(poItem => 
                 invoice.lineItems.some(invItem => invItem.sku === poItem.sku)
              );
              
              if (skuMatch) return po;
              
              // Or Fuzzy Match on Unit Price + Qty (if SKU missing)
               const fuzzyMatch = po.lineItems.some(poItem => 
                 invoice.lineItems.some(invItem => 
                     Math.abs(invItem.unitPrice - poItem.unitPrice) < 0.01 && 
                     invItem.qty === poItem.qty
                 )
              );
              if (fuzzyMatch) return po;
          }
      }
      return null;
  }

  private parseDate(dateStr: string): Date | null {
      if (!dateStr) return null;
      // Handle DD.MM.YYYY
      if (dateStr.includes('.')) {
          const parts = dateStr.split('.');
          return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
      }
      return new Date(dateStr);
  }
}