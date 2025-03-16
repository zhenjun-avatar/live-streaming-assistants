import type { UUID, Character, Content } from "@elizaos/core";

// Define the ContentWithUser type to match what's expected in chat.tsx
interface ExtraContentFields {
    user: string;
    createdAt: number;
    isLoading?: boolean;
}

type ContentWithUser = Content & ExtraContentFields;

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
    method?: "GET" | "POST";
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

    if (method === "POST") {
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
};
