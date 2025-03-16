import { UserData } from "./types";

/**
 * Conversation prompts for different scenarios
 */
export const CONVERSATION_PROMPTS = {
    /**
     * Generate natural conversation prompts based on current context
     */
    getName(userData: Partial<UserData>): string[] {
        const prompts = [
            "Nice to meet you! How should I address you?",
            "Could you tell me your name?",
            "Let's get to know each other. What's your name?"
        ];

        if (userData.location) {
            prompts.push(
                `It's great to live in ${userData.location}! Could you tell me how to address you?`,
                `${userData.location} is a great place! Let's get to know each other. What's your name?`
            );
        }

        if (userData.occupation) {
            prompts.push(
                `As a ${userData.occupation} must be interesting, Could you tell me your name?`,
                `${userData.occupation} is a great job! How should I address you?`
            );
        }

        return prompts;
    },

    getLocation(userData: Partial<UserData>): string[] {
        const prompts = [
            "Where do you usually go?",
            "Where do you work and live?",
            "Where do you live?"
        ];

        if (userData.name) {
            prompts.push(
                `${userData.name}，Where do you usually go?`,
                `${userData.name}，Where do you work and live?`,
                `${userData.name}，Where do you live?`
            );
        }

        if (userData.occupation) {
            prompts.push(
                `As a ${userData.occupation}, where do you work and live?`,
                `${userData.occupation} is a great job! Where do you work and live?`,
                `Many ${userData.occupation} work in big cities, where do you work and live?`
            );
        }

        return prompts;
    },

    getOccupation(userData: Partial<UserData>): string[] {
        const prompts = [
            "What do you do for a living?",
            "Can you tell me about your job?",
            "What do you do for a living?"
        ];

        if (userData.name) {
            prompts.push(
                `${userData.name}，What do you do for a living?`,
                `${userData.name}，Can you tell me about your job?`,
                `${userData.name}，What do you do for a living?`
            );
        }

        if (userData.location) {
            prompts.push(
                `In ${userData.location}, what do you do for a living?`,
                `${userData.location} has a lot of job opportunities, what do you do for a living?`,
                `${userData.location} is a great city, what do you do for a living?`
            );
        }

        return prompts;
    },

    /**
     * Get a random prompt for a specific field
     */
    getPrompt(field: 'name' | 'location' | 'occupation', userData: Partial<UserData>): string {
        const promptMap = {
            name: this.getName,
            location: this.getLocation,
            occupation: this.getOccupation
        };

        const prompts = promptMap[field](userData);
        return prompts[Math.floor(Math.random() * prompts.length)];
    }
}; 