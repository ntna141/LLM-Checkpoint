import initSqlJs, { Database } from 'sql.js';
import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';

export interface FileRecord {
    id: number;
    file_path: string;
    current_version_id: number | null;
}

export interface VersionRecord {
    id: number;
    file_id: number;
    content: string;
    timestamp: string;
    version_number: number;
}

export async function initializeDatabase(context: vscode.ExtensionContext): Promise<Database> {
    const dbPath = path.join(context.globalStoragePath, 'file_versions.db');
    
    // Ensure the directory exists
    if (!fs.existsSync(context.globalStoragePath)) {
        fs.mkdirSync(context.globalStoragePath, { recursive: true });
    }

    // Initialize SQL.js
    const SQL = await initSqlJs();
    
    // Load existing database or create new one
    let db: Database;
    if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    // Enable foreign keys
    db.run('PRAGMA foreign_keys = ON');

    // Create tables if they don't exist
    db.run(`
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL UNIQUE,
            current_version_id INTEGER,
            FOREIGN KEY (current_version_id) REFERENCES versions(id)
        )
    `);
    
    db.run(`
        CREATE TABLE IF NOT EXISTS versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            timestamp TEXT NOT NULL DEFAULT (datetime('now')),
            version_number INTEGER NOT NULL,
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
            UNIQUE(file_id, version_number)
        )
    `);

    db.run(`
        CREATE INDEX IF NOT EXISTS idx_files_path ON files(file_path);
        CREATE INDEX IF NOT EXISTS idx_versions_file_id ON versions(file_id);
        CREATE INDEX IF NOT EXISTS idx_versions_timestamp ON versions(timestamp);
    `);

    // Save the database to disk
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));

    return db;
} 