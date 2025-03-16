import { Button } from "@/components/ui/button";
import {
    ChatBubble,
    ChatBubbleMessage,
    ChatBubbleTimestamp,
} from "@/components/ui/chat/chat-bubble";
import { ChatInput } from "@/components/ui/chat/chat-input";
import { ChatMessageList } from "@/components/ui/chat/chat-message-list";
import { useTransition, animated, type AnimatedProps } from "@react-spring/web";
import { Paperclip, Send, X, PinIcon, PinOffIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Content, UUID } from "@elizaos/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { cn, moment } from "@/lib/utils";
import { Avatar, AvatarImage } from "./ui/avatar";
import CopyButton from "./copy-button";
import ChatTtsButton from "./ui/chat/chat-tts-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import AIWriter from "react-aiwriter";
import type { IAttachment } from "@/types";
import { AudioRecorder } from "./audio-recorder";
import { Badge } from "./ui/badge";
import { useAutoScroll } from "./ui/chat/hooks/useAutoScroll";
import { AvatarViewer } from "@/components/avatar-viewer";

type ExtraContentFields = {
    user: string;
    createdAt: number;
    isLoading?: boolean;
};

type ContentWithUser = Content & ExtraContentFields;

type AnimatedDivProps = AnimatedProps<{ style: React.CSSProperties }> & {
    children?: React.ReactNode;
};

