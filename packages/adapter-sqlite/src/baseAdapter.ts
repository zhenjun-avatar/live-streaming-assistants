import type { Database as BetterSqlite3Database } from "better-sqlite3";
import type {
    Account,
    Actor,
    GoalStatus,
    Participant,
    Goal,
    Memory,
    Relationship,
    UUID,
    RAGKnowledgeItem,
    ChunkRow,
} from "@elizaos/core";
import { DatabaseAdapter, elizaLogger } from "@elizaos/core";
import { v4 } from "uuid";
import { load } from "./sqlite_vec.ts";
import { sqliteTables } from "./sqliteTables.ts";

export abstract class BaseSqliteAdapter extends DatabaseAdapter<BetterSqlite3Database> {
    public db: BetterSqlite3Database;

    constructor(db: BetterSqlite3Database) {
        super();
        this.db = db;
        load(db);
    }

    async init() {
        this.db.exec(sqliteTables);
    }

    // Base implementation of getUserDatabase - will be overridden by MultiUserSqliteDatabaseAdapter
    protected async getUserDatabase(userId: string): Promise<string> {
        return "main";
    }

    // Base implementation of executeUserQuery - will be overridden by MultiUserSqliteDatabaseAdapter
    protected async executeUserQuery<T>(userId: string, callback: (dbName: string) => T): Promise<T> {
        return callback("main");
    }

    // Helper to get a default agent ID for fallback cases
    protected getDefaultAgentId(): UUID {
        return "00000000-0000-0000-0000-000000000000" as UUID;
    }

    async getRoom(roomId: UUID): Promise<UUID | null> {
        const sql = "SELECT id FROM rooms WHERE id = ?";
        const room = this.db.prepare(sql).get(roomId) as
            | { id: string }
            | undefined;
        return room ? (room.id as UUID) : null;
    }

    async getParticipantsForAccount(userId: UUID): Promise<Participant[]> {
        const sql = `
      SELECT p.id, p.userId, p.roomId, p.last_message_read
      FROM participants p
      WHERE p.userId = ?
    `;
        const rows = this.db.prepare(sql).all(userId) as Participant[];
        return rows;
    }

    async getParticipantsForRoom(roomId: UUID): Promise<UUID[]> {
        const sql = "SELECT userId FROM participants WHERE roomId = ?";
        const rows = this.db.prepare(sql).all(roomId) as { userId: string }[];
        return rows.map((row) => row.userId as UUID);
    }

    async getParticipantUserState(
        roomId: UUID,
        userId: UUID
    ): Promise<"FOLLOWED" | "MUTED" | null> {
        const stmt = this.db.prepare(
            "SELECT userState FROM participants WHERE roomId = ? AND userId = ?"
        );
        const res = stmt.get(roomId, userId) as
            | { userState: "FOLLOWED" | "MUTED" | null }
            | undefined;
        return res?.userState ?? null;
    }

    async setParticipantUserState(
        roomId: UUID,
        userId: UUID,
        state: "FOLLOWED" | "MUTED" | null
    ): Promise<void> {
        const stmt = this.db.prepare(
            "UPDATE participants SET userState = ? WHERE roomId = ? AND userId = ?"
        );
        stmt.run(state, roomId, userId);
    }

    async getAccountById(userId: UUID): Promise<Account | null> {
        const sql = "SELECT * FROM accounts WHERE id = ?";
        const account = this.db.prepare(sql).get(userId) as Account;
        if (!account) return null;
        if (account) {
            if (typeof account.details === "string") {
                account.details = JSON.parse(
                    account.details as unknown as string
                );
            }
        }
        return account;
    }

    async createAccount(account: Account): Promise<boolean> {
        try {
            const sql =
                "INSERT INTO accounts (id, name, username, email, avatarUrl, details) VALUES (?, ?, ?, ?, ?, ?)";
            this.db
                .prepare(sql)
                .run(
                    account.id ?? v4(),
                    account.name,
                    account.username,
                    account.email,
                    account.avatarUrl,
                    JSON.stringify(account.details)
                );
            return true;
        } catch (error) {
            console.log("Error creating account", error);
            return false;
        }
    }

