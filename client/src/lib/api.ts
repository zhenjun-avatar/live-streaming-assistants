import type { UUID, Character, Content } from "@elizaos/core";

// Define the ContentWithUser type to match what's expected in chat.tsx
interface ExtraContentFields {
    user: string;
    createdAt: number;
    isLoading?: boolean;
}

type ContentWithUser = Content & ExtraContentFields;

// Define interface for creating a new agent
interface CreateAgentParams {
    name: string;
    username?: string;
    bio: string | string[];
    lore?: string[];
    modelProvider: string;
    imageModelProvider?: string;
    system?: string;
    style?: {
        all?: string[];
        chat?: string[];
        post?: string[];
    };
    topics?: string[];
    adjectives?: string[];
    plugins?: string[];
}

// Define interface for updating an agent
interface UpdateAgentParams {
    id: UUID;
    name?: string;
    username?: string;
    bio?: string | string[];
    lore?: string[];
    modelProvider?: string;
    imageModelProvider?: string;
    system?: string;
    style?: {
        all?: string[];
        chat?: string[];
        post?: string[];
    };
    topics?: string[];
    adjectives?: string[];
    plugins?: string[];
}

const BASE_URL =
    import.meta.env.VITE_SERVER_BASE_URL ||
    `${import.meta.env.VITE_SERVER_URL}:${import.meta.env.VITE_SERVER_PORT}`;

console.log({ BASE_URL });

// Define agent mapping for consistent lookup
const AGENT_MAPPING: Record<string, string> = {
    "12dea96f-ec20-0935-a6ab-75692c994959": "Snoop",
    "e61b079d-5226-06e9-9763-a33094aa8d82": "Garfield"
};

// Helper function to get agent name from ID
const getAgentName = (agentId: string): string => {
    return AGENT_MAPPING[agentId] || agentId;
};

const fetcher = async ({
    url,
    method,
    body,
    headers,
}: {
    url: string;
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: object | FormData;
    headers?: HeadersInit;
}) => {
    const options: RequestInit = {
        method: method ?? "GET",
        headers: headers
            ? headers
            : {
                  Accept: "application/json",
                  "Content-Type": "application/json",
              },
    };

    if (method === "POST" || method === "PUT") {
        if (body instanceof FormData) {
            if (options.headers && typeof options.headers === "object") {
                // Create new headers object without Content-Type
                options.headers = Object.fromEntries(
                    Object.entries(
                        options.headers as Record<string, string>
                    ).filter(([key]) => key !== "Content-Type")
                );
            }
            options.body = body;
        } else {
            options.body = JSON.stringify(body);
        }
    }

    return fetch(`${BASE_URL}${url}`, options).then(async (resp) => {
        const contentType = resp.headers.get("Content-Type");
        if (contentType === "audio/mpeg") {
            return await resp.blob();
        }

        if (!resp.ok) {
            const errorText = await resp.text();
            console.error("Error: ", errorText);

            let errorMessage = "An error occurred.";
            try {
                const errorObj = JSON.parse(errorText);
                errorMessage = errorObj.message || errorMessage;
            } catch {
                errorMessage = errorText || errorMessage;
            }

            throw new Error(errorMessage);
        }

        return resp.json();
    });
};

