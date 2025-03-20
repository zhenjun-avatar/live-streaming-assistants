import express from "express";
import type { Router } from 'express';
import multer from "multer";
import fs from "fs";
import path from "path";
// Use core UUID type and functions instead of external uuid package
// import { v4 as uuidv4 } from "uuid";

import {
    type AgentRuntime,
    elizaLogger,
    type UUID,
    validateCharacterConfig,
    type Character,
    type Plugin,
    type Content,
    ModelProviderName,
    stringToUuid,
    type IAgentRuntime, // Import IAgentRuntime type
} from "@elizaos/core";

import type { DirectClient } from ".";
import { validateUuid } from "@elizaos/core";

// Set up file storage for knowledge uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), "data", "knowledge");
        // Create the directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${uniqueSuffix}-${file.originalname}`);
    },
});

const upload = multer({ storage });

interface UUIDParams {
    agentId?: UUID;
    roomId?: UUID;
    knowledgeId?: UUID;
}

function validateUUIDParams(
    params: { agentId?: string; roomId?: string; knowledgeId?: string },
    res: express.Response
): UUIDParams | null {
    const result: UUIDParams = {};

    if (params.agentId) {
        const agentId = validateUuid(params.agentId);
        if (!agentId) {
            res.status(400).json({
                error: "Invalid AgentId format. Expected to be a UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
            });
            return null;
        }
        result.agentId = agentId;
    }

    if (params.roomId) {
        const roomId = validateUuid(params.roomId);
        if (!roomId) {
            res.status(400).json({
                error: "Invalid RoomId format. Expected to be a UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
            });
            return null;
        }
        result.roomId = roomId;
    }

    if (params.knowledgeId) {
        const knowledgeId = validateUuid(params.knowledgeId);
        if (!knowledgeId) {
            res.status(400).json({
                error: "Invalid KnowledgeId format. Expected to be a UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
            });
            return null;
        }
        result.knowledgeId = knowledgeId;
    }

    return result;
}

// Basic validation for agent creation parameters
function validateAgentParams(agent: any, res: express.Response): boolean {
    if (!agent.name) {
        res.status(400).json({ error: "Agent name is required" });
        return false;
    }

    if (!agent.bio) {
        res.status(400).json({ error: "Agent bio is required" });
        return false;
    }

    if (!agent.modelProvider) {
        res.status(400).json({ error: "Model provider is required" });
        return false;
    }

    return true;
}

