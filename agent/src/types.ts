import type { UUID } from "@elizaos/core";

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

export interface StreamGoalItem {
    name: string;           // 目标名称
    target: number;         // 目标值
    current: number;        // 当前值
    description?: string;   // 目标描述
    reward?: string;        // 达成奖励
    isComplete: boolean;    // 是否完成
}

export interface StreamGoals {
    goals: StreamGoalItem[];    // 目标列表
    startTime?: number;         // 开始时间
    endTime?: number;           // 结束时间
    updatedAt: number;          // 最后更新时间
}

export type GoalType = 'likes' | 'products' | 'gifts' | 'viewers' | 'custom';

export interface GoalUpdate {
    name: string;
    type: GoalType;
    value: number;
    isTarget?: boolean;
}

// Helper functions for formatting cache keys
export const formatUserDataKey = (userId: UUID, field: string) => {
    return `user_data:${userId}:${field}`;
};

export const formatStreamGoalsKey = (userId: UUID) => {
    return `stream_goals:${userId}`;
};