import { type IAgentRuntime, type Memory, elizaLogger, type UUID } from "@elizaos/core";
import { type UserData, formatCacheKey } from "./types";

type UserDataField = 'name' | 'location' | 'occupation';

/**
 * Service class for managing user data operations
 */
export class UserDataService {
    constructor(private runtime: IAgentRuntime) {}

    /**
     * Get user data from cache
     */
    async getUserData(userId: UUID): Promise<UserData | null> {
        try {
            const cacheKey = formatCacheKey({
                agentName: this.runtime.character.name,
                username: userId
            });
            const userData = await this.runtime.cacheManager.get<UserData>(cacheKey);
            elizaLogger.info("Retrieved user data from cache", { 
                userId,
                cacheKey,
                hasData: !!userData,
                userData
            });
            return userData;
        } catch (error) {
            elizaLogger.error("Error getting user data:", error);
            return null;
        }
    }

    /**
     * Save user data to cache
     */
    async saveUserData(userId: UUID, userData: UserData): Promise<boolean> {
        try {
            const cacheKey = formatCacheKey({
                agentName: this.runtime.character.name,
                username: userId
            });
            await this.runtime.cacheManager.set(cacheKey, userData);
            elizaLogger.info("Saved user data to cache", { 
                userId,
                cacheKey,
                userData
            });
            return true;
        } catch (error) {
            elizaLogger.error("Error saving user data:", error);
            return false;
        }
    }

    /**
     * Get existing and missing fields from user data
     */
    getFieldStatus(userData: Partial<UserData>): {
        existingFields: UserDataField[];
        missingFields: UserDataField[];
    } {
        const requiredFields: UserDataField[] = ['name', 'location', 'occupation'];
        
        const existingFields = requiredFields.filter(field => userData[field]) as UserDataField[];
        const missingFields = requiredFields.filter(field => !userData[field]) as UserDataField[];

        elizaLogger.info("Field status check", {
            existingFields,
            missingFields,
            userData
        });

        return { existingFields, missingFields };
    }

    /**
     * Update a specific field in user data
     */
    updateField(userData: UserData, field: UserDataField, value: string): boolean {
        if (!value || value.trim().length === 0) {
            elizaLogger.info("Invalid field value", { field, value });
            return false;
        }

        if (userData[field] !== value) {
            const oldValue = userData[field];
            userData[field] = value;
            userData.updatedAt = Date.now();
            elizaLogger.info("Updated field value", {
                field,
                oldValue,
                newValue: value,
                userData
            });
            return true;
        }

        elizaLogger.info("Field value unchanged", { field, value });
        return false;
    }

    /**
     * Process a message to update user data
     */
    async processMessage(message: Memory): Promise<boolean> {
        try {
            // Get or initialize user data
            const userData = await this.getUserData(message.userId) || {
                updatedAt: Date.now()
            };

            const { existingFields, missingFields } = this.getFieldStatus(userData);
            elizaLogger.debug("Field status", { existingFields, missingFields });

            // Check if all required data is collected
            if (missingFields.length === 0 && !userData.isComplete) {
                userData.isComplete = true;
                elizaLogger.info("All user data collected", { userId: message.userId, userData });
                await this.saveUserData(message.userId, userData);
            }

            return true;
        } catch (error) {
            elizaLogger.error("Error processing message:", error);
            return false;
        }
    }
} 