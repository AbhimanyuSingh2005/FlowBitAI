import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { VendorMemory, ExtractionPattern, ValueCorrection } from './types';

export class MemoryStore {
  private db: sqlite3.Database;
  private dbPath: string;

  constructor(filePath: string = 'memory/memory.sqlite') {
    this.dbPath = filePath;
    
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new sqlite3.Database(this.dbPath);
    this.init();
  }

  private init() {
    this.db.serialize(() => {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS patterns (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          vendor TEXT,
          field TEXT,
          regexPattern TEXT,
          confidence REAL,
          usageCount INTEGER,
          lastUsed TEXT
        )
      `);

      this.db.run(`
        CREATE TABLE IF NOT EXISTS static_corrections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          vendor TEXT,
          field TEXT,
          triggerValue TEXT,
          correctedValue TEXT,
          condition TEXT,
          confidence REAL,
          usageCount INTEGER
        )
      `);
    });
  }

  // Helper to wrap db.all in Promise
  private async query(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // Helper to wrap db.run in Promise
  private async execute(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async getVendorMemory(vendor: string): Promise<VendorMemory> {
    const patterns = (await this.query(
      `SELECT field, regexPattern, confidence, usageCount, lastUsed FROM patterns WHERE vendor = ?`, 
      [vendor]
    )) as ExtractionPattern[];

    const staticCorrections = (await this.query(
      `SELECT field, triggerValue, correctedValue, condition, confidence, usageCount FROM static_corrections WHERE vendor = ?`,
      [vendor]
    )) as ValueCorrection[];

    return {
      vendorName: vendor,
      patterns,
      staticCorrections
    };
  }

  async addPattern(vendor: string, pattern: ExtractionPattern) {
    // Check if exists
    const existing = await this.query(
      `SELECT id, confidence, usageCount FROM patterns WHERE vendor = ? AND field = ? AND regexPattern = ?`,
      [vendor, pattern.field, pattern.regexPattern]
    );

    if (existing.length > 0) {
      const rec = existing[0];
      const newConf = Math.min(1.0, rec.confidence + 0.05);
      await this.execute(
        `UPDATE patterns SET usageCount = usageCount + 1, lastUsed = ?, confidence = ? WHERE id = ?`,
        [new Date().toISOString(), newConf, rec.id]
      );
    } else {
      await this.execute(
        `INSERT INTO patterns (vendor, field, regexPattern, confidence, usageCount, lastUsed) VALUES (?, ?, ?, ?, ?, ?)`,
        [vendor, pattern.field, pattern.regexPattern, pattern.confidence, pattern.usageCount, pattern.lastUsed]
      );
    }
  }

  async addStaticCorrection(vendor: string, correction: ValueCorrection) {
    // Check if exists
    // Handle null triggerValue for SQL (if triggerValue is undefined/null, we store as NULL or empty string?)
    // Let's assume triggerValue might be null.
    // However, SQLite matching NULL with = ? usually requires IS NULL. 
    // To simplify, we'll convert null to empty string or handle explicitly.
    // For now, let's treat triggerValue as text.
    
    const trigger = correction.triggerValue || null;

    const existing = await this.query(
      `SELECT id, confidence FROM static_corrections WHERE vendor = ? AND field = ? AND (triggerValue = ? OR (triggerValue IS NULL AND ? IS NULL)) AND correctedValue = ?`,
      [vendor, correction.field, trigger, trigger, correction.correctedValue]
    );

    if (existing.length > 0) {
      const rec = existing[0];
      const newConf = Math.min(1.0, rec.confidence + 0.05);
      await this.execute(
        `UPDATE static_corrections SET usageCount = usageCount + 1, confidence = ? WHERE id = ?`,
        [newConf, rec.id]
      );
    } else {
      await this.execute(
        `INSERT INTO static_corrections (vendor, field, triggerValue, correctedValue, condition, confidence, usageCount) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [vendor, correction.field, trigger, correction.correctedValue, correction.condition || null, correction.confidence, correction.usageCount]
      );
    }
  }
  
  async reset() {
    await this.execute(`DELETE FROM patterns`);
    await this.execute(`DELETE FROM static_corrections`);
  }

  close() {
    this.db.close();
  }
}