    async getActorDetails(params: { roomId: UUID }): Promise<Actor[]> {
        const sql = `
      SELECT a.id, a.name, a.username, a.details
      FROM participants p
      LEFT JOIN accounts a ON p.userId = a.id
      WHERE p.roomId = ?
    `;
        const rows = this.db
            .prepare(sql)
            .all(params.roomId) as (Actor | null)[];

        return rows
            .map((row) => {
                if (row === null) {
                    return null;
                }
                return {
                    ...row,
                    details:
                        typeof row.details === "string"
                            ? JSON.parse(row.details)
                            : row.details,
                };
            })
            .filter((row): row is Actor => row !== null);
    }

    async getMemoriesByRoomIds(params: {
        agentId: UUID;
        roomIds: UUID[];
        tableName: string;
        limit?: number;
    }): Promise<Memory[]> {
        if (!params.tableName) {
            params.tableName = "messages";
        }

        const placeholders = params.roomIds.map(() => "?").join(", ");
        let sql = `SELECT * FROM memories WHERE type = ? AND agentId = ? AND roomId IN (${placeholders})`;

        const queryParams = [
            params.tableName,
            params.agentId,
            ...params.roomIds,
        ];

        sql += ` ORDER BY createdAt DESC`;
        if (params.limit) {
            sql += ` LIMIT ?`;
            queryParams.push(params.limit.toString());
        }

        const stmt = this.db.prepare(sql);
        const rows = stmt.all(...queryParams) as (Memory & {
            content: string;
        })[];

        return rows.map((row) => ({
            ...row,
            content: JSON.parse(row.content),
        }));
    }

    async getMemoryById(memoryId: UUID): Promise<Memory | null> {
        const sql = "SELECT * FROM memories WHERE id = ?";
        const stmt = this.db.prepare(sql);
        stmt.bind([memoryId]);
        const memory = stmt.get() as Memory | undefined;

        if (memory) {
            return {
                ...memory,
                content: JSON.parse(memory.content as unknown as string),
            };
        }

        return null;
    }

    async getMemoriesByIds(
        memoryIds: UUID[],
        tableName?: string
    ): Promise<Memory[]> {
        if (memoryIds.length === 0) return [];
        const queryParams: any[] = [];
        const placeholders = memoryIds.map(() => "?").join(",");
        let sql = `SELECT * FROM memories WHERE id IN (${placeholders})`;
        queryParams.push(...memoryIds);

        if (tableName) {
            sql += ` AND type = ?`;
            queryParams.push(tableName);
        }

        const memories = this.db.prepare(sql).all(...queryParams) as Memory[];

        return memories.map((memory) => ({
            ...memory,
            createdAt:
                typeof memory.createdAt === "string"
                    ? Date.parse(memory.createdAt as string)
                    : memory.createdAt,
            content: JSON.parse(memory.content as unknown as string),
        }));
    }

