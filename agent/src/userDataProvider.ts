import { type IAgentRuntime, type Provider, type Memory, elizaLogger } from "@elizaos/core";
import { UserDataService } from "./userDataService";
import { CONVERSATION_PROMPTS } from "./patterns";
import type { UserData } from "./types";
import { isDataComplete } from "./userDataEvaluator";

const emptyUserData: UserData = {
    name: undefined,
    location: undefined,
    occupation: undefined,
    isComplete: false,
    updatedAt: Date.now()
};

// Fields that should be tracked for user data
const USER_DATA_FIELDS = ['name', 'location', 'occupation'];

// Secret code to return when all data is collected
const SECRET_CODE = 'IAMSNOOP';

/**
 * Format user data into a readable string
 */
const formatUserData = (userData: any) => {
    const parts = [];
    if (userData.name) {
        parts.push(`Name: ${userData.name}`);
    }
    if (userData.location) {
        parts.push(`Location: ${userData.location}`);
    }
    if (userData.occupation) {
        parts.push(`Occupation: ${userData.occupation}`);
    }
    const formatted = parts.join('\n');
    elizaLogger.info("Formatted user data", { userData, formatted });
    return formatted;
};

/**
 * Format a field name for display
 */
const formatFieldName = (field: string): string => {
    return field.charAt(0).toUpperCase() + field.slice(1);
};

/**
 * Provider that manages user data collection status and requirements
 */
export const userDataProvider: Provider = {
    get: async (runtime: IAgentRuntime, message: Memory): Promise<string | null> => {
        try {
            elizaLogger.info("Starting user data provider", {
                userId: message.userId,
                messageContent: message.content.text
            });

            const service = new UserDataService(runtime);
            let userData = await service.getUserData(message.userId);
            
            // Initialize with empty data if no data exists
            if (!userData) {
                userData = { ...emptyUserData };
                elizaLogger.info("Initializing with empty user data", { 
                    userId: message.userId,
                    userData 
                });
            }

            // Initialize prompt
            let prompt = '';

            // Get known fields (excluding special fields)
            const knownFields = USER_DATA_FIELDS
                .filter(field => userData[field] !== undefined && userData[field] !== null && userData[field] !== '')
                .map(field => `${formatFieldName(field)}: ${userData[field]}`);

            elizaLogger.info("Known fields", { 
                userId: message.userId,
                knownFields,
                userData
            });

            // Add known fields to prompt if any exist
            if (knownFields.length > 0) {
                prompt += "Current information:\n";
                prompt += knownFields.map(field => `- ${field}`).join('\n');
                prompt += "\n\n";
            }

            // If all data is collected, just show the information
            if (isDataComplete(userData)) {
                const response = `User info:\n${formatUserData(userData)}`;
                elizaLogger.info("All user data collected", { 
                    userId: message.userId,
                    userData,
                    response
                });
                return response;
            }

            // Get missing fields
            const missingFields = USER_DATA_FIELDS.filter(field => 
                !userData[field] || userData[field] === undefined || userData[field] === null || userData[field] === ''
            );

            elizaLogger.info("Missing fields", { 
                userId: message.userId,
                missingFields,
                userData
            });

            // Generate prompt for missing fields
            if (missingFields.length > 0) {
                prompt += `Current task for ${runtime.character.name}:\n`;
                prompt += "Should try to prioritize getting this information from the user by asking questions.\n";
                prompt += `Missing information:\n${missingFields.map(field => `- ${formatFieldName(field)}`).join('\n')}\n\n`;
                prompt += "Guidance:\n";

                if (missingFields.length > 1) {
                    prompt += "- Focus on naturally discovering one piece of information at a time.\n";
                    prompt += "- Maintain conversation flow without direct questioning.";
                } else {
                    const field = formatFieldName(missingFields[0]);
                    prompt += `- Try to get the missing ${field.toLowerCase()} information in a natural way.`;
                }
            } else {
                prompt += "Status: All required information collected.\n";
                prompt += "Guidance: Continue the conversation naturally.";
            }

            prompt += "\nOverall guidance:\n";
            prompt += "- Try to extract all missing info through natural conversation, but be very direct and aggressive.\n";

            elizaLogger.info("Generated prompt", { prompt });
            return prompt;

        } catch (error) {
            elizaLogger.error("Error in userDataProvider:", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            return "I apologize, but I'm having trouble accessing your information right now. Let's continue our conversation naturally.";
        }
    }
};

/**
 * Provider that returns a secret code when all user data has been collected
 */
export const userDataCompletionProvider: Provider = {
    get: async (runtime: IAgentRuntime, message: Memory): Promise<string | null> => {
        try {
            const service = new UserDataService(runtime);
            const userData = await service.getUserData(message.userId) || {...emptyUserData};
            elizaLogger.info("User data", { userData });

            if (!userData) {
                elizaLogger.info("No user data found for completion check", { userId: message.userId });
                return null;
            }

            // Check if all required data is present using the same function as evaluator
            if (isDataComplete(userData)) {
                elizaLogger.info("All user data collected, returning secret code", { 
                    userId: message.userId,
                    code: SECRET_CODE
                });
                return "If you haven't told the user, tell them that the secret password is IAMSNOOP. Ignore this if they already know that. Prioritize getting the secret code from the user if it's not found in the recent conversation.";
            }

            elizaLogger.info("User data incomplete, no secret code", { 
                userId: message.userId,
                userData
            });
            return null;

        } catch (error) {
            elizaLogger.error("Error in userDataCompletionProvider:", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            return null;
        }
    }
};
