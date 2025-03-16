import { IAgentRuntime, Provider, Memory, elizaLogger } from "@elizaos/core";
import { StreamGoalsService } from "./streamGoalsService";
import { isGoalsComplete } from "./streamGoalsEvaluator";
import { StreamGoals } from "./types";

const emptyStreamGoals: StreamGoals = {
    goals: [],
    startTime: Date.now(),
    updatedAt: Date.now()
};

/**
 * Stream assistant provider, manages stream goals status and requirements
 */
export const streamGoalsProvider: Provider = {
    get: async (runtime: IAgentRuntime, message: Memory): Promise<string | null> => {
        try {
            const service = new StreamGoalsService(runtime);
            let streamGoals = await service.getStreamGoals(message.userId);
            
            // If no goals exist and message contains goal-related keywords
            if (!streamGoals && message.content.text.toLowerCase().match(/\b(goal|target)\b/)) {
                return service.getGoalInstructions();
            }

            if (!streamGoals) {
                streamGoals = service.getEmptyGoals();
            }

            // Get status prompt
            const statusPrompt = service.getStatusPrompt(streamGoals);
            if (statusPrompt) {
                return statusPrompt;
            }

            // If asking about progress
            if (message.content.text.toLowerCase().match(/\b(progress|status|how.*going)\b/)) {
                return `Current Progress:\n${service.formatGoals(streamGoals)}`;
            }

            // If message contains numbers but incorrect format
            if (message.content.text.match(/\d+/) && 
                !message.content.text.toLowerCase().match(/\b(got|have|reached)\b.*\d+/)) {
                return service.getProgressInstructions();
            }

            return null;
        } catch (error) {
            elizaLogger.error("Error in streamGoalsProvider:", error);
            return null;
        }
    }
};

/**
 * Goal completion provider, returns special messages when goals are near completion
 */
export const streamGoalsCompletionProvider: Provider = {
    get: async (runtime: IAgentRuntime, message: Memory): Promise<string | null> => {
        try {
            const service = new StreamGoalsService(runtime);
            const streamGoals = await service.getStreamGoals(message.userId);
            
            if (!streamGoals || !streamGoals.goals.length) {
                return null;
            }

            // Calculate progress percentages
            const goalsWithProgress = streamGoals.goals.map(g => ({
                ...g,
                percentage: (g.current / g.target * 100)
            }));

            // Check for goals near completion (>= 90%)
            const nearCompletion = goalsWithProgress.filter(g => 
                !g.isComplete && g.percentage >= 90
            );

            if (nearCompletion.length > 0) {
                const goals = nearCompletion.map(g => {
                    const remaining = g.target - g.current;
                    return g.reward 
                        ? `${remaining} more ${g.name} for ${g.reward}`
                        : `${remaining} more ${g.name}`;
                });
                return `🔥 Almost there! Just need ${goals.join(' and ')}! Keep going!`;
            }

            // Check if all goals are complete
            if (isGoalsComplete(streamGoals)) {
                return "🎉 Incredible! We've achieved all our goals! Thank you everyone for your amazing support! 🎊";
            }

            return null;
        } catch (error) {
            elizaLogger.error("Error in streamGoalsCompletionProvider:", error);
            return null;
        }
    }
}; 