export const apiClient = {
    async sendMessage(
        agentId: UUID | string,
        message: string,
        selectedFile?: File | null,
        mentionedAgents: string[] = []
    ): Promise<ContentWithUser[]> {
        console.log("Sending message to agent:", { agentId, message, mentionedAgents });
        
        const formData = new FormData();
        formData.append("text", message);
        formData.append("user", "user");

        if (selectedFile) {
            formData.append("file", selectedFile);
        }
        if (mentionedAgents.length) {
            formData.append("mentionedAgents", JSON.stringify(mentionedAgents));
        }

        // Send message to the first mentioned agent or default to the provided agentId
        const targetAgentId = mentionedAgents[0] || agentId;
        const targetName = getAgentName(targetAgentId);
        
        // Log the endpoint we're trying to use
        console.log(`Sending message to endpoint: ${BASE_URL}/${targetName}/message`);

        return fetcher({
            url: `/${targetName}/message`,
            method: "POST",
            body: formData,
        });
    },
    getAgents: () => fetcher({ url: "/agents" }),
    getAgent: (agentId: string): Promise<{ id: UUID; character: Character }> =>
        fetcher({ url: `/agents/${agentId}` }),
    tts: (agentId: UUID | string, text: string) => {
        const targetName = getAgentName(agentId);
        
        return fetcher({
            url: `/${targetName}/tts`,
            method: "POST",
            body: {
                text,
            },
            headers: {
                "Content-Type": "application/json",
                Accept: "audio/mpeg",
                "Transfer-Encoding": "chunked",
            },
        });
    },
    whisper: async (agentId: UUID | string, audioBlob: Blob) => {
        const formData = new FormData();
        formData.append("file", audioBlob, "recording.wav");
        
        const targetName = getAgentName(agentId);
        
        return fetcher({
            url: `/${targetName}/whisper`,
            method: "POST",
            body: formData,
        });
    },
    
    // New agent management API functions
    
    // Create a new agent
    createAgent: (params: CreateAgentParams) => {
        return fetcher({
            url: `/agents`,
            method: "POST",
            body: {
                ...params,
                // Ensure required fields have defaults if not provided
                lore: params.lore || [],
                style: params.style || {
                    all: [],
                    chat: [],
                    post: []
                },
                topics: params.topics || [],
                adjectives: params.adjectives || [],
                plugins: params.plugins || []
            }
        });
    },
    
    // Update an existing agent
    updateAgent: (params: UpdateAgentParams) => {
        return fetcher({
            url: `/agents/${params.id}`,
            method: "PUT",
            body: params
        });
    },
    
    // Delete an agent
    deleteAgent: (agentId: UUID) => {
        return fetcher({
            url: `/agents/${agentId}`,
            method: "DELETE"
        });
    },
    
    // Clone an existing agent
    cloneAgent: (agentId: UUID, newName: string) => {
        return fetcher({
            url: `/agents/${agentId}/clone`,
            method: "POST",
            body: {
                name: newName
            }
        });
    },
    
    // Get available plugins for agents
    getPlugins: () => {
        return fetcher({
            url: `/plugins`
        });
    },
    
    // Get conversation history with an agent
    getConversationHistory: (agentId: UUID, roomId?: UUID, limit: number = 50, offset: number = 0) => {
        const targetName = getAgentName(agentId);
        let url = `/${targetName}/history?limit=${limit}&offset=${offset}`;
        
        if (roomId) {
            url += `&roomId=${roomId}`;
        }
        
        return fetcher({ url });
    },
    
    // Create a new room
    createRoom: (participants: UUID[] = []) => {
        return fetcher({
            url: `/rooms`,
            method: "POST",
            body: {
                participants
            }
        });
    },
    
    // Get rooms for a user
    getRooms: () => {
        return fetcher({
            url: `/rooms`
        });
    },
    
    // Get specific room details
    getRoom: (roomId: UUID) => {
        return fetcher({
            url: `/rooms/${roomId}`
        });
    },
    
    // Add agent to room
    addAgentToRoom: (agentId: UUID, roomId: UUID) => {
        return fetcher({
            url: `/rooms/${roomId}/participants`,
            method: "POST",
            body: {
                participantId: agentId
            }
        });
    },
    
    // Remove agent from room
    removeAgentFromRoom: (agentId: UUID, roomId: UUID) => {
        return fetcher({
            url: `/rooms/${roomId}/participants/${agentId}`,
            method: "DELETE"
        });
    },
    
    // Upload knowledge to an agent
    uploadKnowledge: (agentId: UUID, file: File, isShared: boolean = false) => {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("isShared", isShared.toString());
        
        const targetName = getAgentName(agentId);
        
        return fetcher({
            url: `/${targetName}/knowledge`,
            method: "POST",
            body: formData
        });
    },
    
    // Get knowledge associated with an agent
    getKnowledge: (agentId: UUID, limit: number = 50, offset: number = 0) => {
        const targetName = getAgentName(agentId);
        
        return fetcher({
            url: `/${targetName}/knowledge?limit=${limit}&offset=${offset}`
        });
    },
    
    // Delete specific knowledge item
    deleteKnowledge: (agentId: UUID, knowledgeId: UUID) => {
        const targetName = getAgentName(agentId);
        
        return fetcher({
            url: `/${targetName}/knowledge/${knowledgeId}`,
            method: "DELETE"
        });
    },
    
    // Get agent model providers
    getModelProviders: () => {
        return fetcher({
            url: `/model-providers`
        });
    },
    
    // Get agent templates
    getAgentTemplates: () => {
        return fetcher({
            url: `/agent-templates`
        });
    },
    
    // Create agent from template
    createAgentFromTemplate: (templateId: string, customizations: Partial<CreateAgentParams> = {}) => {
        return fetcher({
            url: `/agent-templates/${templateId}/create`,
            method: "POST",
            body: customizations
        });
    },

    // Create a template from an existing agent
    createTemplateFromAgent: (agentId: UUID, params: {
        name: string;
        description?: string;
        isPublic?: boolean;
        category?: string;
    }) => {
        return fetcher({
            url: `/agent-templates/from-agent/${agentId}`,
            method: "POST",
            body: params
        });
    },

    // Update an existing template
    updateTemplate: (templateId: string, updates: {
        name?: string;
        description?: string;
        bio?: string | string[];
        lore?: string[];
        modelProvider?: string;
        imageModelProvider?: string;
        system?: string;
        style?: {
            all?: string[];
            chat?: string[];
            post?: string[];
        };
        topics?: string[];
        adjectives?: string[];
        category?: string;
        isPublic?: boolean;
    }) => {
        return fetcher({
            url: `/agent-templates/${templateId}`,
            method: "PUT",
            body: updates
        });
    },

    // Delete a template
    deleteTemplate: (templateId: string) => {
        return fetcher({
            url: `/agent-templates/${templateId}`,
            method: "DELETE"
        });
    },

    // Get templates by category
    getTemplatesByCategory: (category: string = 'all') => {
        return fetcher({
            url: `/agent-templates/categories/${category}`
        });
    },

    // Get all template categories
    getTemplateCategories: () => {
        return fetcher({
            url: `/agent-templates/categories`
        });
    },

    // Export a template
    exportTemplate: (templateId: string) => {
        // Use direct window.open for file download
        window.open(`${BASE_URL}/agent-templates/${templateId}/export`);
        return Promise.resolve({ success: true });
    },

    // Import a template
    importTemplate: (file: File, overwrite: boolean = false) => {
        const formData = new FormData();
        formData.append("file", file);
        
        if (overwrite) {
            formData.append("overwrite", "true");
        }
        
        return fetcher({
            url: `/agent-templates/import`,
            method: "POST",
            body: formData
        });
    },

    // Batch operations

    // Clone multiple agents at once
    batchCloneAgents: (agents: Array<{agentId: UUID, newName: string}>) => {
        return fetcher({
            url: `/agents/batch-clone`,
            method: "POST",
            body: {
                agents
            }
        });
    },

    // Export multiple agents as templates
    batchExportAgentsAsTemplates: (agents: Array<{
        agentId: UUID, 
        templateName?: string,
        category?: string
    }>) => {
        return fetcher({
            url: `/agent-templates/batch-export`,
            method: "POST",
            body: {
                agents
            }
        });
    }
};
