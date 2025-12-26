export interface LineItem {
  sku: string | null;
  description?: string;
  qty: number;
  unitPrice: number;
  qtyDelivered?: number; // For PO/DN context
}

export interface InvoiceFields {
  invoiceNumber: string;
  invoiceDate: string;
  serviceDate: string | null;
  currency: string | null;
  poNumber?: string | null;
  netTotal: number;
  taxRate: number;
  taxTotal: number;
  grossTotal: number;
  lineItems: LineItem[];
  discountTerms?: string | null; // Extracted or inferred
}

export interface Invoice {
  invoiceId: string;
  vendor: string;
  fields: InvoiceFields;
  confidence: number;
  rawText: string;
}

export interface PurchaseOrder {
  poNumber: string;
  vendor: string;
  date: string;
  lineItems: LineItem[];
}

export interface DeliveryNote {
  dnNumber: string;
  vendor: string;
  poNumber: string;
  date: string;
  lineItems: LineItem[];
}

export interface ReferenceData {
  purchaseOrders: PurchaseOrder[];
  deliveryNotes: DeliveryNote[];
}

export interface Correction {
  field: string;
  from: any;
  to: any;
  reason: string;
}

export interface HumanCorrectionLog {
  invoiceId: string;
  vendor: string;
  corrections: Correction[];
  finalDecision: "approved" | "rejected";
}

// Memory Types
export interface ExtractionPattern {
  field: string;
  regexPattern: string; // The regex string to find the value
  confidence: number;
  usageCount: number;
  lastUsed: string;
}

export interface ValueCorrection {
  field: string;
  triggerValue?: any; // If null, applies generally
  correctedValue: any;
  condition?: string; // "always", "if_missing", "if_mismatch"
  confidence: number;
  usageCount: number;
}

export interface VendorMemory {
  vendorName: string;
  patterns: ExtractionPattern[]; // Learned patterns to extract data from rawText
  staticCorrections: ValueCorrection[]; // Learned fixed corrections (e.g. mapping "Seefracht" -> SKU)
}

export interface MemoryStoreData {
  vendors: { [vendorName: string]: VendorMemory };
}

export interface ProcessResult {
  normalizedInvoice: InvoiceFields;
  proposedCorrections: Correction[];
  requiresHumanReview: boolean;
  reasoning: string;
  confidenceScore: number;
  memoryUpdates: string[]; // Descriptions of what might be learned
  auditTrail: {
    step: string;
    timestamp: string;
    details: string;
  }[];
}
