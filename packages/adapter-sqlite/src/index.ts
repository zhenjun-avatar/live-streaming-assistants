import path from "path";
import fs from "fs";

export * from "./sqliteTables.ts";
export * from "./sqlite_vec.ts";
export * from "./multiUserAdapter.ts";
export * from "./baseAdapter.ts";

import {
    elizaLogger,
    type IDatabaseCacheAdapter,
    type UUID,
    validateUuid,
} from "@elizaos/core";
import type {
    Account,
    Actor,
    GoalStatus,
    Participant,
    Goal,
    Memory,
    Relationship,
    RAGKnowledgeItem,
    ChunkRow,
    Adapter,
    IAgentRuntime,
    Plugin,
} from "@elizaos/core";
import type { Database as BetterSqlite3Database } from "better-sqlite3";
import { v4 } from "uuid";
import { load } from "./sqlite_vec.ts";
import { sqliteTables } from "./sqliteTables.ts";
import { MultiUserSqliteDatabaseAdapter } from "./multiUserAdapter.ts";
import { BaseSqliteAdapter } from "./baseAdapter.ts";

import Database from "better-sqlite3";

// Helper function to generate valid UUID
function generateUUID(): UUID {
    const uuid = validateUuid(v4());
    if (!uuid) {
        throw new Error("Failed to generate valid UUID");
    }
    return uuid;
}

// Default UUID constant
const DEFAULT_AGENT_ID = "00000000-0000-0000-0000-000000000000" as const;
type DefaultUUID = typeof DEFAULT_AGENT_ID & UUID;
const DEFAULT_UUID: DefaultUUID = DEFAULT_AGENT_ID as DefaultUUID;

// 将applyMultiUserPatches函数移动到这里，在sqliteDatabaseAdapter定义之前
export function applyMultiUserPatches(runtime: IAgentRuntime): void {
    // 检查是否开启了多用户模式
    const isMultiUserMode = runtime.getSetting("SQLITE_MULTI_USER") === "true";
    if (!isMultiUserMode) {
        elizaLogger.debug("Multi-user mode not enabled, skipping patches");
        return;
    }
    
    // 检查是否是MultiUserSqliteDatabaseAdapter实例
    const db = runtime.databaseAdapter;
    if (!(db instanceof MultiUserSqliteDatabaseAdapter)) {
        elizaLogger.warn("Multi-user mode enabled but not using MultiUserSqliteDatabaseAdapter");
        return;
    }
    
    // 设置默认用户ID如果没有设置
    if (!runtime.currentUserId) {
        const defaultUserId = "default-user-id";
        runtime.setCurrentUserId(defaultUserId as UUID);
        elizaLogger.debug(`Set default user ID: ${defaultUserId}`);
    }
    
    // 确保用户存在
    (async () => {
        if (!runtime.currentUserId) {
            elizaLogger.error("No current user ID set, cannot initialize user");
            return;
        }
        
        try {
            const multiUserAdapter = db as MultiUserSqliteDatabaseAdapter;
            await multiUserAdapter.initUser(runtime.currentUserId);
            elizaLogger.debug(`User ${runtime.currentUserId} initialized`);
        } catch (error) {
            elizaLogger.error(`Failed to initialize user ${runtime.currentUserId}:`, error);
        }
    })();
}

export class SqliteDatabaseAdapter extends BaseSqliteAdapter implements IDatabaseCacheAdapter {
    private userDatabases: Map<string, string>;

    constructor(db: BetterSqlite3Database) {
        super(db);
        this.userDatabases = new Map();
    }

    // User management methods
    async createUser(user: { id: UUID; username: string }): Promise<boolean> {
        try {
            // Add user to the users table
            const sql = "INSERT INTO users (id, username) VALUES (?, ?)";
            this.db.prepare(sql).run(user.id, user.username);
            
            // Initialize the user's database
            await this.getUserDatabase(user.id);
            return true;
        } catch (error) {
            elizaLogger.error("Error creating user", error);
            return false;
        }
    }

