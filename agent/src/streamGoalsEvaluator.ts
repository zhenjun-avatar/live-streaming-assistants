import { Evaluator, IAgentRuntime, Memory, elizaLogger, ModelClass, composeContext, generateObjectArray } from "@elizaos/core";
import { StreamGoalsService } from "./streamGoalsService";
import { StreamGoals, GoalUpdate, GoalType } from "./types";

/**
 * Check if all goals are complete
 */
const emptyStreamGoals: StreamGoals = {
    goals: [],
    startTime: Date.now(),
    updatedAt: Date.now()
};

export const isGoalsComplete = (goals: StreamGoals): boolean => {
    if (!goals.goals.length) return false;
    return goals.goals.every(goal => goal.isComplete);
};

const streamGoalsEvaluator: Evaluator = {
    name: "UPDATE_STREAM_GOALS",
    similes: ["UPDATE_GOALS", "CHECK_STREAM_GOALS", "TRACK_STREAM_PROGRESS"],
    description: "Extract and update stream goals including likes, products, and gifts progress.",
    alwaysRun: true,
    
    validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
        try {
            elizaLogger.info("Starting validate in streamGoalsEvaluator", {
                userId: message.userId,
                messageContent: message.content?.text,
                evaluatorName: "UPDATE_STREAM_GOALS"
            });

            if (!message.content?.text) return false;

            // Check if the message contains goal-related keywords
            const goalKeywords = [
                'goal', 'target', 'likes', 'products', 'gifts', 'viewers',
                'reached', 'got', 'have', 'achieved', 'completed', 'progress'
            ];

            const hasGoalKeywords = goalKeywords.some(keyword => 
                message.content!.text.toLowerCase().includes(keyword)
            );

            if (!hasGoalKeywords) {
                elizaLogger.info("No goal keywords found in message", {
                    userId: message.userId,
                    text: message.content.text
                });
                return false;
            }

            const service = new StreamGoalsService(runtime);
            const goals = await service.getStreamGoals(message.userId);
            
            elizaLogger.info("Validate result", { 
                userId: message.userId, 
                hasGoals: !!goals,
                hasKeywords: hasGoalKeywords
            });
            
            // Process if we have goals or if the message might be setting new goals
            return hasGoalKeywords && (!goals || !isGoalsComplete(goals));
        } catch (error) {
            elizaLogger.error("Error in streamGoalsEvaluator validate:", error);
            return false;
        }
    },

    handler: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
        try {
            const streamGoalsTemplate = 
`TASK: Extract stream goals information from the conversation.

# Instructions
Extract stream goals information from the conversation:
- Look for goal settings like "set goal: X likes" or "target X products"
- Look for progress updates like "got X likes" or "reached X viewers"
- Numbers must be positive integers
- Only extract explicitly stated numbers
- Identify if each number is a target (goal setting) or current value (progress update)

# Examples
Input: "Set goal: 100 likes and target 20 products"
[
  {
    "name": "likes",
    "type": "likes",
    "value": 100,
    "isTarget": true
  },
  {
    "name": "products",
    "type": "products",
    "value": 20,
    "isTarget": true
  }
]

Input: "We got 50 likes! And just reached 15 products"
[
  {
    "name": "likes",
    "type": "likes",
    "value": 50,
    "isTarget": false
  },
  {
    "name": "products",
    "type": "products",
    "value": 15,
    "isTarget": false
  }
]

# Current Conversation
${message.content?.text}

# Response Format
[
  {
    "name": string,
    "type": "likes" | "products" | "gifts" | "viewers" | "custom",
    "value": number,
    "isTarget": boolean
  }
]`;

            const state = await runtime.composeState(message);
            const updates = await generateObjectArray({
                runtime,
                context: composeContext({ 
                    state,
                    template: streamGoalsTemplate 
                }),
                modelClass: ModelClass.SMALL,
            }) as GoalUpdate[];

            if (!updates?.length) return false;

            const service = new StreamGoalsService(runtime);
            let updatedAny = false;

            // Process each update
            for (const update of updates) {
                if (update.isTarget) {
                    const result = await service.createGoal(
                        message.userId,
                        update.type,
                        update.value
                    );
                    if (result) updatedAny = true;
                } else {
                    const result = await service.updateGoalProgress(
                        message.userId,
                        update
                    );
                    if (result) updatedAny = true;
                }
            }

            elizaLogger.info("Goal updates processed", { 
                userId: message.userId,
                updatedAny,
                updates
            });

            return updatedAny;
        } catch (error) {
            elizaLogger.error("Error in streamGoalsEvaluator handler:", error);
            return false;
        }
    },

    examples: [
        {
            context: "Setting goals",
            messages: [
                {
                    user: "user1",
                    content: { text: "Set goal: 100 likes and target 20 products" }
                }
            ],
            outcome: `\`\`\`json
[
    {
        "name": "likes",
        "type": "likes",
        "value": 100,
        "isTarget": true
    },
    {
        "name": "products",
        "type": "products",
        "value": 20,
        "isTarget": true
    }
]
\`\`\``
        },
        {
            context: "Progress update",
            messages: [
                {
                    user: "user1",
                    content: { text: "We got 50 likes and reached 15 products!" }
                }
            ],
            outcome: `\`\`\`json
[
    {
        "name": "likes",
        "type": "likes",
        "value": 50,
        "isTarget": false
    },
    {
        "name": "products",
        "type": "products",
        "value": 15,
        "isTarget": false
    }
]
\`\`\``
        }
    ]
};

export { streamGoalsEvaluator }; 