    async createMemory(memory: Memory, tableName: string): Promise<void> {
        let isUnique = true;

        if (memory.embedding) {
            const similarMemories = await this.searchMemoriesByEmbedding(
                memory.embedding,
                {
                    tableName,
                    agentId: memory.agentId,
                    roomId: memory.roomId,
                    match_threshold: 0.95,
                    count: 1,
                }
            );

            isUnique = similarMemories.length === 0;
        }

        const content = JSON.stringify(memory.content);
        const createdAt = memory.createdAt ?? Date.now();

        let embeddingValue: Float32Array = new Float32Array(384);
        if (memory?.embedding && memory?.embedding?.length > 0) {
            embeddingValue = new Float32Array(memory.embedding);
        }

        const sql = `INSERT OR REPLACE INTO memories (id, type, content, embedding, userId, roomId, agentId, \`unique\`, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        this.db
            .prepare(sql)
            .run(
                memory.id ?? v4(),
                tableName,
                content,
                embeddingValue,
                memory.userId,
                memory.roomId,
                memory.agentId,
                isUnique ? 1 : 0,
                createdAt
            );
    }

    async searchMemories(params: {
        tableName: string;
        roomId: UUID;
        agentId: UUID;
        embedding: number[];
        match_threshold: number;
        match_count: number;
        unique: boolean;
    }): Promise<Memory[]> {
        try {
            const queryParams = [
                new Float32Array(params.embedding),
                params.tableName,
                params.roomId,
            ];

            let sql = `
                SELECT *, vec_distance_L2(embedding, ?) AS similarity
                FROM memories
                WHERE type = ?
                AND roomId = ?`;

            if (params.unique) {
                sql += ' AND "unique" = 1';
            }

            if (params.agentId) {
                sql += " AND agentId = ?";
                queryParams.push(params.agentId);
            }
            sql += ` ORDER BY similarity ASC LIMIT ?`;
            queryParams.push(params.match_count.toString());

            const memories = this.db.prepare(sql).all(...queryParams) as (Memory & {
                similarity: number;
            })[];

            return memories.map((memory) => ({
                ...memory,
                createdAt:
                    typeof memory.createdAt === "string"
                        ? Date.parse(memory.createdAt as string)
                        : memory.createdAt,
                content: JSON.parse(memory.content as unknown as string),
            }));
        } catch (error: any) {
            if (error.message && error.message.includes("no such function: vec_distance_L2")) {
                elizaLogger.warn("VSS module not available, using basic query");
                
                const fallbackSql = `
                    SELECT *
                    FROM memories
                    WHERE type = ? 
                    AND roomId = ?
                    ${params.agentId ? "AND agentId = ?" : ""}
                    ${params.unique ? 'AND "unique" = 1' : ""}
                    ORDER BY createdAt DESC
                    LIMIT ?
                `;
                
                const fallbackParams = [
                    params.tableName,
                    params.roomId
                ];
                
                if (params.agentId) {
                    fallbackParams.push(params.agentId);
                }
                
                fallbackParams.push(params.match_count.toString());
                
                const memories = this.db.prepare(fallbackSql).all(...fallbackParams) as Memory[];
                
                return memories.map((memory) => ({
                    ...memory,
                    createdAt:
                        typeof memory.createdAt === "string"
                            ? Date.parse(memory.createdAt as string)
                            : memory.createdAt,
                    content: JSON.parse(memory.content as unknown as string),
                }));
            }
            
            throw error;
        }
    }

    async searchMemoriesByEmbedding(
        embedding: number[],
        params: {
            match_threshold?: number;
            count?: number;
            roomId?: UUID;
            agentId: UUID;
            unique?: boolean;
            tableName: string;
        }
    ): Promise<Memory[]> {
        try {
            const queryParams = [
                new Float32Array(embedding),
                params.tableName,
                params.agentId,
            ];

            let sql = `
                SELECT *, vec_distance_L2(embedding, ?) AS similarity
                FROM memories
                WHERE embedding IS NOT NULL AND type = ? AND agentId = ?`;

            if (params.unique) {
                sql += ' AND "unique" = 1';
            }

            if (params.roomId) {
                sql += " AND roomId = ?";
                queryParams.push(params.roomId);
            }
            sql += ` ORDER BY similarity DESC`;

            if (params.count) {
                sql += " LIMIT ?";
                queryParams.push(params.count.toString());
            }

            const memories = this.db.prepare(sql).all(...queryParams) as (Memory & {
                similarity: number;
            })[];
            
            return memories.map((memory) => ({
                ...memory,
                createdAt:
                    typeof memory.createdAt === "string"
                        ? Date.parse(memory.createdAt as string)
                        : memory.createdAt,
                content: JSON.parse(memory.content as unknown as string),
            }));
        } catch (error: any) {
            if (error.message && error.message.includes("no such function: vec_distance_L2")) {
                elizaLogger.warn("VSS module not available, using basic query");
                
                const fallbackSql = `
                    SELECT *
                    FROM memories
                    WHERE embedding IS NOT NULL 
                    AND type = ? 
                    AND agentId = ?
                    ${params.roomId ? "AND roomId = ?" : ""}
                    ${params.unique ? 'AND "unique" = 1' : ""}
                    ORDER BY createdAt DESC
                    LIMIT ?
                `;
                
                const fallbackParams = [
                    params.tableName,
                    params.agentId
                ] as any[];
                
                if (params.roomId) {
                    fallbackParams.push(params.roomId);
                }
                
                fallbackParams.push((params.count || 10).toString());
                
                const memories = this.db.prepare(fallbackSql).all(...fallbackParams) as Memory[];
                
                return memories.map((memory) => ({
                    ...memory,
                    createdAt:
                        typeof memory.createdAt === "string"
                            ? Date.parse(memory.createdAt as string)
                            : memory.createdAt,
                    content: JSON.parse(memory.content as unknown as string),
                }));
            }
            
            throw error;
        }
    }

    async getMemories(params: {
        roomId: UUID;
        count?: number;
        unique?: boolean;
        tableName: string;
        agentId: UUID;
        start?: number;
        end?: number;
    }): Promise<Memory[]> {
        if (!params.tableName) {
            throw new Error("tableName is required");
        }
        if (!params.roomId) {
            throw new Error("roomId is required");
        }
        let sql = `SELECT * FROM memories WHERE type = ? AND agentId = ? AND roomId = ?`;

        const queryParams = [
            params.tableName,
            params.agentId,
            params.roomId,
        ] as any[];

        if (params.unique) {
            sql += ' AND "unique" = 1';
        }

        if (params.start) {
            sql += ` AND createdAt >= ?`;
            queryParams.push(params.start);
        }

        if (params.end) {
            sql += ` AND createdAt <= ?`;
            queryParams.push(params.end);
        }

        sql += " ORDER BY createdAt DESC";

        if (params.count) {
            sql += " LIMIT ?";
            queryParams.push(params.count);
        }

        const memories = this.db.prepare(sql).all(...queryParams) as Memory[];

        return memories.map((memory) => ({
            ...memory,
            createdAt:
                typeof memory.createdAt === "string"
                    ? Date.parse(memory.createdAt as string)
                    : memory.createdAt,
            content: JSON.parse(memory.content as unknown as string),
        }));
    }

    async countMemories(
        roomId: UUID,
        unique = true,
        tableName = ""
    ): Promise<number> {
        if (!tableName) {
            throw new Error("tableName is required");
        }

        let sql = `SELECT COUNT(*) as count FROM memories WHERE type = ? AND roomId = ?`;
        const queryParams = [tableName, roomId] as string[];

        if (unique) {
            sql += ' AND "unique" = 1';
        }

        return (this.db.prepare(sql).get(...queryParams) as { count: number }).count;
    }

    async removeKnowledge(id: UUID): Promise<void> {
        if (typeof id !== "string") {
            throw new Error("Knowledge ID must be a string");
        }

        try {
            this.db.transaction(() => {
                if (id.includes("*")) {
                    const pattern = id.replace("*", "%");
                    const sql = `DELETE FROM knowledge WHERE id LIKE ?`;
                    elizaLogger.debug(
                        `[Knowledge Remove] Executing SQL: ${sql} with pattern: ${pattern}`
                    );
                    const stmt = this.db.prepare(sql);
                    const result = stmt.run(pattern);
                    elizaLogger.debug(
                        `[Knowledge Remove] Pattern deletion affected ${result.changes} rows`
                    );
                    return result.changes;
                } else {
                    const selectSql = `SELECT id FROM knowledge WHERE id = ?`;
                    const chunkSql = `SELECT id FROM knowledge WHERE json_extract(content, '$.metadata.originalId') = ?`;

                    const mainEntry = this.db.prepare(selectSql).get(id) as ChunkRow | undefined;
                    const chunks = this.db.prepare(chunkSql).all(id) as ChunkRow[];

                    elizaLogger.debug(`[Knowledge Remove] Found:`, {
                        mainEntryExists: !!mainEntry?.id,
                        chunkCount: chunks.length
                    });

                    const chunkDeleteSql = `DELETE FROM knowledge WHERE json_extract(content, '$.metadata.originalId') = ?`;
                    const chunkResult = this.db.prepare(chunkDeleteSql).run(id);

                    const mainDeleteSql = `DELETE FROM knowledge WHERE id = ?`;
                    const mainResult = this.db.prepare(mainDeleteSql).run(id);

                    return chunkResult.changes + mainResult.changes;
                }
            })();
        } catch (error) {
            elizaLogger.error("[Knowledge Remove] Error:", {
                id,
                error: error instanceof Error
                    ? { message: error.message, stack: error.stack, name: error.name }
                    : error,
            });
            throw error;
        }
    }

    async clearKnowledge(agentId: UUID, shared?: boolean): Promise<void> {
        const sql = shared
            ? `DELETE FROM knowledge WHERE (agentId = ? OR isShared = 1)`
            : `DELETE FROM knowledge WHERE agentId = ?`;
        try {
            this.db.prepare(sql).run(agentId);
        } catch (error) {
            elizaLogger.error(
                `Error clearing knowledge for agent ${agentId}:`,
                error
            );
            throw error;
        }
    }

    async close(): Promise<void> {
        if (this.db) {
            this.db.close();
        }
    }

    // ... Add all other shared methods here ...
} 