import { Database } from 'sql.js';
import { FileRecord, VersionRecord } from './schema';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export class FileVersionDB {
    private db: Database;
    private dbPath: string;

    constructor(db: Database, context: vscode.ExtensionContext) {
        this.db = db;
        this.dbPath = path.join(context.globalStoragePath, 'file_versions.db');
    }

    private saveToFile() {
        const data = this.db.export();
        fs.writeFileSync(this.dbPath, Buffer.from(data));
    }

    createFile(filePath: string): FileRecord {
        const stmt = this.db.prepare('INSERT INTO files (file_path) VALUES (?)');
        stmt.run([filePath]);
        const result = this.db.exec('SELECT * FROM files WHERE id = last_insert_rowid()')[0];
        this.saveToFile();
        return {
            id: result.values[0][0] as number,
            file_path: result.values[0][1] as string,
            current_version_id: result.values[0][2] as number | null
        };
    }

    getFile(filePath: string): FileRecord | undefined {
        const result = this.db.exec('SELECT * FROM files WHERE file_path = ?', [filePath]);
        if (result.length === 0 || result[0].values.length === 0) {
            return undefined;
        }
        return {
            id: result[0].values[0][0] as number,
            file_path: result[0].values[0][1] as string,
            current_version_id: result[0].values[0][2] as number | null
        };
    }

    getFileById(fileId: number): FileRecord | undefined {
        const result = this.db.exec('SELECT * FROM files WHERE id = ?', [fileId]);
        if (result.length === 0 || result[0].values.length === 0) {
            return undefined;
        }
        return {
            id: result[0].values[0][0] as number,
            file_path: result[0].values[0][1] as string,
            current_version_id: result[0].values[0][2] as number | null
        };
    }

    createVersion(fileId: number, content: string): VersionRecord {
        
        const maxVersionResult = this.db.exec(
            'SELECT COALESCE(MAX(version_number), 0) as max_version FROM versions WHERE file_id = ?',
            [fileId]
        );
        const maxVersion = maxVersionResult[0].values[0][0] as number;
        const nextVersion = maxVersion + 1;

        
        const stmt = this.db.prepare(`
            INSERT INTO versions (file_id, content, version_number)
            VALUES (?, ?, ?)
        `);
        stmt.run([fileId, content, nextVersion]);

        
        const versionResult = this.db.exec('SELECT * FROM versions WHERE id = last_insert_rowid()')[0];
        
        
        const updateStmt = this.db.prepare(`
            UPDATE files
            SET current_version_id = last_insert_rowid()
            WHERE id = ?
        `);
        updateStmt.run([fileId]);
        
        this.saveToFile();

        return {
            id: versionResult.values[0][0] as number,
            file_id: versionResult.values[0][1] as number,
            content: versionResult.values[0][2] as string,
            timestamp: versionResult.values[0][3] as string,
            version_number: versionResult.values[0][4] as number
        };
    }

    getVersion(versionId: number): VersionRecord | undefined {
        const result = this.db.exec('SELECT * FROM versions WHERE id = ?', [versionId]);
        if (result.length === 0 || result[0].values.length === 0) {
            return undefined;
        }
        return {
            id: result[0].values[0][0] as number,
            file_id: result[0].values[0][1] as number,
            content: result[0].values[0][2] as string,
            timestamp: result[0].values[0][3] as string,
            version_number: result[0].values[0][4] as number
        };
    }

    getFileVersions(fileId: number, limit: number = 10): VersionRecord[] {
        const result = this.db.exec(`
            SELECT * FROM versions 
            WHERE file_id = ? 
            ORDER BY version_number DESC 
            LIMIT ?
        `, [fileId, limit]);

        if (result.length === 0) {
            return [];
        }

        return result[0].values.map(row => ({
            id: row[0] as number,
            file_id: row[1] as number,
            content: row[2] as string,
            timestamp: row[3] as string,
            version_number: row[4] as number
        }));
    }

    getCurrentVersion(fileId: number): VersionRecord | undefined {
        const result = this.db.exec(`
            SELECT v.* FROM versions v
            JOIN files f ON f.current_version_id = v.id
            WHERE f.id = ?
        `, [fileId]);

        if (result.length === 0 || result[0].values.length === 0) {
            return undefined;
        }

        return {
            id: result[0].values[0][0] as number,
            file_id: result[0].values[0][1] as number,
            content: result[0].values[0][2] as string,
            timestamp: result[0].values[0][3] as string,
            version_number: result[0].values[0][4] as number
        };
    }
} 