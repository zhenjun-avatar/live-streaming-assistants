import type { UUID, Memory, RAGKnowledgeItem, ChunkRow, Goal, GoalStatus, Relationship } from "@elizaos/core";
import { elizaLogger } from "@elizaos/core";
import path from "path";
import fs from "fs";
import { Database } from "better-sqlite3";
import { BaseSqliteAdapter } from "./baseAdapter.ts";
import { v4 as generateUUID } from "uuid";

// Default UUID constant
const DEFAULT_UUID = "00000000-0000-0000-0000-000000000000" as UUID;

interface MultiUserAdapterOptions {
    dataDir: string;
}

export class MultiUserSqliteDatabaseAdapter extends BaseSqliteAdapter {
    private userDatabases: Map<string, string>;
    private dataDir: string;

    constructor(db: Database, options: MultiUserAdapterOptions) {
        super(db);
        this.userDatabases = new Map();
        this.dataDir = options.dataDir;

        // Initialize main database tables
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE
            );

            CREATE TABLE IF NOT EXISTS rooms (
                id TEXT PRIMARY KEY
            );

            CREATE TABLE IF NOT EXISTS participants (
                id TEXT PRIMARY KEY,
                userId TEXT NOT NULL,
                roomId TEXT NOT NULL,
                UNIQUE(userId, roomId)
            );

