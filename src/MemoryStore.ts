import fs from 'fs';
import { MemoryStoreData, VendorMemory, ExtractionPattern, ValueCorrection } from './types';

export class MemoryStore {
  private memoryPath: string;
  private data: MemoryStoreData;

  constructor(filePath: string = 'memory/memory.json') {
    this.memoryPath = filePath;
    this.data = { vendors: {} };
    this.load();
  }

  private load() {
    if (fs.existsSync(this.memoryPath)) {
      try {
        const raw = fs.readFileSync(this.memoryPath, 'utf-8');
        this.data = JSON.parse(raw);
      } catch (e) {
        console.error("Failed to load memory, starting fresh.", e);
        this.data = { vendors: {} };
      }
    } else {
      // Initialize file if not exists
      this.save();
    }
  }

  save() {
    fs.writeFileSync(this.memoryPath, JSON.stringify(this.data, null, 2));
  }

  getVendorMemory(vendor: string): VendorMemory {
    if (!this.data.vendors[vendor]) {
      this.data.vendors[vendor] = {
        vendorName: vendor,
        patterns: [],
        staticCorrections: []
      };
    }
    return this.data.vendors[vendor];
  }

  updateVendorMemory(vendor: string, memory: VendorMemory) {
    this.data.vendors[vendor] = memory;
    this.save();
  }

  addPattern(vendor: string, pattern: ExtractionPattern) {
    const mem = this.getVendorMemory(vendor);
    const existing = mem.patterns.find(p => p.field === pattern.field && p.regexPattern === pattern.regexPattern);
    if (existing) {
      existing.usageCount++;
      existing.lastUsed = new Date().toISOString();
      // Reinforce confidence
      existing.confidence = Math.min(1.0, existing.confidence + 0.05);
    } else {
      mem.patterns.push(pattern);
    }
    this.updateVendorMemory(vendor, mem);
  }

  addStaticCorrection(vendor: string, correction: ValueCorrection) {
    const mem = this.getVendorMemory(vendor);
    // simplistic check for duplicates
    const existing = mem.staticCorrections.find(c => 
      c.field === correction.field && 
      c.triggerValue === correction.triggerValue &&
      c.correctedValue === correction.correctedValue
    );
    
    if (existing) {
      existing.usageCount++;
      existing.confidence = Math.min(1.0, existing.confidence + 0.05);
    } else {
      mem.staticCorrections.push(correction);
    }
    this.updateVendorMemory(vendor, mem);
  }
  
  // Helper to clear memory for demo purposes
  reset() {
    this.data = { vendors: {} };
    this.save();
  }
}
