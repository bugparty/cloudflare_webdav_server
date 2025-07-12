import { DurableObject } from "cloudflare:workers";
import type { Env } from './types';

export interface LogEntry {
  id: string;
  timestamp: string;
  operation: string;
  path: string;
  details: string; // JSON string for SQL storage
}

export interface HttpLogEntry {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  status: number;
  requestHeaders: string; // JSON string for SQL storage
  responseHeaders: string; // JSON string for SQL storage
  additionalInfo?: string;
}

export class LogStorage extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.initializeTables();
  }

  // Initialize database tables
  private async initializeTables() {
    // Create write operation logs table
    await this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS write_operation_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        operation TEXT NOT NULL,
        path TEXT NOT NULL,
        details TEXT NOT NULL
      )
    `);

    // Create HTTP logs table
    await this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS http_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        method TEXT NOT NULL,
        url TEXT NOT NULL,
        status INTEGER NOT NULL,
        request_headers TEXT NOT NULL,
        response_headers TEXT NOT NULL,
        additional_info TEXT
      )
    `);

    // Create indexes for better performance
    await this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_write_logs_timestamp ON write_operation_logs(timestamp)
    `);
    
    await this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_http_logs_timestamp ON http_logs(timestamp)
    `);
  }

  // RPC method to add a write operation log
  async addWriteOperationLog(logData: {
    operation: string;
    path: string;
    details: any;
  }): Promise<{ success: boolean; id: string }> {
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    
    await this.ctx.storage.sql.exec(
      `INSERT INTO write_operation_logs (id, timestamp, operation, path, details) 
       VALUES (?, ?, ?, ?, ?)`,
      id,
      timestamp,
      logData.operation,
      logData.path,
      JSON.stringify(logData.details)
    );

    // Keep only the last 50 entries
    await this.ctx.storage.sql.exec(
      `DELETE FROM write_operation_logs 
       WHERE id NOT IN (
         SELECT id FROM write_operation_logs 
         ORDER BY timestamp DESC 
         LIMIT 50
       )`
    );

    return { success: true, id };
  }

  // RPC method to get write operation logs
  async getWriteOperationLogs(format: 'json' | 'text' = 'json'): Promise<LogEntry[] | string> {
    const result = this.ctx.storage.sql.exec(
      `SELECT id, timestamp, operation, path, details 
       FROM write_operation_logs 
       ORDER BY timestamp DESC`
    );

    const logs: LogEntry[] = [];
    for (const row of result) {
      logs.push({
        id: row.id as string,
        timestamp: row.timestamp as string,
        operation: row.operation as string,
        path: row.path as string,
        details: row.details as string
      });
    }

    if (format === 'text') {
      return logs.map(log => 
        `=== ${log.timestamp} - ${log.operation} ===\n` +
        `Path: ${log.path}\n` +
        `Details: ${log.details}\n` +
        '---\n\n'
      ).join('');
    }

    return logs;
  }

  // RPC method to clear write operation logs
  async clearWriteOperationLogs(): Promise<{ success: boolean }> {
    await this.ctx.storage.sql.exec(`DELETE FROM write_operation_logs`);
    return { success: true };
  }

  // RPC method to add an HTTP log
  async addHttpLog(logData: {
    method: string;
    url: string;
    status: number;
    requestHeaders: Record<string, string>;
    responseHeaders: Record<string, string>;
    additionalInfo?: string;
  }): Promise<{ success: boolean; id: string }> {
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    
    await this.ctx.storage.sql.exec(
      `INSERT INTO http_logs (id, timestamp, method, url, status, request_headers, response_headers, additional_info) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      timestamp,
      logData.method,
      logData.url,
      logData.status,
      JSON.stringify(logData.requestHeaders),
      JSON.stringify(logData.responseHeaders),
      logData.additionalInfo || null
    );

    // Keep only the last 100 entries
    await this.ctx.storage.sql.exec(
      `DELETE FROM http_logs 
       WHERE id NOT IN (
         SELECT id FROM http_logs 
         ORDER BY timestamp DESC 
         LIMIT 100
       )`
    );

    return { success: true, id };
  }

  // RPC method to get HTTP logs
  async getHttpLogs(format: 'json' | 'text' = 'json'): Promise<HttpLogEntry[] | string> {
    const result = this.ctx.storage.sql.exec(
      `SELECT id, timestamp, method, url, status, request_headers, response_headers, additional_info 
       FROM http_logs 
       ORDER BY timestamp DESC`
    );

    const logs: HttpLogEntry[] = [];
    for (const row of result) {
      logs.push({
        id: row.id as string,
        timestamp: row.timestamp as string,
        method: row.method as string,
        url: row.url as string,
        status: row.status as number,
        requestHeaders: row.request_headers as string,
        responseHeaders: row.response_headers as string,
        additionalInfo: row.additional_info as string | undefined
      });
    }

    if (format === 'text') {
      return logs.map(log => {
        const requestHeaders = JSON.parse(log.requestHeaders);
        const responseHeaders = JSON.parse(log.responseHeaders);
        
        const requestHeadersText = Object.entries(requestHeaders)
          .map(([name, value]) => `${name.charAt(0).toUpperCase() + name.slice(1)}: ${value}`)
          .join('\n');
        
        const responseHeadersText = Object.entries(responseHeaders)
          .map(([name, value]) => `${name.charAt(0).toUpperCase() + name.slice(1)}: ${value}`)
          .join('\n');
        
        let logText = `=== ${log.timestamp} ===\n`;
        logText += `${log.method} ${log.url} HTTP/1.1\n`;
        logText += `${requestHeadersText}\n\n`;
        logText += `HTTP/1.1 ${log.status}\n`;
        logText += `${responseHeadersText}\n\n`;
        
        if (log.additionalInfo) {
          logText += `${log.additionalInfo}\n\n`;
        }
        
        logText += '---\n\n';
        return logText;
      }).join('');
    }

    return logs;
  }

  // RPC method to clear HTTP logs
  async clearHttpLogs(): Promise<{ success: boolean }> {
    await this.ctx.storage.sql.exec(`DELETE FROM http_logs`);
    return { success: true };
  }

  // RPC method to get log status
  async getLogStatus(): Promise<{
    httpLogEntries: number;
    writeOperationLogEntries: number;
    maxHttpLogEntries: number;
    maxWriteLogEntries: number;
  }> {
    const httpCountResult = this.ctx.storage.sql.exec(
      `SELECT COUNT(*) as count FROM http_logs`
    );
    const writeCountResult = this.ctx.storage.sql.exec(
      `SELECT COUNT(*) as count FROM write_operation_logs`
    );

    const httpCount = httpCountResult.one()?.count as number || 0;
    const writeCount = writeCountResult.one()?.count as number || 0;

    return {
      httpLogEntries: httpCount,
      writeOperationLogEntries: writeCount,
      maxHttpLogEntries: 100,
      maxWriteLogEntries: 50
    };
  }

  // RPC method to clear all logs
  async clearAllLogs(): Promise<{ success: boolean }> {
    await this.ctx.storage.sql.exec(`DELETE FROM http_logs`);
    await this.ctx.storage.sql.exec(`DELETE FROM write_operation_logs`);
    return { success: true };
  }
}