    async getUserByUsername(username: string): Promise<{ id: UUID; username: string } | null> {
        try {
            const sql = "SELECT id, username FROM users WHERE username = ?";
            return this.db.prepare(sql).get(username) as { id: UUID; username: string } | null;
        } catch (error) {
            elizaLogger.error("Error getting user by username", error);
            return null;
        }
    }

    async listUsers(): Promise<{ id: UUID; username: string }[]> {
        try {
            const sql = "SELECT id, username FROM users";
            return this.db.prepare(sql).all() as { id: UUID; username: string }[];
        } catch (error) {
            elizaLogger.error("Error listing users", error);
            return [];
        }
    }

    // Cache methods
    async getCache(params: {
        key: string;
        agentId: UUID;
    }): Promise<string | undefined> {
        const sql = "SELECT value FROM cache WHERE (key = ? AND agentId = ?)";
        const cached = this.db
            .prepare<[string, UUID], { value: string }>(sql)
            .get(params.key, params.agentId);

        return cached?.value ?? undefined;
    }

    async setCache(params: {
        key: string;
        agentId: UUID;
        value: string;
    }): Promise<boolean> {
        const sql =
            "INSERT OR REPLACE INTO cache (key, agentId, value, createdAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP)";
        this.db.prepare(sql).run(params.key, params.agentId, params.value);
        return true;
    }

    async deleteCache(params: {
        key: string;
        agentId: UUID;
    }): Promise<boolean> {
        try {
            const sql = "DELETE FROM cache WHERE key = ? AND agentId = ?";
            this.db.prepare(sql).run(params.key, params.agentId);
            return true;
        } catch (error) {
            console.log("Error removing cache", error);
            return false;
        }
    }

    // Required implementations from BaseSqliteAdapter
    protected async getUserDatabase(userId: string): Promise<string> {
        return "main";
    }

    protected async executeUserQuery<T>(userId: string, callback: (dbName: string) => T): Promise<T> {
        return callback("main");
    }

    async getCachedEmbeddings(opts: {
        query_table_name: string;
        query_threshold: number;
        query_input: string;
        query_field_name: string;
        query_field_sub_name: string;
        query_match_count: number;
    }): Promise<{ embedding: number[]; levenshtein_score: number }[]> {
        const sql = `
            WITH content_text AS (
                SELECT
                    embedding,
                    json_extract(
                        json(content),
                        '$.' || ? || '.' || ?
                    ) as content_text
                FROM memories
                WHERE type = ?
                AND json_extract(
                    json(content),
                    '$.' || ? || '.' || ?
                ) IS NOT NULL
            )
            SELECT
                embedding,
                length(?) + length(content_text) - (
                    length(?) + length(content_text) - (
                        length(replace(lower(?), lower(content_text), '')) +
                        length(replace(lower(content_text), lower(?), ''))
                    ) / 2
                ) as levenshtein_score
            FROM content_text
            ORDER BY levenshtein_score ASC
            LIMIT ?
        `;

        const rows = this.db
            .prepare(sql)
            .all(
                opts.query_field_name,
                opts.query_field_sub_name,
                opts.query_table_name,
                opts.query_field_name,
                opts.query_field_sub_name,
                opts.query_input,
                opts.query_input,
                opts.query_input,
                opts.query_input,
                opts.query_match_count
            ) as { embedding: Buffer; levenshtein_score: number }[];

        return rows.map((row) => ({
            embedding: Array.from(new Float32Array(row.embedding as Buffer)),
            levenshtein_score: row.levenshtein_score,
        }));
    }