export default function Page({ agentId }: { agentId: UUID }) {
    const { toast } = useToast();
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [input, setInput] = useState("");
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const formRef = useRef<HTMLFormElement>(null);
    const [isFloating, setIsFloating] = useState(false);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const dragRef = useRef<HTMLDivElement>(null);

    const queryClient = useQueryClient();

    const getMessageVariant = (role: string) =>
        role !== "user" ? "received" : "sent";

    const { scrollRef, isAtBottom, scrollToBottom, disableAutoScroll } = useAutoScroll({
        smooth: true,
    });
   
    useEffect(() => {
        scrollToBottom();
    }, [queryClient.getQueryData(["messages", agentId])]);

    useEffect(() => {
        scrollToBottom();
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (e.nativeEvent.isComposing) return;
            handleSendMessage(e as unknown as React.FormEvent<HTMLFormElement>);
        }
    };

    const messages = queryClient.getQueryData<ContentWithUser[]>(["messages", agentId]) || [];
    
    // Track active agents and their roles
    const agents = [
        { id: "e61b079d-5226-06e9-9763-a33094aa8d82", name: "Garfield", role: "singer", avatar: "/garfield.png" },
        { id: "12dea96f-ec20-0935-a6ab-75692c994959", name: "Snoop", role: "assistant", avatar: "/snoop.png" }
    ];

    console.log("messages-001", messages);

    // Debug: Log all unique user IDs from messages to verify they match our agent IDs
    useEffect(() => {
        const uniqueUserIds = [...new Set(messages.map(m => m.user))];
        console.log("Unique user IDs in messages:", uniqueUserIds);
        console.log("Our configured agent IDs:", agents.map(a => a.id));
        
        // Check if any messages have user IDs that don't match our agents
        const unknownUserIds = uniqueUserIds.filter(id => 
            id !== "user" && !agents.some(agent => agent.id === id)
        );
        
        if (unknownUserIds.length > 0) {
            console.warn("Found messages with unknown user IDs:", unknownUserIds);
        }
    }, [messages]);

    // Get the latest message for each agent
    const agentMessages = agents.map(agent => {
        // Filter messages to only include those from this agent (by ID or name) and not loading
        const agentMsgs = messages.filter(m => 
            (m.user === agent.id || m.user === agent.name || m.user.toLowerCase() === agent.name.toLowerCase()) && 
            !m.isLoading
        );
        // Get the latest message if any exist
        const latestMessage = agentMsgs.length > 0 ? agentMsgs[agentMsgs.length - 1] : undefined;
        
        // Debug log
        console.log(`Agent ${agent.name} (${agent.id}) latest message:`, latestMessage);
        
        return {
            ...agent,
            latestMessage
        };
    });

    // Determine which agent is currently active (the one who sent the last message)
    const lastMessage = messages
        .filter(m => m.user !== "user" && !m.isLoading)
        .slice(-1)[0];
    
    const activeAgentId = lastMessage ? agents.find(a => 
        a.id === lastMessage.user || 
        a.name === lastMessage.user || 
        a.name.toLowerCase() === lastMessage.user.toLowerCase()
    )?.id : undefined;
    
    // Debug log
    console.log("Active agent ID:", activeAgentId);
    console.log("All messages:", messages);

    // Sort agents to put active one first
    const sortedAgentMessages = [...agentMessages].sort((a, b) => {
        if (a.id === activeAgentId) return -1;
        if (b.id === activeAgentId) return 1;
        return 0;
    });
    
    // Debug log
    console.log("Sorted agent messages:", sortedAgentMessages.map(a => a.name));

    // Handle @ mention suggestions
    const [mentionSuggestions, setMentionSuggestions] = useState<typeof agents>([]);
    
    const handleInputChange = ({ target }: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = target.value;
        setInput(value);
        
        // Check for @ mentions
        const lastAtIndex = value.lastIndexOf('@');
        
        // Only show suggestions if @ is present
        if (lastAtIndex !== -1) {
            const textAfterAt = value.slice(lastAtIndex + 1);
            const searchTerm = textAfterAt.split(/\s+/)[0].toLowerCase();
            
            // Show all agents when @ is typed with nothing after it
            if (textAfterAt.trim() === '') {
                console.log("Showing all agent suggestions");
                setMentionSuggestions(agents);
            } else {
                // Filter agents based on input after @
                console.log(`Filtering agents with term: "${searchTerm}"`);
                const filtered = agents.filter(agent => 
                    agent.name.toLowerCase().includes(searchTerm) ||
                    agent.role.toLowerCase().includes(searchTerm)
                );
                setMentionSuggestions(filtered);
            }
        } else {
            // Clear suggestions if no @ is present
            setMentionSuggestions([]);
        }
    };

    const handleMentionSelect = (agent: typeof agents[0]) => {
        const lastAtIndex = input.lastIndexOf('@');
        if (lastAtIndex === -1) return;
        
        // Find where the mention ends (at a space or end of string)
        const textAfterAt = input.slice(lastAtIndex + 1);
        const mentionEndIndex = textAfterAt.search(/\s|$/);
        const endPosition = lastAtIndex + 1 + (mentionEndIndex === -1 ? textAfterAt.length : mentionEndIndex);
        
        // Replace the mention with the selected agent name
        const newInput = input.substring(0, lastAtIndex + 1) + agent.name + input.substring(endPosition);
        
        setInput(newInput);
        setMentionSuggestions([]);
        
        // Focus and position cursor after the inserted mention
        if (inputRef.current) {
            inputRef.current.focus();
            const newCursorPosition = lastAtIndex + 1 + agent.name.length;
            setTimeout(() => {
                if (inputRef.current) {
                    inputRef.current.selectionStart = newCursorPosition;
                    inputRef.current.selectionEnd = newCursorPosition;
                }
            }, 0);
        }
    };

    const handleSendMessage = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!input) return;

        // Parse mentioned agents
        const mentionedAgents = agents.filter(agent => 
            input.includes(`@${agent.name}`)
        );

        // If no agent is mentioned, use the default agent
        if (mentionedAgents.length === 0) {
            mentionedAgents.push(agents.find(a => a.id === agentId) || agents[0]);
        }

        const attachments: IAttachment[] | undefined = selectedFile
            ? [
                  {
                      url: URL.createObjectURL(selectedFile),
                      contentType: selectedFile.type,
                      title: selectedFile.name,
                  },
              ]
            : undefined;

        // Create user message
        const userMessage = {
            text: input,
            user: "user",
            createdAt: Date.now(),
            attachments,
            mentionedAgents: mentionedAgents.map(a => a.id),
        };

        // Create loading messages for mentioned agents
        const agentLoadingMessages = mentionedAgents.map(agent => ({
            text: `${agent.name} is thinking...`,
            user: agent.id,
            isLoading: true,
            createdAt: Date.now(),
        }));

        // Update messages in the UI
        queryClient.setQueryData(
            ["messages", agentId],
            (old: ContentWithUser[] = []) => [...old, userMessage, ...agentLoadingMessages]
        );

        // Send the message to the first mentioned agent
        sendMessageMutation.mutate({
            message: input,
            selectedFile: selectedFile ? selectedFile : null,
            mentionedAgents: mentionedAgents.map(a => a.id),
        });

        setSelectedFile(null);
        setInput("");
        formRef.current?.reset();
    };

    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus();
        }
    }, []);

    const sendMessageMutation = useMutation({
        mutationKey: ["send_message", agentId],
        mutationFn: ({
            message,
            selectedFile,
            mentionedAgents,
        }: {
            message: string;
            selectedFile?: File | null;
            mentionedAgents: string[];
        }) => apiClient.sendMessage(agentId, message, selectedFile, mentionedAgents),
        onSuccess: (newMessages: ContentWithUser[]) => {
            queryClient.setQueryData(
                ["messages", agentId],
                (old: ContentWithUser[] = []) => [
                    ...old.filter((msg) => !msg.isLoading),
                    ...newMessages.map((msg) => ({
                        ...msg,
                        createdAt: Date.now(),
                    })),
                ]
            );
        },
        onError: (e) => {
            toast({
                variant: "destructive",
                title: "Unable to send message",
                description: e.message,
            });
        },
    });

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file?.type.startsWith("image/")) {
            setSelectedFile(file);
        }
    };

    const transitions = useTransition(messages, {
        keys: (message) =>
            `${message.createdAt}-${message.user}-${message.text}`,
        from: { opacity: 0, transform: "translateY(50px)" },
        enter: { opacity: 1, transform: "translateY(0px)" },
        leave: { opacity: 0, transform: "translateY(10px)" },
    });

    const CustomAnimatedDiv = animated.div as React.FC<AnimatedDivProps>;

    return (
        <div className="flex flex-col w-full h-[calc(100dvh)] p-4">
            <div className="flex flex-row gap-6 h-full">
                {/* Avatars Section */}
                {!isFloating && (
                    <div className="relative">
                        <div className="w-80 flex-shrink-0 bg-card/50 backdrop-blur-sm rounded-lg p-4 shadow-sm overflow-hidden flex flex-col gap-6 border border-border/50">
                            <div className="flex justify-between items-center">
                                <h3 className="text-sm font-semibold text-primary">Agents</h3>
                                <button
                                    onClick={() => setIsFloating(true)}
                                    className="p-1 hover:bg-background/80 rounded-md transition-colors"
                                    title="Float panel"
                                >
                                    <PinOffIcon className="w-4 h-4 text-muted-foreground" />
                                </button>
                            </div>
                            {sortedAgentMessages.map(agent => (
                                <AvatarViewer
                                    key={agent.id}
                                    agentId={agent.id}
                                    agentName={agent.name}
                                    role={agent.role}
                                    latestMessage={agent.latestMessage}
                                    isActive={agent.id === activeAgentId}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Floating Panel */}
                {isFloating && (
                    <div 
                        ref={dragRef}
                        className={cn(
                            "fixed z-50",
                            isDragging && "select-none"
                        )}
                        style={{
                            position: 'fixed',
                            left: position.x,
                            top: position.y,
                            boxShadow: '0 0 20px rgba(0, 0, 0, 0.1)',
                            borderRadius: '8px',
                            background: 'var(--background)',
                            border: '1px solid var(--border)'
                        }}
                    >
                        {/* 标题栏 - 可拖动区域 */}
                        <div 
                            className="bg-card/50 backdrop-blur-sm p-2 rounded-t-lg border-b border-border flex justify-between items-center cursor-move select-none"
                            onMouseDown={(e) => {
                                if (e.target !== e.currentTarget) return;
                                setIsDragging(true);
                                
                                // 记录初始鼠标位置和面板位置
                                const initialMouseX = e.clientX;
                                const initialMouseY = e.clientY;
                                const initialPanelX = position.x;
                                const initialPanelY = position.y;
                                
                                const handleMouseMove = (e: MouseEvent) => {
                                    // 计算鼠标移动的距离
                                    const deltaX = e.clientX - initialMouseX;
                                    const deltaY = e.clientY - initialMouseY;
                                    
                                    // 更新面板位置
                                    const newX = initialPanelX + deltaX;
                                    const newY = initialPanelY + deltaY;
                                    
                                    // 获取窗口尺寸和面板尺寸
                                    const panelRect = dragRef.current?.getBoundingClientRect();
                                    const maxX = window.innerWidth - (panelRect?.width || 0);
                                    const maxY = window.innerHeight - (panelRect?.height || 0);
                                    
                                    // 限制面板在可视区域内
                                    setPosition({
                                        x: Math.min(Math.max(0, newX), maxX),
                                        y: Math.min(Math.max(0, newY), maxY)
                                    });
                                };
                                
                                const handleMouseUp = () => {
                                    setIsDragging(false);
                                    document.removeEventListener('mousemove', handleMouseMove);
                                    document.removeEventListener('mouseup', handleMouseUp);
                                };
                                
                                document.addEventListener('mousemove', handleMouseMove);
                                document.addEventListener('mouseup', handleMouseUp);
                            }}
                        >
                            <div className="flex items-center gap-2">
                                <div className="flex gap-1.5">
                                    <div className="w-3 h-3 rounded-full bg-red-500" />
                                    <div className="w-3 h-3 rounded-full bg-yellow-500" />
                                    <div className="w-3 h-3 rounded-full bg-green-500" />
                                </div>
                                <h3 className="text-sm font-semibold text-primary pl-2">Agents</h3>
                            </div>
                            <button
                                onClick={() => {
                                    setPosition({ x: 20, y: 20 }); // 设置一个固定的初始位置
                                    setIsFloating(false);
                                }}
                                className="p-1 hover:bg-background/80 rounded-md transition-colors"
                                title="Pin panel"
                            >
                                <PinIcon className="w-4 h-4 text-muted-foreground" />
                            </button>
                        </div>
                        
                        {/* 内容区域 */}
                        <div className="w-80 bg-card/95 backdrop-blur-md p-4 rounded-b-lg overflow-hidden flex flex-col gap-6">
                            {sortedAgentMessages.map(agent => (
                                <AvatarViewer
                                    key={agent.id}
                                    agentId={agent.id}
                                    agentName={agent.name}
                                    role={agent.role}
                                    latestMessage={agent.latestMessage}
                                    isActive={agent.id === activeAgentId}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Chat Section */}
                <div className={cn(
                    "flex-1 flex flex-col bg-card/50 backdrop-blur-sm rounded-lg shadow-sm overflow-hidden border border-border/50",
                    isFloating && "ml-0" // 当面板浮动时，移除左边距
                )}>
                    <div className="flex-1 overflow-y-auto p-4">
                        <ChatMessageList 
                            scrollRef={scrollRef}
                            isAtBottom={isAtBottom}
                            scrollToBottom={scrollToBottom}
                            disableAutoScroll={disableAutoScroll}
                        >
                            {transitions((style, message: ContentWithUser) => {
                                const variant = getMessageVariant(message?.user);
                                const agent = agents.find(a => a.id === message.user);
                                return (
                                    <CustomAnimatedDiv
                                        style={{
                                            ...style,
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: "0.75rem",
                                            padding: "0.5rem",
                                        }}
                                    >
                                        <ChatBubble
                                            variant={variant}
                                            className="flex flex-row items-start gap-3"
                                        >
                                            {message?.user !== "user" ? (
                                                <div className="flex flex-col items-center gap-1">
                                                    <Avatar className="size-8 p-1 border rounded-full select-none">
                                                        <AvatarImage src={agent?.avatar || `/${agent?.name.toLowerCase()}.png`} />
                                                    </Avatar>
                                                    <span className="text-xs text-muted-foreground">
                                                        {agent?.name || message.user}
                                                    </span>
                                                </div>
                                            ) : null}
                                            <div className="flex flex-col flex-1 gap-1">
                                                <ChatBubbleMessage
                                                    isLoading={message?.isLoading}
                                                >
                                                    {message?.user !== "user" ? (
                                                        <AIWriter>
                                                            {message?.text}
                                                        </AIWriter>
                                                    ) : (
                                                        message?.text
                                                    )}
                                                    {/* Attachments */}
                                                    <div>
                                                        {message?.attachments?.map(
                                                            (attachment: IAttachment) => (
                                                                <div
                                                                    className="flex flex-col gap-1 mt-2"
                                                                    key={`${attachment.url}-${attachment.title}`}
                                                                >
                                                                    <img
                                                                        alt="attachment"
                                                                        src={attachment.url}
                                                                        width="100%"
                                                                        height="100%"
                                                                        className="w-64 rounded-md"
                                                                    />
                                                                </div>
                                                            )
                                                        )}
                                                    </div>
                                                </ChatBubbleMessage>
                                                <div className="flex items-center gap-4 justify-between w-full mt-1">
                                                    {message?.text &&
                                                    !message?.isLoading ? (
                                                        <div className="flex items-center gap-1">
                                                            <CopyButton
                                                                text={message?.text}
                                                            />
                                                            <ChatTtsButton
                                                                agentId={agentId}
                                                                text={message?.text}
                                                            />
                                                        </div>
                                                    ) : null}
                                                    <div
                                                        className={cn([
                                                            message?.isLoading
                                                                ? "mt-2"
                                                                : "",
                                                            "flex items-center justify-between gap-4 select-none",
                                                        ])}
                                                    >
                                                        {message?.source ? (
                                                            <Badge variant="outline">
                                                                {message.source}
                                                            </Badge>
                                                        ) : null}
                                                        {message?.action ? (
                                                            <Badge variant="outline">
                                                                {message.action}
                                                            </Badge>
                                                        ) : null}
                                                        {message?.createdAt ? (
                                                            <ChatBubbleTimestamp
                                                                timestamp={moment(
                                                                    message?.createdAt
                                                                ).format("LT")}
                                                            />
                                                        ) : null}
                                                    </div>
                                                </div>
                                            </div>
                                        </ChatBubble>
                                    </CustomAnimatedDiv>
                                );
                            })}
                        </ChatMessageList>
                    </div>
                    
                    {/* Mention suggestions */}
                    {mentionSuggestions.length > 0 && (
                        <div className="absolute bottom-24 left-4 bg-background rounded-lg shadow-lg border p-2 z-50 max-h-60 overflow-y-auto w-64">
                            <div className="text-xs text-muted-foreground mb-1 px-2">@提及代理</div>
                            {mentionSuggestions.map(agent => (
                                <button
                                    key={agent.id}
                                    className="flex items-center gap-2 w-full p-2 hover:bg-accent rounded-md transition-colors"
                                    onClick={() => handleMentionSelect(agent)}
                                >
                                    <Avatar className="size-6">
                                        <AvatarImage src={agent.avatar} />
                                    </Avatar>
                                    <span>{agent.name}</span>
                                    <span className="text-xs text-muted-foreground">({agent.role})</span>
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="p-4 border-t relative">
                        <form
                            ref={formRef}
                            onSubmit={handleSendMessage}
                            className="relative rounded-md border bg-background"
                        >
                            {selectedFile ? (
                                <div className="p-3 flex">
                                    <div className="relative rounded-md border p-2">
                                        <Button
                                            onClick={() => setSelectedFile(null)}
                                            className="absolute -right-2 -top-2 size-[22px] ring-2 ring-background"
                                            variant="outline"
                                            size="icon"
                                        >
                                            <X />
                                        </Button>
                                        <img
                                            alt="Selected file"
                                            src={URL.createObjectURL(selectedFile)}
                                            height="100%"
                                            width="100%"
                                            className="aspect-square object-contain w-16"
                                        />
                                    </div>
                                </div>
                            ) : null}
                            <ChatInput
                                ref={inputRef}
                                onKeyDown={handleKeyDown}
                                value={input}
                                onChange={handleInputChange}
                                placeholder="Type @ to mention an agent..."
                                className="min-h-12 resize-none rounded-md bg-background border-0 p-3 shadow-none focus-visible:ring-0"
                            />
                            <div className="flex items-center p-3 pt-0">
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => {
                                                    if (fileInputRef.current) {
                                                        fileInputRef.current.click();
                                                    }
                                                }}
                                            >
                                                <Paperclip className="size-4" />
                                                <span className="sr-only">
                                                    Attach file
                                                </span>
                                            </Button>
                                            <input
                                                type="file"
                                                ref={fileInputRef}
                                                onChange={handleFileChange}
                                                accept="image/*"
                                                className="hidden"
                                            />
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent side="left">
                                        <p>Attach file</p>
                                    </TooltipContent>
                                </Tooltip>
                                <AudioRecorder
                                    agentId={agentId}
                                    onChange={(newInput: string) => setInput(newInput)}
                                />
                                <Button
                                    disabled={!input || sendMessageMutation?.isPending}
                                    type="submit"
                                    size="sm"
                                    className="ml-auto gap-1.5 h-[30px]"
                                >
                                    {sendMessageMutation?.isPending
                                        ? "..."
                                        : "Send Message"}
                                    <Send className="size-3.5" />
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
}
