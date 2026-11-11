import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const now = () => new Date().toISOString();
export class Store {
  constructor(dataDir) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'hudson.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS printers (id TEXT PRIMARY KEY, serial TEXT UNIQUE NOT NULL, data TEXT NOT NULL, secret TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS telemetry (printer_id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS transfers (id TEXT PRIMARY KEY, printer_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, printer_id TEXT NOT NULL, request_key TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(printer_id,request_key));
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, at TEXT NOT NULL, printer_id TEXT, kind TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS op_status ON operations(printer_id,kind,status);`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS library (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, printer_id TEXT NOT NULL, state TEXT NOT NULL, position INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS job_queue ON jobs(printer_id,state,position);
      CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, printer_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS active_runs (printer_id TEXT PRIMARY KEY, attempt_id TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS collections (attempt_id TEXT PRIMARY KEY, printer_id TEXT NOT NULL, good INTEGER NOT NULL, rejected INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS production_requests (scope TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(scope,request_key));`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS spools (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS spool_mounts (printer_id TEXT NOT NULL, source_key TEXT NOT NULL, spool_id TEXT UNIQUE NOT NULL, data TEXT NOT NULL, PRIMARY KEY(printer_id,source_key));
      CREATE TABLE IF NOT EXISTS material_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, spool_id TEXT NOT NULL, amount_mg INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS ledger_spool ON material_ledger(spool_id,id);
      CREATE TABLE IF NOT EXISTS material_plans (job_id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS material_reservations (job_id TEXT NOT NULL, spool_id TEXT NOT NULL, amount_mg INTEGER NOT NULL, PRIMARY KEY(job_id,spool_id));
      CREATE TABLE IF NOT EXISTS material_usage (attempt_id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
  }
  spools() {return this.db.prepare('SELECT data FROM spools ORDER BY rowid').all().map(r=>JSON.parse(r.data));}
  spool(id) {const r=this.db.prepare('SELECT data FROM spools WHERE id=?').get(id);return r&&JSON.parse(r.data);}
  saveSpool(s) {this.db.prepare('INSERT INTO spools VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(s.id,JSON.stringify(s));}
  balanceMg(id) {return this.db.prepare('SELECT COALESCE(SUM(amount_mg),0) AS balance FROM material_ledger WHERE spool_id=?').get(id).balance;}
  movement(m) {const r=this.db.prepare('INSERT INTO material_ledger(spool_id,amount_mg,data) VALUES(?,?,?)').run(m.spoolId,m.amountMg,JSON.stringify({...m,at:now()}));return Number(r.lastInsertRowid);}
  ledger(id) {return this.db.prepare('SELECT id,data FROM material_ledger WHERE spool_id=? ORDER BY id DESC LIMIT 500').all(id).map(r=>({id:r.id,...JSON.parse(r.data)}));}
  mounts() {return this.db.prepare('SELECT data FROM spool_mounts').all().map(r=>JSON.parse(r.data));}
  mount(printerId,sourceKey) {const r=this.db.prepare('SELECT data FROM spool_mounts WHERE printer_id=? AND source_key=?').get(printerId,sourceKey);return r&&JSON.parse(r.data);}
  saveMount(m) {this.db.prepare('INSERT INTO spool_mounts VALUES(?,?,?,?)').run(m.printerId,m.sourceKey,m.spoolId,JSON.stringify(m));}
  unmount(spoolId) {this.db.prepare('DELETE FROM spool_mounts WHERE spool_id=?').run(spoolId);}
  materialPlan(id) {const r=this.db.prepare('SELECT data FROM material_plans WHERE job_id=?').get(id);return r&&JSON.parse(r.data);}
  materialPlans() {return this.db.prepare('SELECT data FROM material_plans').all().map(r=>JSON.parse(r.data));}
  saveMaterialPlan(p) {this.db.prepare('INSERT OR REPLACE INTO material_plans VALUES(?,?)').run(p.jobId,JSON.stringify(p));}
  clearReservations() {this.db.exec('DELETE FROM material_reservations; DELETE FROM material_plans;');}
  reserve(jobId,spoolId,mg) {this.db.prepare('INSERT INTO material_reservations VALUES(?,?,?) ON CONFLICT(job_id,spool_id) DO UPDATE SET amount_mg=amount_mg+excluded.amount_mg').run(jobId,spoolId,mg);}
  reservedMg(id) {return this.db.prepare('SELECT COALESCE(SUM(amount_mg),0) AS reserved FROM material_reservations WHERE spool_id=?').get(id).reserved;}
  usage(id) {const r=this.db.prepare('SELECT data FROM material_usage WHERE attempt_id=?').get(id);return r&&JSON.parse(r.data);}
  pendingUsages() {return this.db.prepare("SELECT data FROM material_usage WHERE json_extract(data,'$.status')='needs_review'").all().map(r=>JSON.parse(r.data));}
  hasEstimatedUsage(spoolId,after) {return this.db.prepare('SELECT data FROM material_usage').all().some(r=>{const u=JSON.parse(r.data);return u.status==='settled'&&!['measured','no-start'].includes(u.method)&&u.lines.some(l=>l.spoolId===spoolId&&l.anchorLedgerId>after);});}
  saveUsage(u) {this.db.prepare('INSERT INTO material_usage VALUES(?,?) ON CONFLICT(attempt_id) DO UPDATE SET data=excluded.data').run(u.attemptId,JSON.stringify(u));return u;}
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result=fn();this.db.exec('COMMIT');return result; }
    catch(error) {this.db.exec('ROLLBACK');throw error;}
  }
  library() {return this.db.prepare("SELECT data FROM library WHERE json_extract(data,'$.deletedAt') IS NULL ORDER BY rowid DESC").all().map(r=>JSON.parse(r.data));}
  jobLibrary() {return this.db.prepare("SELECT data FROM library WHERE json_extract(data,'$.deletedAt') IS NOT NULL AND id IN (SELECT json_extract(data,'$.libraryId') FROM jobs)").all().map(r=>JSON.parse(r.data));}
  libraryItem(id) {const r=this.db.prepare('SELECT data FROM library WHERE id=?').get(id);return r&&JSON.parse(r.data);}
  saveLibrary(item) {this.db.prepare('INSERT OR IGNORE INTO library VALUES(?,?)').run(item.id,JSON.stringify(item));}
  updateLibrary(item) {this.db.prepare('UPDATE library SET data=? WHERE id=?').run(JSON.stringify(item),item.id);}
  jobs(id) {return this.db.prepare('SELECT data FROM jobs WHERE printer_id=? ORDER BY position,rowid').all(id).map(r=>JSON.parse(r.data));}
  job(id) {const r=this.db.prepare('SELECT data FROM jobs WHERE id=?').get(id);return r&&JSON.parse(r.data);}
  saveJob(job) {job.updatedAt=now();this.db.prepare('INSERT INTO jobs VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,position=excluded.position,data=excluded.data').run(job.id,job.printerId,job.state,job.position,JSON.stringify(job));return job;}
  attempt(id) {const r=this.db.prepare('SELECT data FROM attempts WHERE id=?').get(id);return r&&JSON.parse(r.data);}
  attempts(jobId) {return this.db.prepare('SELECT data FROM attempts WHERE job_id=? ORDER BY rowid').all(jobId).map(r=>JSON.parse(r.data));}
  saveAttempt(a) {a.updatedAt=now();this.db.prepare('INSERT INTO attempts VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(a.id,a.jobId,a.printerId,JSON.stringify(a));return a;}
  active(id) {const r=this.db.prepare('SELECT attempt_id FROM active_runs WHERE printer_id=?').get(id);return r&&this.attempt(r.attempt_id);}
  claim(id,attemptId) {this.db.prepare('INSERT INTO active_runs VALUES(?,?)').run(id,attemptId);}
  release(id,attemptId) {this.db.prepare('DELETE FROM active_runs WHERE printer_id=? AND attempt_id=?').run(id,attemptId);}
  collection(id) {const r=this.db.prepare('SELECT data FROM collections WHERE attempt_id=?').get(id);return r&&JSON.parse(r.data);}
  saveCollection(c) {this.db.prepare('INSERT INTO collections VALUES(?,?,?,?,?)').run(c.attemptId,c.printerId,c.good,c.rejected,JSON.stringify(c));}
  productionRequest(scope,key) {const r=this.db.prepare('SELECT fingerprint,data FROM production_requests WHERE scope=? AND request_key=?').get(scope,key);return r&&{fingerprint:r.fingerprint,result:JSON.parse(r.data)};}
  saveProductionRequest(scope,key,fingerprint,result) {this.db.prepare('INSERT INTO production_requests VALUES(?,?,?,?)').run(scope,key,fingerprint,JSON.stringify(result));}
  getSetting(key) { return this.db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value; }
  setSetting(key,value) { this.db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(key,value); }
  nextSequence() {
    let value = Number(this.getSetting('sequence') || crypto.randomInt(20000,28000)) + 1;
    if (value > 29999) value = 20000;
    this.setSetting('sequence', String(value)); return String(value);
  }
  printers() { return this.db.prepare('SELECT data FROM printers').all().map(row => JSON.parse(row.data)); }
  printer(id) { const row = this.db.prepare('SELECT data FROM printers WHERE id=?').get(id); return row && JSON.parse(row.data); }
  secret(id) { return this.db.prepare('SELECT secret FROM printers WHERE id=?').get(id)?.secret; }
  savePrinter(printer,secret) {
    this.db.prepare('INSERT INTO printers VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET serial=excluded.serial,data=excluded.data,secret=excluded.secret').run(printer.id,printer.serial,JSON.stringify(printer),secret);
  }
  telemetry(id) { const row = this.db.prepare('SELECT data FROM telemetry WHERE printer_id=?').get(id); return row && JSON.parse(row.data); }
  saveTelemetry(id,data) { this.db.prepare('INSERT OR REPLACE INTO telemetry VALUES(?,?)').run(id,JSON.stringify(data)); }
  saveTransfer(data) { this.db.prepare('INSERT OR REPLACE INTO transfers VALUES(?,?,?)').run(data.id,data.printerId,JSON.stringify(data)); }
  transfer(id) { const row = this.db.prepare('SELECT data FROM transfers WHERE id=?').get(id); return row && JSON.parse(row.data); }
  operations(id) { return this.db.prepare('SELECT data FROM operations WHERE printer_id=? ORDER BY rowid DESC LIMIT 100').all(id).map(row => JSON.parse(row.data)); }
  operation(id) { const row = this.db.prepare('SELECT data FROM operations WHERE id=?').get(id); return row && JSON.parse(row.data); }
  request(id,key) { const row = this.db.prepare('SELECT data FROM operations WHERE printer_id=? AND request_key=?').get(id,key); return row && JSON.parse(row.data); }
  pending(id) { return this.db.prepare("SELECT data FROM operations WHERE printer_id=? AND status IN ('dispatching','sent','acknowledged','uncertain')").all(id).map(row => JSON.parse(row.data)); }
  saveOperation(op) {
    op.updatedAt = now();
    this.db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,data=excluded.data').run(op.id,op.printerId,op.requestKey,op.kind,op.status,JSON.stringify(op));
    return op;
  }
  recover() {
    const rows = this.db.prepare("SELECT data FROM operations WHERE status IN ('dispatching','sent','acknowledged')").all();
    for (const row of rows) this.saveOperation({ ...JSON.parse(row.data),status:'uncertain',detail:'Agente reiniciado; pendiente de conciliación. No se reenvió el comando.' });
    for (const row of this.db.prepare('SELECT data FROM transfers').all()) {
      const transfer = JSON.parse(row.data);
      if (transfer.status === 'uploading') this.saveTransfer({...transfer,status:'interrupted'});
    }
  }
  event(printerId,kind,data={}) {
    this.db.prepare('INSERT INTO events(at,printer_id,kind,data) VALUES(?,?,?,?)').run(now(),printerId,kind,JSON.stringify(data));
    // Bound operational history; operation records are kept separately.
    this.db.prepare('DELETE FROM events WHERE id < (SELECT COALESCE(MAX(id),0)-10000 FROM events)').run();
  }
  events() { return this.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 100').all().map(row=>({...row,data:JSON.parse(row.data)})); }
  close() { this.db.close(); }
}
