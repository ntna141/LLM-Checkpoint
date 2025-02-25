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
        this.dbPath = path.join(context.storageUri?.fsPath || context.globalStoragePath, 'file_versions.db');
    }

    private saveToFile() {
        const data = this.db.export();
        fs.writeFileSync(this.dbPath, Buffer.from(data));
    }

    private mapFileRecord(row: any[]): FileRecord {
        return {
            id: row[0] as number,
            file_path: row[1] as string,
            current_version_id: row[2] as number | null
        };
    }

    private mapVersionRecord(row: any[]): VersionRecord {
        return {
            id: row[0] as number,
            file_id: row[1] as number,
            content: row[2] as string,
            timestamp: row[3] as string,
            version_number: row[4] as number,
            label: row[5] as string
        };
    }

    createFile(filePath: string): FileRecord {
        const stmt = this.db.prepare('INSERT INTO files (file_path) VALUES (?)');
        stmt.run([filePath]);
        const result = this.db.exec('SELECT * FROM files WHERE id = last_insert_rowid()')[0];
        this.saveToFile();
        return this.mapFileRecord(result.values[0]);
    }

    getFile(filePath: string): FileRecord | undefined {
        const result = this.db.exec('SELECT * FROM files WHERE file_path = ?', [filePath]);
        if (result.length === 0 || result[0].values.length === 0) {
            return undefined;
        }
        return this.mapFileRecord(result[0].values[0]);
    }

    getFileById(fileId: number): FileRecord | undefined {
        const result = this.db.exec('SELECT * FROM files WHERE id = ?', [fileId]);
        if (result.length === 0 || result[0].values.length === 0) {
            return undefined;
        }
        return this.mapFileRecord(result[0].values[0]);
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

        return this.mapVersionRecord(versionResult.values[0]);
    }

    getVersion(versionId: number): VersionRecord | undefined {
        const result = this.db.exec('SELECT id, file_id, content, timestamp, version_number, label FROM versions WHERE id = ?', [versionId]);
        if (!result?.[0]?.values?.[0]?.[0]) {
            return undefined;
        }
        return this.mapVersionRecord(result[0].values[0]);
    }

    getFileVersions(fileId: number, limit: number = 10): VersionRecord[] {
        const result = this.db.exec(`
            SELECT id, file_id, content, timestamp, version_number, label 
            FROM versions 
            WHERE file_id = ? 
            ORDER BY version_number DESC 
            LIMIT ?
        `, [fileId, limit]);

        if (result.length === 0) {
            return [];
        }

        return result[0].values.map(row => this.mapVersionRecord(row));
    }

    getCurrentVersion(fileId: number): VersionRecord | undefined {
        const result = this.db.exec(`
            SELECT v.id, v.file_id, v.content, v.timestamp, v.version_number, v.label 
            FROM versions v
            JOIN files f ON f.current_version_id = v.id
            WHERE f.id = ?
        `, [fileId]);

        if (result.length === 0 || result[0].values.length === 0) {
            return undefined;
        }

        return this.mapVersionRecord(result[0].values[0]);
    }

    deleteVersion(versionId: number): void {
        const stmt = this.db.prepare('DELETE FROM versions WHERE id = ?');
        stmt.run([versionId]);
        this.saveToFile();
    }

    getAllFiles(): FileRecord[] {
        const result = this.db.exec('SELECT * FROM files');
        if (result.length === 0) {
            return [];
        }

        return result[0].values.map(row => this.mapFileRecord(row));
    }

    public async getLastCommitForRepo(repoPath: string): Promise<string | null> {
        try {
            const result = this.db.exec(`
            SELECT commit_hash FROM repository_commits 
            WHERE repo_path = ? LIMIT 1
        `, [repoPath]);

            if (result.length > 0 && result[0].values.length > 0) {
                return result[0].values[0][0] as string;
            }
            return null;
        } catch (error) {
            console.error('Error getting last commit for repo:', error);
            return null;
        }
    }

    public async saveLastCommitForRepo(repoPath: string, commitHash: string): Promise<void> {
        try {
            this.db.run(`
            INSERT OR REPLACE INTO repository_commits (repo_path, commit_hash)
            VALUES (?, ?)
        `, [repoPath, commitHash]);

            this.saveToFile();
        } catch (error) {
            console.error('Error saving last commit for repo:', error);
        }
    }

    updateVersion(versionId: number, newContent: string, newLabel: string): void {
        const stmt = this.db.prepare(`
            UPDATE versions 
            SET content = ?, label = ?
            WHERE id = ?
        `);
        stmt.bind([newContent, newLabel, versionId]);
        stmt.step();
        stmt.free();
        this.saveToFile();
    }

} 