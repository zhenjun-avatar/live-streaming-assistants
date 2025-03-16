import { Evaluator, IAgentRuntime, Memory, elizaLogger, ModelClass, composeContext, generateObjectArray } from "@elizaos/core";
import { UserDataService } from "./userDataService";
import { UserData } from "./types";



/**
 * Evaluator for extracting and storing user information from conversations
 */
const USER_DATA_FIELDS = ['name', 'location', 'occupation'];

export const isDataComplete = (userData: UserData): boolean => {
    return USER_DATA_FIELDS.every(field => 
        userData[field] !== undefined && 
        userData[field] !== null && 
        userData[field] !== ''
    );
};

const emptyUserData: UserData = {
    name: undefined,
    location: undefined,
    occupation: undefined,
    isComplete: false,
    updatedAt: Date.now()
};

const userDataEvaluator: Evaluator = {
    name: "GET_USER_DATA",
    similes: ["GET_INFORMATION", "GET_USER_INFORMATION", "COLLECT_USER_DATA"],
    description: "Extract and store user's personal information including name, location, and occupation.",
    alwaysRun: true,
    
    validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
        try {
            elizaLogger.info("Starting validate in userDataEvaluator", {
                userId: message.userId,
                messageContent: message.content?.text,
                evaluatorName: "GET_USER_DATA",
                timestamp: new Date().toISOString()
            });

            if (!message.content?.text) {
                elizaLogger.info("Skipping non-text message in validate", {
                    userId: message.userId,
                    content: message.content
                });
                return false;
            }

            const service = new UserDataService(runtime);
            const userData = await service.getUserData(message.userId) || {...emptyUserData};
            const shouldContinue = !isDataComplete(userData);

            elizaLogger.info("Validate result", { 
                userId: message.userId, 
                hasUserData: !!userData,
                isComplete: isDataComplete(userData),
                shouldContinue,
                userData,
                evaluatorName: "GET_USER_DATA",
                timestamp: new Date().toISOString()
            });
            
            return shouldContinue;
        } catch (error) {
            elizaLogger.error("Error in userDataEvaluator validate:", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                evaluatorName: "GET_USER_DATA"
            });
            return false;
        }
    },

    handler: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
        try {
            elizaLogger.info("Starting handler in userDataEvaluator", {
                userId: message.userId,
                messageContent: message.content?.text,
                evaluatorName: "GET_USER_DATA",
                timestamp: new Date().toISOString()
            });
            const userDataTemplate = 
`TASK: Extract user information from the conversation as a JSON object.

# Instructions
Extract user information from the conversation:
- Extract name, location, and occupation
- Only extract information that is explicitly stated
- Set fields to null if not found in the CURRENT message
- Do not guess or infer information

# Examples
Input: "Hi, I'm John from New York"
[
  {
    "name": "John",
    "location": "New York",
    "occupation": null,
    "isComplete": false,
    "updatedAt": ${Date.now()}
  }
]

Input: "I work as a software engineer"
[
  {
    "name": null,
    "location": null,
    "occupation": "software engineer",
    "isComplete": false,
    "updatedAt": ${Date.now()}
  }
]

# Current Conversation
${message.content?.text}

# Response Format
Response must be a JSON array containing a single object:
[
  {
    "name": string | null,
    "location": string | null,
    "occupation": string | null,
    "isComplete": boolean,
    "updatedAt": number
  }
]`;

            if (!message.content?.text) {
                elizaLogger.info("Handler skipping non-text message", {
                    userId: message.userId,
                    content: message.content
                });
                return false;
            }

            const state = await runtime.composeState(message);
            
            elizaLogger.info("State composed in handler", {
                userId: message.userId,
                hasState: !!state,
                evaluatorName: "GET_USER_DATA",
                stateKeys: state ? Object.keys(state) : []
            });
            
            const context = composeContext({
                state,
                template: userDataTemplate,
            });

            elizaLogger.info("Context created in handler", {
                userId: message.userId,
                hasContext: !!context,
                evaluatorName: "GET_USER_DATA",
                contextLength: context?.length
            });

            const userData = await generateObjectArray({
                runtime,
                context,
                modelClass: ModelClass.SMALL,
            });

            elizaLogger.info("LLM extraction result", {
                userId: message.userId,
                extractedData: userData?.[0] || null,
                evaluatorName: "GET_USER_DATA",
                timestamp: new Date().toISOString()
            });

            if (!userData || !Array.isArray(userData) || userData.length === 0) {
                elizaLogger.info("No user data extracted", { 
                    userId: message.userId,
                    evaluatorName: "GET_USER_DATA"
                });
                return false;
            }

            const extractedData = userData[0];
            if (!extractedData) {
                elizaLogger.info("Invalid extracted data format", { 
                    userId: message.userId,
                    evaluatorName: "GET_USER_DATA"
                });
                return false;
            }

            const service = new UserDataService(runtime);
            const existingData = await service.getUserData(message.userId) || {...emptyUserData};

            elizaLogger.info("Merging user data", {
                userId: message.userId,
                existingData,
                extractedData,
                evaluatorName: "GET_USER_DATA"
            });

            // Merge existing data with new data, only updating non-null values
            const mergedData = {
                ...existingData,
                ...Object.fromEntries(
                    Object.entries(extractedData)
                        .filter(([_, value]) => value !== null) // Only keep non-null values
                ),
                isComplete: false, // Will be updated below
                updatedAt: Date.now()
            };

            // Check if all required fields are present
            mergedData.isComplete = isDataComplete(mergedData);

            // Only save if we have new information
            const changes = Object.entries(extractedData)
                .filter(([key, value]) => value !== null && value !== existingData[key])
                .map(([key]) => key);

            if (changes.length > 0) {
                await service.saveUserData(message.userId, mergedData);
                elizaLogger.info("Updated user data", { 
                    userId: message.userId, 
                    userData: mergedData,
                    changes,
                    evaluatorName: "GET_USER_DATA"
                });
            } else {
                elizaLogger.info("No new information to update", { 
                    userId: message.userId,
                    evaluatorName: "GET_USER_DATA"
                });
            }

            return true;
        } catch (error) {
            elizaLogger.error("Error in userDataEvaluator handler:", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                evaluatorName: "GET_USER_DATA"
            });
            return false;
        }
    },

    examples: [
        {
            context: "User introduces themselves for the first time",
            messages: [
                {
                    user: "user1",
                    content: { text: "Hello, my name is Zhang San, and I'm from Beijing" }
                }
            ],
            outcome: `\`\`\`json
{
  "name": "Zhang San",
  "location": "Beijing",
  "occupation": null,
  "isComplete": false,
  "updatedAt": 1234567890
}
\`\`\``
        },
        {
            context: "User shares work information",
            messages: [
                {
                    user: "user1",
                    content: { text: "I'm a software developer" }
                }
            ],
            outcome: `\`\`\`json
{
  "name": null,
  "location": null,
  "occupation": "software developer",
  "isComplete": false,
  "updatedAt": 1234567890
}
\`\`\``
        },
        {
            context: "User completes the introduction",
            messages: [
                {
                    user: "user1",
                    content: { text: "I'm Li Si, working in Shanghai, and my occupation is product manager" }
                }
            ],
            outcome: `\`\`\`json
{
  "name": "Li Si",
  "location": "Shanghai",
  "occupation": "product manager",
  "isComplete": true,
  "updatedAt": 1234567890
}
\`\`\``
        }
    ]
};

export default userDataEvaluator;