            CREATE TABLE IF NOT EXISTS relationships (
                id TEXT PRIMARY KEY,
                userA TEXT NOT NULL,
                userB TEXT NOT NULL,
                userId TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS goals (
                id TEXT PRIMARY KEY,
                roomId TEXT NOT NULL,
                userId TEXT NOT NULL,
                agentId TEXT NOT NULL,
                name TEXT NOT NULL,
                status TEXT NOT NULL,
                objectives TEXT NOT NULL
            );
        `);
    }

    async initUser(userId: UUID): Promise<void> {
        try {
            // Check if user exists in users table
            const sql = "SELECT id FROM users WHERE id = ?";
            const user = this.db.prepare(sql).get(userId);
            
            if (!user) {
                // Create user if not exists
                const createUserSql = "INSERT INTO users (id, username) VALUES (?, ?)";
                this.db.prepare(createUserSql).run(userId, `user_${userId}`);
            }
            
            // Initialize user's database
            await this.getUserDatabase(userId);
        } catch (error) {
            elizaLogger.error(`Failed to initialize user ${userId}:`, error);
            throw error;
        }
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

    // Add migration function
    private async migrateGoalsTable(dbName: string): Promise<void> {
        try {
            // Check if agentId column exists
            const tableInfo = this.db.prepare(`PRAGMA ${dbName}.table_info(goals)`).all() as { name: string }[];
            const hasAgentId = tableInfo.some(col => col.name === 'agentId');

            if (!hasAgentId) {
                elizaLogger.info(`Adding agentId column to goals table in ${dbName}`);
                
                // Add agentId column with default value
                this.db.exec(`
                    ALTER TABLE ${dbName}.goals ADD COLUMN agentId TEXT;
                    UPDATE ${dbName}.goals SET agentId = '${DEFAULT_UUID}' WHERE agentId IS NULL;
                `);
                
                // Make agentId NOT NULL after setting default value
                this.db.exec(`
                    CREATE TABLE ${dbName}.goals_new (
                        id TEXT PRIMARY KEY,
                        roomId TEXT NOT NULL,
                        userId TEXT NOT NULL,
                        agentId TEXT NOT NULL,
                        name TEXT NOT NULL,
                        status TEXT NOT NULL,
                        objectives TEXT NOT NULL
                    );
                    
                    INSERT INTO ${dbName}.goals_new 
                    SELECT * FROM ${dbName}.goals;
                    
                    DROP TABLE ${dbName}.goals;
                    
                    ALTER TABLE ${dbName}.goals_new RENAME TO goals;
                `);
            }
        } catch (error) {
            elizaLogger.error(`Error migrating goals table in ${dbName}:`, error);
            throw error;
        }
    }

    // Override getUserDatabase to include migration
    protected override async getUserDatabase(userId: string): Promise<string> {
        if (!userId) {
            throw new Error("User ID is required");
        }
        
        if (this.userDatabases.has(userId)) {
            return this.userDatabases.get(userId)!;
        }

        // Create a safe database identifier to avoid SQL injection
        const safeDbName = `user_${userId.replace(/[^a-zA-Z0-9]/g, '_')}`;
        
        // Ensure user directory exists
        const userDir = path.join(this.dataDir, 'users');
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }

        // Define the user database file path
        const userDbPath = path.join(userDir, `${userId}.db`);
        const dbExists = fs.existsSync(userDbPath);
        
        try {
            // Use parameter binding to avoid SQL injection
            const stmt = this.db.prepare('ATTACH DATABASE ? AS ?');
            stmt.run(userDbPath, safeDbName);
            
            // Store the safe database name
            this.userDatabases.set(userId, safeDbName);
            
            // If it's a new database, initialize the tables
            if (!dbExists) {
                // Create user-specific tables
                this.db.exec(`
                    CREATE TABLE ${safeDbName}.memories (
                        id TEXT PRIMARY KEY,
                        type TEXT NOT NULL,
                        content TEXT NOT NULL,
                        embedding BLOB,
                        userId TEXT,
                        roomId TEXT,
                        agentId TEXT,
                        "unique" INTEGER DEFAULT 0,
                        createdAt INTEGER NOT NULL
                    );
                    
                    CREATE TABLE ${safeDbName}.knowledge (
                        id TEXT PRIMARY KEY,
                        agentId TEXT,
                        content TEXT NOT NULL,
                        embedding BLOB,
                        createdAt INTEGER NOT NULL,
                        isMain INTEGER DEFAULT 0,
                        originalId TEXT,
                        chunkIndex INTEGER,
                        isShared INTEGER DEFAULT 0
                    );
                    
                    CREATE TABLE ${safeDbName}.cache (
                        key TEXT NOT NULL,
                        agentId TEXT NOT NULL,
                        value TEXT NOT NULL, 
                        createdAt INTEGER DEFAULT (strftime('%s', 'now')),
                        PRIMARY KEY (key, agentId)
                    );
                    
                    CREATE TABLE ${safeDbName}.goals (
                        id TEXT PRIMARY KEY,
                        roomId TEXT NOT NULL,
                        userId TEXT NOT NULL,
                        agentId TEXT NOT NULL,
                        name TEXT NOT NULL,
                        status TEXT NOT NULL,
                        objectives TEXT NOT NULL
                    );
                `);
                
                // Try to create virtual tables - execute separately and add error handling
                try {
                    // Create index on memories.embedding if VSS module is not available
                    this.db.exec(`
                        CREATE INDEX IF NOT EXISTS ${safeDbName}.idx_memories_embedding ON ${safeDbName}.memories(embedding);
                    `);
                    elizaLogger.debug(`Created index on memories.embedding for user ${userId}`);
                } catch (err: any) {
                    elizaLogger.warn(`Failed to create memories index for user ${userId}: ${err.message}`);
                }
                
                try {
                    // Create index on knowledge.embedding if VSS module is not available
                    this.db.exec(`
                        CREATE INDEX IF NOT EXISTS ${safeDbName}.idx_knowledge_embedding ON ${safeDbName}.knowledge(embedding);
                    `);
                    elizaLogger.debug(`Created index on knowledge.embedding for user ${userId}`);
                } catch (err: any) {
                    elizaLogger.warn(`Failed to create knowledge index for user ${userId}: ${err.message}`);
                }
            } else {
                // Run migrations for existing database
                await this.migrateGoalsTable(safeDbName);
            }
            
            return safeDbName;
        } catch (error: any) {
            elizaLogger.error(`Failed to attach database for user ${userId}: ${error.message}`);
            throw new Error(`Failed to initialize user database: ${error.message}`);
        }
    }
    
    // Override executeUserQuery to provide multi-user functionality
    protected override async executeUserQuery<T>(userId: string, callback: (dbName: string) => T): Promise<T> {
        const dbName = await this.getUserDatabase(userId);
        return callback(dbName);
    }

    // Override close to handle multi-user cleanup
    override async close() {
        // Safely detach all user databases
        for (const [userId, dbName] of this.userDatabases.entries()) {
            try {
                const stmt = this.db.prepare('DETACH DATABASE ?');
                stmt.run(dbName);
                elizaLogger.debug(`Successfully detached database for user ${userId}`);
            } catch (error) {
                // Log error but continue processing other databases
                elizaLogger.error(`Error detaching database for user ${userId}`, error);
            }
        }
        this.userDatabases.clear();
        
        // Close the main database connection
        await super.close();
    }

    override async removeKnowledge(id: UUID, userId?: UUID): Promise<void> {
        if (!userId) {
            await super.removeKnowledge(id);
            return;
        }
        
        if (typeof id !== "string") {
            throw new Error("Knowledge ID must be a string");
        }

        return this.executeUserQuery(userId, async (dbName) => {
            try {
                // Execute the transaction
                this.db.transaction(() => {
                    if (id.includes("*")) {
                        const pattern = id.replace("*", "%");
                        const sql = `DELETE FROM ${dbName}.knowledge WHERE id LIKE ?`;
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
                        // Log queries before execution
                        const selectSql = `SELECT id FROM ${dbName}.knowledge WHERE id = ?`;
                        const chunkSql = `SELECT id FROM ${dbName}.knowledge WHERE json_extract(content, '$.metadata.originalId') = ?`;

                        const mainEntry = this.db.prepare(selectSql).get(id) as ChunkRow | undefined;
                        const chunks = this.db.prepare(chunkSql).all(id) as ChunkRow[];

                        elizaLogger.debug(`[Knowledge Remove] Found for user ${userId}:`, {
                            mainEntryExists: !!mainEntry?.id,
                            chunkCount: chunks.length
                        });

                        // Execute chunk deletion
                        const chunkDeleteSql = `DELETE FROM ${dbName}.knowledge WHERE json_extract(content, '$.metadata.originalId') = ?`;
                        const chunkResult = this.db.prepare(chunkDeleteSql).run(id);

                        // Execute main entry deletion
                        const mainDeleteSql = `DELETE FROM ${dbName}.knowledge WHERE id = ?`;
                        const mainResult = this.db.prepare(mainDeleteSql).run(id);

                        return chunkResult.changes + mainResult.changes;
                    }
                })();
            } catch (error) {
                elizaLogger.error("[Knowledge Remove] Error:", {
                    id,
                    userId,
                    error: error instanceof Error
                        ? { message: error.message, stack: error.stack, name: error.name }
                        : error,
                });
                throw error;
            }
        });
    }

    override async clearKnowledge(agentId: UUID, shared?: boolean, userId?: UUID): Promise<void> {
        if (!userId) {
            await super.clearKnowledge(agentId, shared);
            return;
        }
        
        return this.executeUserQuery(userId, (dbName) => {
            const sql = shared
                ? `DELETE FROM ${dbName}.knowledge WHERE (agentId = ? OR isShared = 1)`
                : `DELETE FROM ${dbName}.knowledge WHERE agentId = ?`;
            try {
                this.db.prepare(sql).run(agentId);
            } catch (error) {
                elizaLogger.error(
                    `Error clearing knowledge for agent ${agentId} in user database ${userId}:`,
                    error
                );
                throw error;
            }
        });
    }

    override async searchMemories(params: {
        tableName: string;
        roomId: UUID;
        agentId?: UUID;
        embedding: number[];
        match_threshold: number;
        match_count: number;
        unique: boolean;
        userId?: UUID;
    }): Promise<Memory[]> {
        if (!params.userId) {
            return super.searchMemories({
                ...params,
                agentId: params.agentId || this.getDefaultAgentId()
            });
        }
        
        return this.executeUserQuery(params.userId, (dbName) => {
            try {
                const queryParams = [
                    new Float32Array(params.embedding),
                    params.tableName,
                    params.roomId,
                ];

                let sql = `
                    SELECT *, vec_distance_L2(embedding, ?) AS similarity
                    FROM ${dbName}.memories
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
                    elizaLogger.warn(`VSS module not available, using basic query for user ${params.userId}`);
                    
                    const fallbackSql = `
                        SELECT *
                        FROM ${dbName}.memories
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
        });
    }

    override async getMemories(params: {
        roomId: UUID;
        count?: number;
        unique?: boolean;
        tableName: string;
        agentId: UUID;
        start?: number;
        end?: number;
        userId?: UUID;
    }): Promise<Memory[]> {
        if (!params.userId) {
            return super.getMemories(params);
        }
        
        return this.executeUserQuery(params.userId, (dbName) => {
            if (!params.tableName) {
                throw new Error("tableName is required");
            }
            if (!params.roomId) {
                throw new Error("roomId is required");
            }
            let sql = `SELECT * FROM ${dbName}.memories WHERE type = ? AND agentId = ? AND roomId = ?`;

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
        });
    }
    
    override async countMemories(
        roomId: UUID,
        unique = true,
        tableName = "",
        userId?: UUID
    ): Promise<number> {
        if (!userId) {
            return super.countMemories(roomId, unique, tableName);
        }
        
        return this.executeUserQuery(userId, (dbName) => {
            if (!tableName) {
                throw new Error("tableName is required");
            }

            let sql = `SELECT COUNT(*) as count FROM ${dbName}.memories WHERE type = ? AND roomId = ?`;
            const queryParams = [tableName, roomId] as string[];

            if (unique) {
                sql += ' AND "unique" = 1';
            }

            return (this.db.prepare(sql).get(...queryParams) as { count: number }).count;
        });
    }

    override async searchMemoriesByEmbedding(
        embedding: number[],
        params: {
            match_threshold?: number;
            count?: number;
            roomId?: UUID;
            agentId: UUID;
            unique?: boolean;
            tableName: string;
            userId?: UUID;
        }
    ): Promise<Memory[]> {
        if (!params.userId) {
            return super.searchMemoriesByEmbedding(embedding, {
                ...params,
                agentId: params.agentId || this.getDefaultAgentId()
            });
        }
        
        return this.executeUserQuery(params.userId, (dbName) => {
            try {
                const queryParams = [
                    new Float32Array(embedding),
                    params.tableName,
                    params.agentId,
                ];

                let sql = `
                    SELECT *, vec_distance_L2(embedding, ?) AS similarity
                    FROM ${dbName}.memories
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
                    elizaLogger.warn(`VSS module not available, using basic query for user ${params.userId}`);
                    
                    const fallbackSql = `
                        SELECT *
                        FROM ${dbName}.memories
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
                    ];
                    
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
        });
    }

    // Change from private to protected
    protected override getDefaultAgentId(): UUID {
        return DEFAULT_UUID;
    }

    // Add missing method implementations
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

    async getGoals(params: {
        roomId: UUID;
        agentId?: UUID;
        userId?: UUID | null;
        onlyInProgress?: boolean;
        count?: number;
    }): Promise<Goal[]> {
        // Use default agent ID if not provided
        const agentId = params.agentId || this.getDefaultAgentId();

        if (!params.userId) {
            // Query the main database's goals table
            let sql = "SELECT * FROM goals WHERE roomId = ? AND agentId = ?";
            const queryParams: (UUID | number)[] = [params.roomId, agentId];

            if (params.onlyInProgress) {
                sql += " AND status = 'IN_PROGRESS'";
            }

            if (params.count) {
                sql += " LIMIT ?";
                queryParams.push(params.count);
            }

            try {
                const goals = this.db.prepare(sql).all(...queryParams) as Goal[];
                return goals.map((goal) => ({
                    ...goal,
                    objectives:
                        typeof goal.objectives === "string"
                            ? JSON.parse(goal.objectives)
                            : goal.objectives,
                }));
            } catch (error) {
                elizaLogger.error("Error querying goals from main database:", error);
                return [];
            }
        }

        // Query the user's database
        return this.executeUserQuery(params.userId, (dbName) => {
            let sql = `SELECT * FROM ${dbName}.goals WHERE roomId = ? AND agentId = ?`;
            const queryParams: (UUID | number)[] = [params.roomId, agentId];

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

            try {
                const goals = this.db.prepare(sql).all(...queryParams) as Goal[];
                return goals.map((goal) => ({
                    ...goal,
                    objectives:
                        typeof goal.objectives === "string"
                            ? JSON.parse(goal.objectives)
                            : goal.objectives,
                }));
            } catch (error) {
                elizaLogger.error(`Error querying goals from user database ${dbName}:`, error);
                return [];
            }
        });
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
        const goalId = (goal.id || generateUUID()) as UUID;
        this.db
            .prepare(sql)
            .run(
                goalId,
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
        const newRoomId = (roomId || generateUUID()) as UUID;
        try {
            const sql = "INSERT INTO rooms (id) VALUES (?)";
            this.db.prepare(sql).run(newRoomId);
        } catch (error) {
            console.log("Error creating room", error);
        }
        return newRoomId;
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
            this.db.prepare(sql).run((generateUUID()) as UUID, userId, roomId);
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
            .run((generateUUID()) as UUID, params.userA, params.userB, params.userA);
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
} 