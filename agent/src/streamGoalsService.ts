import { type IAgentRuntime, elizaLogger } from "@elizaos/core";
import type { StreamGoals, StreamGoalItem, GoalType, GoalUpdate } from "./types";

/**
 * Service class for managing stream goals operations
 */
export class StreamGoalsService {
    private runtime: IAgentRuntime;

    constructor(runtime: IAgentRuntime) {
        this.runtime = runtime;
    }

    /**
     * Format cache key for stream goals
     */
    private formatCacheKey(userId: string): string {
        return `stream_goals/${this.runtime.character.name}/${userId}`;
    }

    /**
     * Get stream goals data
     */
    async getStreamGoals(userId: string): Promise<StreamGoals | null> {
        try {
            const cacheKey = this.formatCacheKey(userId);
            const goals = await this.runtime.cacheManager.get<StreamGoals>(cacheKey);
            elizaLogger.info("Retrieved stream goals from cache", { 
                userId,
                cacheKey,
                hasData: !!goals,
                goals
            });
            return goals;
        } catch (error) {
            elizaLogger.error("Error getting stream goals:", {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            return null;
        }
    }

    /**
     * Initialize new stream goals
     */
    getEmptyGoals(): StreamGoals {
        return {
            goals: [],
            startTime: Date.now(),
            updatedAt: Date.now()
        };
    }

    /**
     * Create a new goal
     */
    async createGoal(userId: string, type: GoalType, target: number, description?: string, reward?: string): Promise<boolean> {
        try {
            const goals = await this.getStreamGoals(userId) || this.getEmptyGoals();
            
            // Check if there's already an incomplete goal of the same type
            const existingGoal = goals.goals.find(g => g.name === type && !g.isComplete);
            if (existingGoal) {
                // Update existing goal if found
                existingGoal.target = target;
                if (description) existingGoal.description = description;
                if (reward) existingGoal.reward = reward;
                existingGoal.isComplete = existingGoal.current >= target;
            } else {
                // Create new goal only if no incomplete goal of same type exists
                const newGoal: StreamGoalItem = {
                    name: type,
                    target,
                    current: 0,
                    description,
                    reward,
                    isComplete: false
                };
                goals.goals.push(newGoal);
            }

            goals.updatedAt = Date.now();
            await this.updateStreamGoals(userId, goals);
            return true;
        } catch (error) {
            elizaLogger.error("Error creating goal:", {
                error: error instanceof Error ? error.message : String(error),
                userId,
                type,
                target
            });
            return false;
        }
    }

    /**
     * Update goal progress
     */
    async updateGoalProgress(userId: string, update: GoalUpdate): Promise<boolean> {
        try {
            let goals = await this.getStreamGoals(userId);
            if (!goals) {
                goals = this.getEmptyGoals();
            }

            const goalIndex = goals.goals.findIndex(g => g.name === update.name);
            if (goalIndex === -1) {
                // If goal doesn't exist, create it with current value
                const newGoal: StreamGoalItem = {
                    name: update.name,
                    target: Math.max(update.value * 2, 100), // Set a reasonable target
                    current: update.value,
                    isComplete: false
                };
                goals.goals.push(newGoal);
            } else {
                // Update existing goal
                if (update.isTarget) {
                    goals.goals[goalIndex].target = update.value;
                } else {
                    goals.goals[goalIndex].current = update.value;
                }
                goals.goals[goalIndex].isComplete = goals.goals[goalIndex].current >= goals.goals[goalIndex].target;
            }

            goals.updatedAt = Date.now();
            await this.updateStreamGoals(userId, goals);
            return true;
        } catch (error) {
            elizaLogger.error("Error updating goal progress:", {
                error: error instanceof Error ? error.message : String(error),
                userId,
                update
            });
            return false;
        }
    }

    /**
     * Start stream goals tracking
     */
    async startGoals(userId: string): Promise<boolean> {
        try {
            const goals = await this.getStreamGoals(userId);
            if (!goals) return false;

            goals.startTime = Date.now();
            goals.updatedAt = Date.now();

            await this.updateStreamGoals(userId, goals);
            return true;
        } catch (error) {
            elizaLogger.error("Error starting goals:", {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            return false;
        }
    }

    /**
     * End stream goals tracking
     */
    async endGoals(userId: string): Promise<boolean> {
        try {
            const goals = await this.getStreamGoals(userId);
            if (!goals) return false;

            goals.endTime = Date.now();
            goals.updatedAt = Date.now();

            await this.updateStreamGoals(userId, goals);
            return true;
        } catch (error) {
            elizaLogger.error("Error ending goals:", {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            return false;
        }
    }

    /**
     * Get goal setting instructions
     */
    getGoalInstructions(): string {
        return `To set stream goals, use one of these formats:
• "Set goal: [number] [type]" (e.g., "Set goal: 100 likes")
• "Goal for [type]: [number]" (e.g., "Goal for products: 20")
• "Target [number] [type]" (e.g., "Target 50 gifts")

Available goal types: likes, products, gifts, viewers
You can set multiple goals at once, separated by commas or "and".`;
    }

    /**
     * Get progress update instructions
     */
    getProgressInstructions(): string {
        return `To update progress, simply mention the current numbers:
• "We have [number] [type]" (e.g., "We have 50 likes")
• "Got [number] [type]" (e.g., "Got 10 products")
• "Reached [number] [type]" (e.g., "Reached 30 gifts")`;
    }

    /**
     * Format goals for display
     */
    formatGoals(goals: StreamGoals): string {
        if (!goals.goals.length) return "No goals set for this stream.";

        const lines = goals.goals.map(goal => {
            const progress = (goal.current / goal.target * 100).toFixed(0);
            const remaining = goal.target - goal.current;
            const status = goal.isComplete ? "✅" : remaining <= 5 ? "🔥" : "🎯";
            
            let line = `${status} ${goal.name}: ${goal.current}/${goal.target}`;
            if (!goal.isComplete) {
                line += ` (Need ${remaining} more!)`;
            }
            if (goal.reward && !goal.isComplete) {
                line += `\n   🎁 Reward: ${goal.reward}`;
            }
            return line;
        });

        return lines.join('\n');
    }

    /**
     * Get goals progress summary
     */
    getGoalsProgress(goals: StreamGoals): string {
        if (!goals.goals.length) return "No active goals.";

        const completed = goals.goals.filter(g => g.isComplete).length;
        const total = goals.goals.length;
        
        if (completed === total) {
            return "🎉 All goals achieved! Amazing work!";
        }

        const incomplete = goals.goals.filter(g => !g.isComplete)
            .map(g => {
                const remaining = g.target - g.current;
                return `${remaining} more ${g.name}`;
            });

        return `Still need: ${incomplete.join(', ')}`;
    }

    /**
     * Get conversation prompt based on goals status
     * Guides the agent on how to interact with viewers to achieve stream goals
     */
    getStatusPrompt(goals: StreamGoals): string {
        if (!goals.goals.length) {
            return "Current task:\n" +
                "- Listen for streamer's goal announcements\n" +
                "- Note target numbers for likes, products, or gifts\n" +
                "- Wait for streamer to confirm goals\n\n" +
                "Guidance:\n" +
                "- Pay attention to numbers mentioned by streamer\n" +
                "- Record any rewards or incentives mentioned";
        }

        const completed = goals.goals.filter(g => g.isComplete).length;
        const total = goals.goals.length;

        if (completed === total) {
            return "Current task:\n" +
                "- Announce goal completion to viewers\n" +
                "- Highlight top contributors\n" +
                "- Create celebration atmosphere\n\n" +
                "Guidance:\n" +
                "- Thank specific viewers who helped\n" +
                "- Share excitement about achievement\n" +
                "- Make viewers feel part of success";
        }

        // Calculate progress percentages for all goals
        const goalsWithProgress = goals.goals.map(g => ({
            ...g,
            percentage: (g.current / g.target * 100)
        }));

        // Goals over 80% completion are considered near completion
        const nearCompletion = goalsWithProgress.filter(g => 
            !g.isComplete && g.percentage >= 80
        );

        if (nearCompletion.length > 0) {
            const goalPrompts = nearCompletion.map(g => {
                const remaining = g.target - g.current;
                const message = `${g.name}: ${remaining} more to reach ${g.target}`;
                return g.reward ? `${message} (Reward: ${g.reward})` : message;
            });

            return "Current task:\n" +
                "- Generate excitement for nearly completed goals\n" +
                `- Focus on: ${goalPrompts.join(', ')}\n` +
                "- Highlight how close we are to rewards\n\n" +
                "Guidance:\n" +
                "- Call out progress after each contribution\n" +
                "- Thank viewers by name for helping\n" +
                "- Build momentum with milestone announcements";
        }

        // Find goals needing most attention (under 50% complete)
        const needsAttention = goalsWithProgress
            .filter(g => !g.isComplete && g.percentage < 50)
            .sort((a, b) => a.percentage - b.percentage)[0];

        if (needsAttention) {
            const remaining = needsAttention.target - needsAttention.current;
            
            return "Current task:\n" +
                `- Promote ${needsAttention.name} goal to viewers\n` +
                `- Current: ${needsAttention.current}/${needsAttention.target} (${needsAttention.percentage.toFixed(0)}%)\n` +
                "- Encourage viewer participation\n\n" +
                "Guidance:\n" +
                "- Welcome and thank new contributors\n" +
                "- Celebrate small progress steps\n" +
                "- Mention goal casually in conversations\n" +
                (needsAttention.reward ? `- Highlight reward: ${needsAttention.reward}\n` : "") +
                "- Create mini-challenges for viewers";
        }

        // Default case - steady progress (50-80% complete)
        return "Current task:\n" +
            "- Keep viewers updated on all goals\n" +
            "- Maintain steady progress\n" +
            "- Recognize active contributors\n\n" +
            "Guidance:\n" +
            "- Mix goal mentions with regular interaction\n" +
            "- Create excitement around milestones\n" +
            "- Keep viewers engaged with progress updates\n" +
            "- Thank contributors immediately";
    }

    /**
     * Format duration for display
     */
    private formatDuration(startTime?: number, endTime?: number): string {
        if (!startTime) return "Not started";
        
        const end = endTime || Date.now();
        const duration = end - startTime;
        const minutes = Math.floor(duration / 60000);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        }
        return `${minutes}m`;
    }

    /**
     * Update stream goals data
     */
    private async updateStreamGoals(userId: string, goals: StreamGoals): Promise<void> {
        try {
            const cacheKey = this.formatCacheKey(userId);
            await this.runtime.cacheManager.set(cacheKey, goals);

            elizaLogger.info("Updated stream goals", {
                userId,
                cacheKey,
                goals
            });
        } catch (error) {
            elizaLogger.error("Error updating stream goals:", {
                error: error instanceof Error ? error.message : String(error),
                userId,
                goals
            });
        }
    }
} 