export function createAgentManagementRouter(
    agents: Map<string, IAgentRuntime | AgentRuntime>,
    directClient: DirectClient
): Router {
    const router = express.Router();

    // Get all available plugins
    router.get("/plugins", (req, res) => {
        try {
            // Get unique plugins from all agents
            const uniquePlugins = new Map<string, Plugin>();
            
            Array.from(agents.values()).forEach(agent => {
                agent.plugins.forEach(plugin => {
                    if (!uniquePlugins.has(plugin.name)) {
                        uniquePlugins.set(plugin.name, plugin);
                    }
                });
            });
            
            const pluginsList = Array.from(uniquePlugins.values()).map(plugin => ({
                name: plugin.name,
                description: plugin.description,
                npmName: plugin.npmName,
            }));
            
            res.json({ plugins: pluginsList });
        } catch (error) {
            elizaLogger.error(`Error getting plugins: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Get model providers
    router.get("/model-providers", (req, res) => {
        try {
            // Return a list of all available model providers from the enum
            const providers = Object.values(ModelProviderName);
            res.json({ providers });
        } catch (error) {
            elizaLogger.error(`Error getting model providers: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Create a new agent
    router.post("/agents", async (req, res) => {
        try {
            const agentParams = req.body;
            
            if (!validateAgentParams(agentParams, res)) {
                return;
            }

            // Create a basic character object
            const character: Character = {
                // Generate UUID using core function instead of external uuid package
                id: stringToUuid(Date.now().toString()),
                name: agentParams.name,
                username: agentParams.username || agentParams.name.toLowerCase().replace(/\s+/g, '_'),
                bio: agentParams.bio,
                lore: agentParams.lore || [],
                modelProvider: agentParams.modelProvider as ModelProviderName,
                imageModelProvider: agentParams.imageModelProvider as ModelProviderName,
                system: agentParams.system || "",
                messageExamples: [],
                postExamples: [],
                topics: agentParams.topics || [],
                adjectives: agentParams.adjectives || [],
                plugins: [],
                style: agentParams.style || {
                    all: [],
                    chat: [],
                    post: []
                }
            };

            try {
                validateCharacterConfig(character);
            } catch (e) {
                elizaLogger.error(`Error validating character: ${e}`);
                res.status(400).json({ error: e.message });
                return;
            }

            // Start the agent
            const agent = await directClient.startAgent(character);
            
            // Save the character to storage if enabled
            if (process.env.USE_CHARACTER_STORAGE === "true") {
                try {
                    const filename = `${agent.agentId}.json`;
                    const uploadDir = path.join(process.cwd(), "data", "characters");
                    const filepath = path.join(uploadDir, filename);
                    
                    await fs.promises.mkdir(uploadDir, { recursive: true });
                    await fs.promises.writeFile(filepath, JSON.stringify(character, null, 2));
                    
                    elizaLogger.info(`Agent ${character.name} saved to storage`);
                } catch (e) {
                    elizaLogger.error(`Error saving character to storage: ${e}`);
                }
            }

            res.status(201).json({
                id: agent.agentId,
                name: character.name,
                character: character
            });
        } catch (error) {
            elizaLogger.error(`Error creating agent: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Update an existing agent
    router.put("/agents/:agentId", async (req, res) => {
        const params = validateUUIDParams(req.params, res);
        if (!params || !params.agentId) return;

        try {
            const updateParams = req.body;
            const existingAgent = agents.get(params.agentId);

            if (!existingAgent) {
                res.status(404).json({ error: "Agent not found" });
                return;
            }

            // Create a new character config based on the existing one
            const updatedCharacter: Character = { ...existingAgent.character };
            
            // Update fields
            if (updateParams.name) updatedCharacter.name = updateParams.name;
            if (updateParams.username) updatedCharacter.username = updateParams.username;
            if (updateParams.bio) updatedCharacter.bio = updateParams.bio;
            if (updateParams.lore) updatedCharacter.lore = updateParams.lore;
            if (updateParams.modelProvider) updatedCharacter.modelProvider = updateParams.modelProvider as ModelProviderName;
            if (updateParams.imageModelProvider) updatedCharacter.imageModelProvider = updateParams.imageModelProvider as ModelProviderName;
            if (updateParams.system) updatedCharacter.system = updateParams.system;
            if (updateParams.style) updatedCharacter.style = updateParams.style;
            if (updateParams.topics) updatedCharacter.topics = updateParams.topics;
            if (updateParams.adjectives) updatedCharacter.adjectives = updateParams.adjectives;
            if (updateParams.plugins) {
                // Handle plugins separately - would need actual plugin initialization
                // This is simplistic - in reality you'd need to load actual plugin instances
                updatedCharacter.plugins = updatedCharacter.plugins || [];
            }

            try {
                validateCharacterConfig(updatedCharacter);
            } catch (e) {
                elizaLogger.error(`Error validating updated character: ${e}`);
                res.status(400).json({ error: e.message });
                return;
            }

            // Stop the existing agent
            if ('stop' in existingAgent) {
                (existingAgent as AgentRuntime).stop();
            }
            directClient.unregisterAgent(existingAgent as AgentRuntime);

            // Start a new agent with updated character
            const updatedAgent = await directClient.startAgent(updatedCharacter);

            // Save updated character to storage if enabled
            if (process.env.USE_CHARACTER_STORAGE === "true") {
                try {
                    const filename = `${updatedAgent.agentId}.json`;
                    const uploadDir = path.join(process.cwd(), "data", "characters");
                    const filepath = path.join(uploadDir, filename);
                    
                    await fs.promises.mkdir(uploadDir, { recursive: true });
                    await fs.promises.writeFile(filepath, JSON.stringify(updatedCharacter, null, 2));
                    
                    elizaLogger.info(`Updated agent ${updatedCharacter.name} saved to storage`);
                } catch (e) {
                    elizaLogger.error(`Error saving updated character to storage: ${e}`);
                }
            }

            res.json({
                id: updatedAgent.agentId,
                name: updatedCharacter.name,
                character: updatedCharacter
            });
        } catch (error) {
            elizaLogger.error(`Error updating agent: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Clone an existing agent
    router.post("/agents/:agentId/clone", async (req, res) => {
        const params = validateUUIDParams(req.params, res);
        if (!params || !params.agentId) return;

        try {
            const { name } = req.body;
            
            if (!name) {
                res.status(400).json({ error: "New name is required for cloned agent" });
                return;
            }

            const existingAgent = agents.get(params.agentId);

            if (!existingAgent) {
                res.status(404).json({ error: "Agent not found" });
                return;
            }

            // Clone the character with a new ID and name
            const clonedCharacter: Character = {
                ...existingAgent.character,
                id: stringToUuid(Date.now().toString()),
                name: name
            };

            try {
                validateCharacterConfig(clonedCharacter);
            } catch (e) {
                elizaLogger.error(`Error validating cloned character: ${e}`);
                res.status(400).json({ error: e.message });
                return;
            }

            // Start a new agent with cloned character
            const clonedAgent = await directClient.startAgent(clonedCharacter);

            // Save cloned character to storage if enabled
            if (process.env.USE_CHARACTER_STORAGE === "true") {
                try {
                    const filename = `${clonedAgent.agentId}.json`;
                    const uploadDir = path.join(process.cwd(), "data", "characters");
                    const filepath = path.join(uploadDir, filename);
                    
                    await fs.promises.mkdir(uploadDir, { recursive: true });
                    await fs.promises.writeFile(filepath, JSON.stringify(clonedCharacter, null, 2));
                    
                    elizaLogger.info(`Cloned agent ${clonedCharacter.name} saved to storage`);
                } catch (e) {
                    elizaLogger.error(`Error saving cloned character to storage: ${e}`);
                }
            }

            res.status(201).json({
                id: clonedAgent.agentId,
                name: clonedCharacter.name,
                character: clonedCharacter
            });
        } catch (error) {
            elizaLogger.error(`Error cloning agent: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Get agent templates
    router.get("/agent-templates", async (req, res) => {
        try {
            const templatesDir = path.join(process.cwd(), "data", "templates");
            
            // Create directory if it doesn't exist
            if (!fs.existsSync(templatesDir)) {
                await fs.promises.mkdir(templatesDir, { recursive: true });
                res.json({ templates: [] });
                return;
            }
            
            const templateFiles = await fs.promises.readdir(templatesDir);
            const templates = [];
            
            for (const file of templateFiles) {
                if (file.endsWith('.json')) {
                    try {
                        const templatePath = path.join(templatesDir, file);
                        const templateContent = await fs.promises.readFile(templatePath, 'utf8');
                        const template = JSON.parse(templateContent);
                        
                        templates.push({
                            id: template.id || path.basename(file, '.json'),
                            name: template.name,
                            description: template.description || `Template for ${template.name}`,
                            modelProvider: template.modelProvider,
                            imageUrl: template.imageUrl || null
                        });
                    } catch (e) {
                        elizaLogger.error(`Error reading template ${file}: ${e}`);
                    }
                }
            }
            
            res.json({ templates });
        } catch (error) {
            elizaLogger.error(`Error getting agent templates: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Create agent from template
    router.post("/agent-templates/:templateId/create", async (req, res) => {
        try {
            const { templateId } = req.params;
            const customizations = req.body;
            
            const templatePath = path.join(process.cwd(), "data", "templates", `${templateId}.json`);
            
            if (!fs.existsSync(templatePath)) {
                res.status(404).json({ error: "Template not found" });
                return;
            }
            
            // Read the template
            const templateContent = await fs.promises.readFile(templatePath, 'utf8');
            const templateCharacter = JSON.parse(templateContent);
            
            // Create a new character based on the template and customizations
            const newCharacter: Character = {
                ...templateCharacter,
                id: stringToUuid(Date.now().toString()),
                // Apply customizations
                name: customizations.name || templateCharacter.name,
                username: customizations.username || templateCharacter.username,
                bio: customizations.bio || templateCharacter.bio,
                lore: customizations.lore || templateCharacter.lore || [],
                modelProvider: customizations.modelProvider || templateCharacter.modelProvider,
                imageModelProvider: customizations.imageModelProvider || templateCharacter.imageModelProvider,
                system: customizations.system || templateCharacter.system || "",
                style: customizations.style || templateCharacter.style,
                topics: customizations.topics || templateCharacter.topics || [],
                adjectives: customizations.adjectives || templateCharacter.adjectives || []
            };
            
            try {
                validateCharacterConfig(newCharacter);
            } catch (e) {
                elizaLogger.error(`Error validating template-based character: ${e}`);
                res.status(400).json({ error: e.message });
                return;
            }
            
            // Start the agent
            const agent = await directClient.startAgent(newCharacter);
            
            // Save to storage if enabled
            if (process.env.USE_CHARACTER_STORAGE === "true") {
                try {
                    const filename = `${agent.agentId}.json`;
                    const uploadDir = path.join(process.cwd(), "data", "characters");
                    const filepath = path.join(uploadDir, filename);
                    
                    await fs.promises.mkdir(uploadDir, { recursive: true });
                    await fs.promises.writeFile(filepath, JSON.stringify(newCharacter, null, 2));
                    
                    elizaLogger.info(`Template-based agent ${newCharacter.name} saved to storage`);
                } catch (e) {
                    elizaLogger.error(`Error saving template-based character to storage: ${e}`);
                }
            }
            
            res.status(201).json({
                id: agent.agentId,
                name: newCharacter.name,
                character: newCharacter
            });
        } catch (error) {
            elizaLogger.error(`Error creating agent from template: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Get conversation history
    router.get("/:agentId/history", async (req, res) => {
        const params = validateUUIDParams(req.params, res);
        if (!params || !params.agentId) return;

        try {
            const roomId = req.query.roomId ? validateUuid(req.query.roomId as string) : undefined;
            const limit = parseInt(req.query.limit as string) || 50;
            const offset = parseInt(req.query.offset as string) || 0;
            
            const agent = agents.get(params.agentId);
            
            if (!agent) {
                res.status(404).json({ error: "Agent not found" });
                return;
            }
            
            // Get memories for this agent
            const memories = await agent.messageManager.getMemories({
                roomId: roomId || agent.messageManager.runtime.agentId,
                count: limit,
                unique: false,
                start: offset,
                end: offset + limit
            });
            
            // Format the response
            const messages = memories.map(memory => {
                return {
                    id: memory.id,
                    user: memory.userId === agent.agentId ? agent.character.name : "user",
                    text: memory.content.text,
                    createdAt: memory.createdAt,
                    attachments: memory.content.attachments || [],
                    action: memory.content.action,
                    roomId: memory.roomId
                };
            });
            
            res.json({ messages });
        } catch (error) {
            elizaLogger.error(`Error getting conversation history: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Upload knowledge to agent
    router.post("/:agentId/knowledge", upload.single('file'), async (req, res) => {
        const params = validateUUIDParams(req.params, res);
        if (!params || !params.agentId) return;

        try {
            const file = req.file;
            const isShared = req.body.isShared === 'true';
            
            if (!file) {
                res.status(400).json({ error: "No file provided" });
                return;
            }
            
            const agent = agents.get(params.agentId);
            
            if (!agent) {
                res.status(404).json({ error: "Agent not found" });
                return;
            }
            
            // Check file type
            const fileExt = path.extname(file.originalname).toLowerCase();
            if (!['.txt', '.md', '.pdf'].includes(fileExt)) {
                res.status(400).json({ error: "Only .txt, .md, and .pdf files are supported" });
                return;
            }
            
            // Process the file with the appropriate knowledge manager
            const filePath = file.path;
            const fileContent = fileExt === '.pdf' 
                ? "PDF content - needs PDF service to extract" // In real implementation, use PDF service
                : await fs.promises.readFile(filePath, 'utf8');
            
            // Get file type for ragKnowledgeManager
            const fileType = fileExt === '.pdf' ? 'pdf' : fileExt === '.md' ? 'md' : 'txt';
            
            // Process the file
            await agent.ragKnowledgeManager.processFile({
                path: filePath,
                content: fileContent,
                type: fileType as any,
                isShared: isShared
            });
            
            // Return success
            res.status(201).json({ 
                success: true,
                fileName: file.originalname,
                id: path.basename(file.path),
                isShared: isShared
            });
        } catch (error) {
            elizaLogger.error(`Error uploading knowledge: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Get knowledge for agent
    router.get("/:agentId/knowledge", async (req, res) => {
        const params = validateUUIDParams(req.params, res);
        if (!params || !params.agentId) return;

        try {
            const limit = parseInt(req.query.limit as string) || 50;
            const offset = parseInt(req.query.offset as string) || 0;
            
            const agent = agents.get(params.agentId);
            
            if (!agent) {
                res.status(404).json({ error: "Agent not found" });
                return;
            }
            
            // Get knowledge items
            const knowledge = await agent.ragKnowledgeManager.getKnowledge({
                agentId: agent.agentId,
                limit: limit
            });
            
            // Format the response
            const items = knowledge.map(item => {
                return {
                    id: item.id,
                    text: item.content.text,
                    isShared: item.content.metadata?.isShared || false,
                    createdAt: item.createdAt,
                    source: item.content.metadata?.source || "unknown"
                };
            });
            
            res.json({ items });
        } catch (error) {
            elizaLogger.error(`Error getting knowledge: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Delete knowledge
    router.delete("/:agentId/knowledge/:knowledgeId", async (req, res) => {
        const params = validateUUIDParams({
            agentId: req.params.agentId,
            knowledgeId: req.params.knowledgeId
        }, res);
        
        if (!params || !params.agentId || !params.knowledgeId) return;

        try {
            const agent = agents.get(params.agentId);
            
            if (!agent) {
                res.status(404).json({ error: "Agent not found" });
                return;
            }
            
            // Remove the knowledge item
            await agent.ragKnowledgeManager.removeKnowledge(params.knowledgeId);
            
            res.status(204).send();
        } catch (error) {
            elizaLogger.error(`Error deleting knowledge: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Create a room
    router.post("/rooms", async (req, res) => {
        try {
            const { participants } = req.body;
            
            // Generate a new UUID for the room
            const roomId = stringToUuid(Date.now().toString());
            
            // Create the room in database
            for (const agent of agents.values()) {
                await agent.ensureRoomExists(roomId);
                break; // Just need one agent to create the room
            }
            
            // Add participants if specified
            if (participants && Array.isArray(participants)) {
                for (const participantId of participants) {
                    const validId = validateUuid(participantId);
                    if (validId) {
                        const agent = agents.get(validId);
                        if (agent) {
                            await agent.ensureParticipantInRoom(validId, roomId);
                        }
                    }
                }
            }
            
            res.status(201).json({ id: roomId });
        } catch (error) {
            elizaLogger.error(`Error creating room: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Get all rooms
    router.get("/rooms", async (req, res) => {
        try {
            // Get rooms from any agent's database
            let roomsData = [];
            
            for (const agent of agents.values()) {
                const database = agent.databaseAdapter;
                
                // Get all rooms - this would need actual implementation in a real system
                // In a real implementation, you'd query the database directly
                // Since we don't have a direct method to get all rooms, this is a placeholder
                
                // For now, return a minimal response
                roomsData = [{
                    id: "room-placeholder",
                    participants: []
                }];
                
                break; // Just use the first agent's database
            }
            
            res.json({ rooms: roomsData });
        } catch (error) {
            elizaLogger.error(`Error getting rooms: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Get room details
    router.get("/rooms/:roomId", async (req, res) => {
        const params = validateUUIDParams(req.params, res);
        if (!params || !params.roomId) return;

        try {
            // Find room details from any agent's database
            let roomData = null;
            let participantIds = [];
            
            for (const agent of agents.values()) {
                const database = agent.databaseAdapter;
                
                // Check if room exists
                const foundRoom = await database.getRoom(params.roomId);
                
                if (foundRoom) {
                    // Get participants
                    participantIds = await database.getParticipantsForRoom(params.roomId);
                    
                    roomData = {
                        id: params.roomId,
                        participants: participantIds
                    };
                    
                    break;
                }
            }
            
            if (!roomData) {
                res.status(404).json({ error: "Room not found" });
                return;
            }
            
            res.json(roomData);
        } catch (error) {
            elizaLogger.error(`Error getting room details: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Add participant to room
    router.post("/rooms/:roomId/participants", async (req, res) => {
        const params = validateUUIDParams(req.params, res);
        if (!params || !params.roomId) return;

        try {
            const { participantId } = req.body;
            
            if (!participantId) {
                res.status(400).json({ error: "Participant ID is required" });
                return;
            }
            
            const validParticipantId = validateUuid(participantId);
            if (!validParticipantId) {
                res.status(400).json({ error: "Invalid participant ID format" });
                return;
            }
            
            // Add participant to room
            let success = false;
            
            for (const agent of agents.values()) {
                // First ensure room exists
                await agent.ensureRoomExists(params.roomId);
                
                // Then add participant
                success = await agent.databaseAdapter.addParticipant(validParticipantId, params.roomId);
                break;
            }
            
            if (!success) {
                res.status(500).json({ error: "Failed to add participant to room" });
                return;
            }
            
            res.status(201).json({ success: true });
        } catch (error) {
            elizaLogger.error(`Error adding participant to room: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Remove participant from room
    router.delete("/rooms/:roomId/participants/:participantId", async (req, res) => {
        const params = validateUUIDParams({
            roomId: req.params.roomId,
            agentId: req.params.participantId
        }, res);
        
        if (!params || !params.roomId || !params.agentId) return;

        try {
            // Remove participant from room
            let success = false;
            
            for (const agent of agents.values()) {
                success = await agent.databaseAdapter.removeParticipant(params.agentId, params.roomId);
                break;
            }
            
            if (!success) {
                res.status(500).json({ error: "Failed to remove participant from room" });
                return;
            }
            
            res.status(204).send();
        } catch (error) {
            elizaLogger.error(`Error removing participant from room: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Create a template from an existing agent
    router.post("/agent-templates/from-agent/:agentId", async (req, res) => {
        const params = validateUUIDParams(req.params, res);
        if (!params || !params.agentId) return;

        try {
            const { name, description, isPublic, category } = req.body;
            
            if (!name) {
                res.status(400).json({ error: "Template name is required" });
                return;
            }

            // Generate template ID from name
            const templateId = name.toLowerCase().replace(/\s+/g, '-') + '-template';
            
            // Get the existing agent
            const existingAgent = agents.get(params.agentId);
            if (!existingAgent) {
                res.status(404).json({ error: "Agent not found" });
                return;
            }

            // Create a template based on the agent's character
            const template = {
                id: templateId,
                name: name,
                username: existingAgent.character.username,
                description: description || `Template based on ${existingAgent.character.name}`,
                bio: existingAgent.character.bio,
                lore: existingAgent.character.lore || [],
                modelProvider: existingAgent.character.modelProvider,
                imageModelProvider: existingAgent.character.imageModelProvider,
                system: existingAgent.character.system || "",
                messageExamples: existingAgent.character.messageExamples || [],
                postExamples: existingAgent.character.postExamples || [],
                style: existingAgent.character.style || {
                    all: [],
                    chat: [],
                    post: []
                },
                topics: existingAgent.character.topics || [],
                adjectives: existingAgent.character.adjectives || [],
                category: category || "general",
                isPublic: isPublic === true,
                createdAt: Date.now()
            };

            // Save the template to a file
            const templatesDir = path.join(process.cwd(), "data", "templates");
            await fs.promises.mkdir(templatesDir, { recursive: true });
            
            const templatePath = path.join(templatesDir, `${templateId}.json`);
            await fs.promises.writeFile(templatePath, JSON.stringify(template, null, 2));
            
            res.status(201).json({
                success: true,
                templateId: templateId,
                template: template
            });
        } catch (error) {
            elizaLogger.error(`Error creating template from agent: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Update an existing template
    router.put("/agent-templates/:templateId", async (req, res) => {
        try {
            const { templateId } = req.params;
            const updates = req.body;
            
            const templatePath = path.join(process.cwd(), "data", "templates", `${templateId}.json`);
            
            if (!fs.existsSync(templatePath)) {
                res.status(404).json({ error: "Template not found" });
                return;
            }
            
            // Read the existing template
            const templateContent = await fs.promises.readFile(templatePath, 'utf8');
            const existingTemplate = JSON.parse(templateContent);
            
            // Apply updates
            const updatedTemplate = {
                ...existingTemplate,
                ...updates,
                // Preserve the original ID
                id: existingTemplate.id,
                // Update modifiedAt timestamp
                modifiedAt: Date.now()
            };
            
            // Write back to file
            await fs.promises.writeFile(templatePath, JSON.stringify(updatedTemplate, null, 2));
            
            res.json({
                success: true,
                templateId: templateId,
                template: updatedTemplate
            });
        } catch (error) {
            elizaLogger.error(`Error updating template: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Delete a template
    router.delete("/agent-templates/:templateId", async (req, res) => {
        try {
            const { templateId } = req.params;
            
            const templatePath = path.join(process.cwd(), "data", "templates", `${templateId}.json`);
            
            if (!fs.existsSync(templatePath)) {
                res.status(404).json({ error: "Template not found" });
                return;
            }
            
            // Delete the template file
            await fs.promises.unlink(templatePath);
            
            res.status(204).send();
        } catch (error) {
            elizaLogger.error(`Error deleting template: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Get templates by category
    router.get("/agent-templates/categories/:category", async (req, res) => {
        try {
            const { category } = req.params;
            const templatesDir = path.join(process.cwd(), "data", "templates");
            
            // Create directory if it doesn't exist
            if (!fs.existsSync(templatesDir)) {
                await fs.promises.mkdir(templatesDir, { recursive: true });
                res.json({ templates: [] });
                return;
            }
            
            const templateFiles = await fs.promises.readdir(templatesDir);
            const templates = [];
            
            for (const file of templateFiles) {
                if (file.endsWith('.json')) {
                    try {
                        const templatePath = path.join(templatesDir, file);
                        const templateContent = await fs.promises.readFile(templatePath, 'utf8');
                        const template = JSON.parse(templateContent);
                        
                        // Filter by category
                        if (template.category === category || category === 'all') {
                            templates.push({
                                id: template.id || path.basename(file, '.json'),
                                name: template.name,
                                description: template.description || `Template for ${template.name}`,
                                category: template.category || 'general',
                                modelProvider: template.modelProvider,
                                imageUrl: template.imageUrl || null,
                                isPublic: template.isPublic === true
                            });
                        }
                    } catch (e) {
                        elizaLogger.error(`Error reading template ${file}: ${e}`);
                    }
                }
            }
            
            res.json({ templates });
        } catch (error) {
            elizaLogger.error(`Error getting templates by category: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Export a template
    router.get("/agent-templates/:templateId/export", async (req, res) => {
        try {
            const { templateId } = req.params;
            
            const templatePath = path.join(process.cwd(), "data", "templates", `${templateId}.json`);
            
            if (!fs.existsSync(templatePath)) {
                res.status(404).json({ error: "Template not found" });
                return;
            }
            
            // Read the template
            const templateContent = await fs.promises.readFile(templatePath, 'utf8');
            const template = JSON.parse(templateContent);
            
            // Set headers for file download
            res.setHeader('Content-Disposition', `attachment; filename=${templateId}.json`);
            res.setHeader('Content-Type', 'application/json');
            
            res.send(templateContent);
        } catch (error) {
            elizaLogger.error(`Error exporting template: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Import a template
    router.post("/agent-templates/import", upload.single('file'), async (req, res) => {
        try {
            const file = req.file;
            
            if (!file) {
                res.status(400).json({ error: "No template file provided" });
                return;
            }
            
            // Check if it's a JSON file
            if (!file.originalname.endsWith('.json')) {
                res.status(400).json({ error: "Template file must be a JSON file" });
                return;
            }
            
            // Read the uploaded file
            const templateContent = await fs.promises.readFile(file.path, 'utf8');
            let template;
            
            try {
                template = JSON.parse(templateContent);
            } catch (e) {
                res.status(400).json({ error: "Invalid JSON format in template file" });
                return;
            }
            
            // Validate template structure
            if (!template.name || !template.bio) {
                res.status(400).json({ error: "Invalid template format. Name and bio are required." });
                return;
            }
            
            // Generate ID if not present
            if (!template.id) {
                template.id = template.name.toLowerCase().replace(/\s+/g, '-') + '-template';
            }
            
            // Save to templates directory
            const templatesDir = path.join(process.cwd(), "data", "templates");
            await fs.promises.mkdir(templatesDir, { recursive: true });
            
            const templatePath = path.join(templatesDir, `${template.id}.json`);
            
            // Check for duplicate
            if (fs.existsSync(templatePath)) {
                // If overwrite flag is set, allow overwriting
                if (req.body.overwrite !== 'true') {
                    res.status(409).json({ 
                        error: "Template with this ID already exists", 
                        templateId: template.id 
                    });
                    return;
                }
            }
            
            // Update import timestamp
            template.importedAt = Date.now();
            
            // Write to file
            await fs.promises.writeFile(templatePath, JSON.stringify(template, null, 2));
            
            // Clean up the uploaded file
            await fs.promises.unlink(file.path);
            
            res.status(201).json({
                success: true,
                templateId: template.id,
                template: {
                    id: template.id,
                    name: template.name,
                    description: template.description || `Template for ${template.name}`,
                    category: template.category || 'general'
                }
            });
        } catch (error) {
            elizaLogger.error(`Error importing template: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Get available template categories
    router.get("/agent-templates/categories", async (req, res) => {
        try {
            const templatesDir = path.join(process.cwd(), "data", "templates");
            
            // Create directory if it doesn't exist
            if (!fs.existsSync(templatesDir)) {
                await fs.promises.mkdir(templatesDir, { recursive: true });
                res.json({ categories: ['general'] });
                return;
            }
            
            const templateFiles = await fs.promises.readdir(templatesDir);
            const categories = new Set<string>(['general']); // Always include general category
            
            for (const file of templateFiles) {
                if (file.endsWith('.json')) {
                    try {
                        const templatePath = path.join(templatesDir, file);
                        const templateContent = await fs.promises.readFile(templatePath, 'utf8');
                        const template = JSON.parse(templateContent);
                        
                        if (template.category) {
                            categories.add(template.category);
                        }
                    } catch (e) {
                        elizaLogger.error(`Error reading template ${file}: ${e}`);
                    }
                }
            }
            
            res.json({ categories: Array.from(categories) });
        } catch (error) {
            elizaLogger.error(`Error getting template categories: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Batch clone agents
    router.post("/agents/batch-clone", async (req, res) => {
        try {
            const { agents: agentsToClone } = req.body;
            
            if (!agentsToClone || !Array.isArray(agentsToClone) || agentsToClone.length === 0) {
                res.status(400).json({ error: "No agents specified for batch cloning" });
                return;
            }
            
            const results = [];
            const errors = [];
            
            // Process each agent in sequence
            for (const agentInfo of agentsToClone) {
                try {
                    const { agentId, newName } = agentInfo;
                    
                    if (!agentId || !newName) {
                        errors.push({ agentId, error: "Missing agentId or newName" });
                        continue;
                    }
                    
                    const validAgentId = validateUuid(agentId);
                    if (!validAgentId) {
                        errors.push({ agentId, error: "Invalid agent ID format" });
                        continue;
                    }
                    
                    // Get the existing agent
                    const existingAgent = agents.get(validAgentId);
                    if (!existingAgent) {
                        errors.push({ agentId, error: "Agent not found" });
                        continue;
                    }
                    
                    // Clone the character with a new ID and name
                    const clonedCharacter: Character = {
                        ...existingAgent.character,
                        id: stringToUuid(Date.now().toString() + results.length),
                        name: newName
                    };
                    
                    try {
                        validateCharacterConfig(clonedCharacter);
                    } catch (e) {
                        errors.push({ agentId, error: `Invalid character config: ${e.message}` });
                        continue;
                    }
                    
                    // Start a new agent with cloned character
                    const clonedAgent = await directClient.startAgent(clonedCharacter);
                    
                    // Save cloned character to storage if enabled
                    if (process.env.USE_CHARACTER_STORAGE === "true") {
                        try {
                            const filename = `${clonedAgent.agentId}.json`;
                            const uploadDir = path.join(process.cwd(), "data", "characters");
                            const filepath = path.join(uploadDir, filename);
                            
                            await fs.promises.mkdir(uploadDir, { recursive: true });
                            await fs.promises.writeFile(filepath, JSON.stringify(clonedCharacter, null, 2));
                        } catch (e) {
                            elizaLogger.error(`Error saving cloned character to storage: ${e}`);
                        }
                    }
                    
                    // Add to results
                    results.push({
                        originalAgentId: validAgentId,
                        newAgentId: clonedAgent.agentId,
                        name: newName,
                        success: true
                    });
                    
                } catch (error) {
                    errors.push({ 
                        agentId: agentInfo.agentId, 
                        error: error.message || "Unknown error during cloning" 
                    });
                }
            }
            
            res.json({
                results,
                errors,
                totalProcessed: agentsToClone.length,
                successCount: results.length,
                errorCount: errors.length
            });
        } catch (error) {
            elizaLogger.error(`Error in batch clone: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    // Batch export agents as templates
    router.post("/agent-templates/batch-export", async (req, res) => {
        try {
            const { agents: agentsToExport } = req.body;
            
            if (!agentsToExport || !Array.isArray(agentsToExport) || agentsToExport.length === 0) {
                res.status(400).json({ error: "No agents specified for batch export" });
                return;
            }
            
            const results = [];
            const errors = [];
            
            // Process each agent in sequence
            for (const agentInfo of agentsToExport) {
                try {
                    const { agentId, templateName, category } = agentInfo;
                    
                    if (!agentId) {
                        errors.push({ agentId, error: "Missing agentId" });
                        continue;
                    }
                    
                    const validAgentId = validateUuid(agentId);
                    if (!validAgentId) {
                        errors.push({ agentId, error: "Invalid agent ID format" });
                        continue;
                    }
                    
                    // Get the existing agent
                    const existingAgent = agents.get(validAgentId);
                    if (!existingAgent) {
                        errors.push({ agentId, error: "Agent not found" });
                        continue;
                    }
                    
                    // Generate a template name if not provided
                    const name = templateName || `${existingAgent.character.name} Template`;
                    const templateId = name.toLowerCase().replace(/\s+/g, '-') + '-template';
                    
                    // Create a template based on the agent's character
                    const template = {
                        id: templateId,
                        name: name,
                        username: existingAgent.character.username,
                        description: `Template based on ${existingAgent.character.name}`,
                        bio: existingAgent.character.bio,
                        lore: existingAgent.character.lore || [],
                        modelProvider: existingAgent.character.modelProvider,
                        imageModelProvider: existingAgent.character.imageModelProvider,
                        system: existingAgent.character.system || "",
                        messageExamples: existingAgent.character.messageExamples || [],
                        postExamples: existingAgent.character.postExamples || [],
                        style: existingAgent.character.style || {
                            all: [],
                            chat: [],
                            post: []
                        },
                        topics: existingAgent.character.topics || [],
                        adjectives: existingAgent.character.adjectives || [],
                        category: category || "general",
                        isPublic: false,
                        createdAt: Date.now()
                    };
                    
                    // Save the template to a file
                    const templatesDir = path.join(process.cwd(), "data", "templates");
                    await fs.promises.mkdir(templatesDir, { recursive: true });
                    
                    const templatePath = path.join(templatesDir, `${templateId}.json`);
                    await fs.promises.writeFile(templatePath, JSON.stringify(template, null, 2));
                    
                    // Add to results
                    results.push({
                        agentId: validAgentId,
                        templateId: templateId,
                        name: name,
                        success: true
                    });
                    
                } catch (error) {
                    errors.push({ 
                        agentId: agentInfo.agentId, 
                        error: error.message || "Unknown error during template creation" 
                    });
                }
            }
            
            res.json({
                results,
                errors,
                totalProcessed: agentsToExport.length,
                successCount: results.length,
                errorCount: errors.length
            });
        } catch (error) {
            elizaLogger.error(`Error in batch export as templates: ${error}`);
            res.status(500).json({ error: error.message });
        }
    });

    return router;
} 