    async log(params: {
        body: { [key: string]: unknown };
        userId: UUID;
        roomId: UUID;
        type: string;
    }): Promise<void> {
        const sql =
            "INSERT INTO logs (body, userId, roomId, type) VALUES (?, ?, ?, ?)";
        this.db
            .prepare(sql)
            .run(
                JSON.stringify(params.body),
                params.userId,
                params.roomId,
                params.type
            );
    }

    async updateGoalStatus(params: {
        goalId: UUID;
        status: GoalStatus;
    }): Promise<void> {
        const sql = "UPDATE goals SET status = ? WHERE id = ?";
        this.db.prepare(sql).run(params.status, params.goalId);
    }

    async removeMemory(memoryId: UUID, tableName: string): Promise<void> {
        const sql = `DELETE FROM memories WHERE type = ? AND id = ?`;
        this.db.prepare(sql).run(tableName, memoryId);
    }

    async removeAllMemories(roomId: UUID, tableName: string): Promise<void> {
        const sql = `DELETE FROM memories WHERE type = ? AND roomId = ?`;
        this.db.prepare(sql).run(tableName, roomId);
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
            sql += " AND `unique` = 1";
        }

        return (this.db.prepare(sql).get(...queryParams) as { count: number })
            .count;
    }

    async getGoals(params: {
        roomId: UUID;
        userId?: UUID | null;
        onlyInProgress?: boolean;
        count?: number;
    }): Promise<Goal[]> {
        let sql = "SELECT * FROM goals WHERE roomId = ?";
        const queryParams: (UUID | number)[] = [params.roomId];

        if (params.userId) {
            sql += " AND userId = ?";
            queryParams.push(params.userId);
        }

        if (params.onlyInProgress) {
            sql += " AND status = 'IN_PROGRESS'";
        }

        if (params.count) {
            sql += " LIMIT ?";
            queryParams.push(params.count);
        }

        const goals = this.db.prepare(sql).all(...queryParams) as Goal[];
        return goals.map((goal) => ({
            ...goal,
            objectives:
                typeof goal.objectives === "string"
                    ? JSON.parse(goal.objectives)
                    : goal.objectives,
        }));
    }

    async updateGoal(goal: Goal): Promise<void> {
        const sql =
            "UPDATE goals SET name = ?, status = ?, objectives = ? WHERE id = ?";
        this.db
            .prepare(sql)
            .run(
                goal.name,
                goal.status,
                JSON.stringify(goal.objectives),
                goal.id
            );
    }

    async createGoal(goal: Goal): Promise<void> {
        const sql =
            "INSERT INTO goals (id, roomId, userId, name, status, objectives) VALUES (?, ?, ?, ?, ?, ?)";
        this.db
            .prepare(sql)
            .run(
                goal.id ?? generateUUID(),
                goal.roomId,
                goal.userId,
                goal.name,
                goal.status,
                JSON.stringify(goal.objectives)
            );
    }

    async removeGoal(goalId: UUID): Promise<void> {
        const sql = "DELETE FROM goals WHERE id = ?";
        this.db.prepare(sql).run(goalId);
    }

    async removeAllGoals(roomId: UUID): Promise<void> {
        const sql = "DELETE FROM goals WHERE roomId = ?";
        this.db.prepare(sql).run(roomId);
    }

    async createRoom(roomId?: UUID): Promise<UUID> {
        roomId = roomId || generateUUID();
        try {
            const sql = "INSERT INTO rooms (id) VALUES (?)";
            this.db.prepare(sql).run(roomId);
        } catch (error) {
            console.log("Error creating room", error);
        }
        return roomId;
    }

    async removeRoom(roomId: UUID): Promise<void> {
        const sql = "DELETE FROM rooms WHERE id = ?";
        this.db.prepare(sql).run(roomId);
    }

    async getRoomsForParticipant(userId: UUID): Promise<UUID[]> {
        const sql = "SELECT roomId FROM participants WHERE userId = ?";
        const rows = this.db.prepare(sql).all(userId) as { roomId: string }[];
        return rows.map((row) => row.roomId as UUID);
    }

    async getRoomsForParticipants(userIds: UUID[]): Promise<UUID[]> {
        const placeholders = userIds.map(() => "?").join(", ");
        const sql = `SELECT DISTINCT roomId FROM participants WHERE userId IN (${placeholders})`;
        const rows = this.db.prepare(sql).all(...userIds) as {
            roomId: string;
        }[];
        return rows.map((row) => row.roomId as UUID);
    }

    async addParticipant(userId: UUID, roomId: UUID): Promise<boolean> {
        try {
            const sql =
                "INSERT INTO participants (id, userId, roomId) VALUES (?, ?, ?)";
            this.db.prepare(sql).run(generateUUID(), userId, roomId);
            return true;
        } catch (error) {
            console.log("Error adding participant", error);
            return false;
        }
    }

    async removeParticipant(userId: UUID, roomId: UUID): Promise<boolean> {
        try {
            const sql =
                "DELETE FROM participants WHERE userId = ? AND roomId = ?";
            this.db.prepare(sql).run(userId, roomId);
            return true;
        } catch (error) {
            console.log("Error removing participant", error);
            return false;
        }
    }

    async createRelationship(params: {
        userA: UUID;
        userB: UUID;
    }): Promise<boolean> {
        if (!params.userA || !params.userB) {
            throw new Error("userA and userB are required");
        }
        const sql =
            "INSERT INTO relationships (id, userA, userB, userId) VALUES (?, ?, ?, ?)";
        this.db
            .prepare(sql)
            .run(generateUUID(), params.userA, params.userB, params.userA);
        return true;
    }

    async getRelationship(params: {
        userA: UUID;
        userB: UUID;
    }): Promise<Relationship | null> {
        const sql =
            "SELECT * FROM relationships WHERE (userA = ? AND userB = ?) OR (userA = ? AND userB = ?)";
        return (
            (this.db
                .prepare(sql)
                .get(
                    params.userA,
                    params.userB,
                    params.userB,
                    params.userA
                ) as Relationship) || null
        );
    }

    async getRelationships(params: { userId: UUID }): Promise<Relationship[]> {
        const sql =
            "SELECT * FROM relationships WHERE (userA = ? OR userB = ?)";
        return this.db
            .prepare(sql)
            .all(params.userId, params.userId) as Relationship[];
    }

    // Helper to get a default agent ID for fallback cases
    protected getDefaultAgentId(): UUID {
        return v4() as UUID;
    }

    async getKnowledge(params: {
        id?: UUID;
        agentId: UUID;
        limit?: number;
        query?: string;
    }): Promise<RAGKnowledgeItem[]> {
        let sql = `SELECT * FROM knowledge WHERE (agentId = ? OR isShared = 1)`;
        const queryParams: any[] = [params.agentId];

        if (params.id) {
            sql += ` AND id = ?`;
            queryParams.push(params.id);
        }

        if (params.limit) {
            sql += ` LIMIT ?`;
            queryParams.push(params.limit);
        }

        interface KnowledgeRow {
            id: UUID;
            agentId: UUID;
            content: string;
            embedding: Buffer | null;
            createdAt: string | number;
        }

        const rows = this.db.prepare(sql).all(...queryParams) as KnowledgeRow[];

        return rows.map((row) => ({
            id: row.id,
            agentId: row.agentId,
            content: JSON.parse(row.content),
            embedding: row.embedding
                ? new Float32Array(row.embedding)
                : undefined,
            createdAt:
                typeof row.createdAt === "string"
                    ? Date.parse(row.createdAt)
                    : row.createdAt,
        }));
    }

    async searchKnowledge(params: {
        agentId: UUID;
        embedding: Float32Array;
        match_threshold: number;
        match_count: number;
        searchText?: string;
        userId?: UUID;
    }): Promise<RAGKnowledgeItem[]> {
        const cacheKey = `embedding_${params.agentId}_${params.searchText}`;
        const cachedResult = await this.getCache({
            key: cacheKey,
            agentId: params.agentId,
        });

        if (cachedResult) {
            return JSON.parse(cachedResult);
        }

        interface KnowledgeSearchRow {
            id: UUID;
            agentId: UUID;
            content: string;
            embedding: Buffer | null;
            createdAt: string | number;
            vector_score: number;
            keyword_score: number;
            combined_score: number;
        }

        const sql = `
            WITH vector_scores AS (
                SELECT id,
                        1 / (1 + vec_distance_L2(embedding, ?)) as vector_score
                FROM knowledge
                WHERE (agentId IS NULL AND isShared = 1) OR agentId = ?
                AND embedding IS NOT NULL
            ),
            keyword_matches AS (
                SELECT id,
                CASE
                    WHEN lower(json_extract(content, '$.text')) LIKE ? THEN 3.0
                    ELSE 1.0
                END *
                CASE
                    WHEN json_extract(content, '$.metadata.isChunk') = 1 THEN 1.5
                    WHEN json_extract(content, '$.metadata.isMain') = 1 THEN 1.2
                    ELSE 1.0
                END as keyword_score
                FROM knowledge
                WHERE (agentId IS NULL AND isShared = 1) OR agentId = ?
            )
            SELECT k.*,
                v.vector_score,
                kw.keyword_score,
                (v.vector_score * kw.keyword_score) as combined_score
            FROM knowledge k
            JOIN vector_scores v ON k.id = v.id
            LEFT JOIN keyword_matches kw ON k.id = kw.id
            WHERE (k.agentId IS NULL AND k.isShared = 1) OR k.agentId = ?
            AND (
                v.vector_score >= ?  -- Using match_threshold parameter
                OR (kw.keyword_score > 1.0 AND v.vector_score >= 0.3)
            )
            ORDER BY combined_score DESC
            LIMIT ?
        `;

        const searchParams = [
            params.embedding,
            params.agentId,
            `%${params.searchText?.toLowerCase() || ""}%`,
            params.agentId,
            params.agentId,
            params.match_threshold,
            params.match_count,
        ];

        try {
            const rows = this.db.prepare(sql).all(...searchParams) as KnowledgeSearchRow[];
            const results = rows.map((row) => ({
                id: row.id,
                agentId: row.agentId,
                content: JSON.parse(row.content),
                embedding: row.embedding ? new Float32Array(row.embedding) : undefined,
                createdAt: typeof row.createdAt === "string" ? Date.parse(row.createdAt) : row.createdAt,
                similarity: row.combined_score,
            }));

            // Cache results
            await this.setCache({
                key: cacheKey,
                agentId: params.agentId,
                value: JSON.stringify(results),
            });

            return results;
        } catch (error: any) {
            // Handle VSS module unavailability
            if (error.message && error.message.includes("no such function: vec_distance_L2")) {
                elizaLogger.warn(`[Knowledge Search] VSS module not available, using basic search`);
                
                // Use text search instead of vector search
                const fallbackSql = `
                    SELECT * FROM knowledge
                    WHERE (agentId = ? OR isShared = 1)
                    ${params.searchText ? "AND json_extract(content, '$.text') LIKE ?" : ""}
                    ORDER BY 
                        CASE 
                            WHEN json_extract(content, '$.metadata.isMain') = 1 THEN 2
                            ELSE 1
                        END DESC,
                        createdAt DESC
                    LIMIT ?
                `;
                
                const fallbackParams = [params.agentId] as any[];
                
                if (params.searchText) {
                    fallbackParams.push(`%${params.searchText.toLowerCase()}%`);
                }
                
                fallbackParams.push(params.match_count.toString());
                
                const rows = this.db.prepare(fallbackSql).all(...fallbackParams) as {
                    id: UUID;
                    agentId: UUID;
                    content: string;
                    embedding: Buffer | null;
                    createdAt: string | number;
                }[];
                
                const results = rows.map((row) => ({
                    id: row.id,
                    agentId: row.agentId,
                    content: JSON.parse(row.content),
                    embedding: row.embedding ? new Float32Array(row.embedding) : undefined,
                    createdAt: typeof row.createdAt === "string" ? Date.parse(row.createdAt) : row.createdAt,
                }));
                
                // Cache results
                await this.setCache({
                    key: cacheKey,
                    agentId: params.agentId,
                    value: JSON.stringify(results),
                });
                
                return results;
            }
            
            // Re-throw other errors
            elizaLogger.error(`[Knowledge Search] Error:`, error);
            return [];
        }
    }

    async createKnowledge(knowledge: RAGKnowledgeItem): Promise<void> {
        try {
            this.db.transaction(() => {
                const sql = `
                    INSERT INTO knowledge (
                    id, agentId, content, embedding, createdAt,
                    isMain, originalId, chunkIndex, isShared
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                const embeddingArray = knowledge.embedding || null;

                const metadata = knowledge.content.metadata || {};
                const isShared = metadata.isShared ? 1 : 0;

                this.db
                    .prepare(sql)
                    .run(
                        knowledge.id,
                        metadata.isShared ? null : knowledge.agentId,
                        JSON.stringify(knowledge.content),
                        embeddingArray,
                        knowledge.createdAt || Date.now(),
                        metadata.isMain ? 1 : 0,
                        metadata.originalId || null,
                        metadata.chunkIndex || null,
                        isShared
                    );
            })();
        } catch (error: any) {
            const isShared = knowledge.content.metadata?.isShared;
            const isPrimaryKeyError =
                error?.code === "SQLITE_CONSTRAINT_PRIMARYKEY";

            if (isShared && isPrimaryKeyError) {
                elizaLogger.info(
                    `Shared knowledge ${knowledge.id} already exists, skipping`
                );
                return;
            } else if (
                !isShared &&
                !error.message?.includes("SQLITE_CONSTRAINT_PRIMARYKEY")
            ) {
                elizaLogger.error(`Error creating knowledge ${knowledge.id}:`, {
                    error,
                    embeddingLength: knowledge.embedding?.length,
                    content: knowledge.content,
                });
                throw error;
            }

            elizaLogger.debug(
                `Knowledge ${knowledge.id} already exists, skipping`
            );
        }
    }
}

const sqliteDatabaseAdapter: Adapter = {
    init: (runtime: IAgentRuntime) => {
        const dataDir = path.join(process.cwd(), "data");

        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        const filePath = runtime.getSetting("SQLITE_FILE") ?? path.resolve(dataDir, "db.sqlite");
        const multiUserMode = runtime.getSetting("SQLITE_MULTI_USER") === "true";
        
        elizaLogger.info(`Initializing SQLite database at ${filePath}... (Multi-user mode: ${multiUserMode})`);
        
        const db = new Database(filePath);
        
        let adapter;
        if (multiUserMode) {
            adapter = new MultiUserSqliteDatabaseAdapter(db, { dataDir });
        } else {
            adapter = new SqliteDatabaseAdapter(db);
        }

        // Test the connection
        adapter.init()
            .then(() => {
                elizaLogger.success(
                    `Successfully connected to SQLite database (${multiUserMode ? 'multi-user' : 'single-user'} mode)`
                );
                
                // 应用多用户模式相关的修补
                if (multiUserMode) {
                    applyMultiUserPatches(runtime);
                }
            })
            .catch((error) => {
                elizaLogger.error("Failed to connect to SQLite:", error);
            });

        return adapter;
    },
};

const sqlitePlugin: Plugin = {
    name: "sqlite",
    description: "SQLite database adapter plugin",
    adapters: [sqliteDatabaseAdapter],
};
export default sqlitePlugin;