import { UUID } from "@elizaos/core";

/**
 * Represents user data collected during conversations
 */
export interface UserData {
    /** User's full name */
    name?: string;
    /** User's location/city */
    location?: string;
    /** User's occupation/profession */
    occupation?: string;
    /** Whether all required data has been collected */
    isComplete?: boolean;
    /** Timestamp when the data was last updated */
    updatedAt?: number;
}

/**
 * Cache key components for user data
 */
export interface CacheKey {
    /** Name of the agent collecting data */
    agentName: string;
    /** User's unique identifier */
    username: UUID;
}

/**
 * Formats a cache key for storing user data
 * @param key Cache key components
 * @returns Formatted cache key string
 */
export function formatCacheKey(key: CacheKey): string {
    return `userData/${key.agentName}/${key.username}`;
}