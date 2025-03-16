import { useEffect, useRef, useState } from 'react';
import { Content } from '@elizaos/core';
import Speech, { Voice } from 'speak-tts';

interface PixelAvatarSystem {
    processText: (text: string) => Promise<string>;
    updateAvatar: (emotion: string) => void;
    getCurrentEmotion: () => string;
    startMouthAnimation: (isActive: boolean) => void;
}

interface Props {
    latestMessage?: Content;
    agentId: string;
    agentName: string;
    role: string;
    isActive?: boolean;
}

// 在文件顶部添加
declare global {
    interface Window {
        avatarSystem: PixelAvatarSystem | null;
    }
}

// 将类移到组件外部
class PixelAvatarSystemImpl implements PixelAvatarSystem {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private size: number;
    private colors: Record<string, string>;
    private emotionStates: Record<string, any>;
    private agentName: string;
    private currentEmotion: string = 'neutral';
    private mouthAnimationFrame: number = 0;
    private mouthAnimationInterval: NodeJS.Timeout | null = null;
    private emotionResetTimer: NodeJS.Timeout | null = null;
    private animationsInProgress: boolean = false;

    constructor(container: HTMLElement, size = 64, _role: string, agentName: string) {
        this.canvas = document.createElement('canvas');
        this.canvas.style.width = `${size}px`;
        this.canvas.style.height = `${size}px`;
        this.canvas.width = size;
        this.canvas.height = size;
        
        // 清除容器中的现有内容
        container.innerHTML = '';
        container.appendChild(this.canvas);
        
        this.ctx = this.canvas.getContext('2d')!;
        this.size = size;
        this.agentName = agentName;
        
        // 设置颜色
        this.colors = this.agentName === 'Garfield' ? {
            skin: '#ff8c00',
            hair: '#ff6600',
            eyes: '#4169e1',
            mouth: '#ff69b4',
            clothes: '#daa520',
            blush: '#ffb6c1',
            highlight: '#ffffff',
            stripes: '#d25500'
        } : {
            skin: '#ffffff',
            hair: '#000000',
            eyes: '#000000',
            mouth: '#000000',
            clothes: '#ff0000',
            blush: '#ffb3b3',
            highlight: '#ffffff',
            accessories: '#ff0000'
        };
        
        // 设置情绪状态
        this.emotionStates = {
            happy: {
                eyes: { shape: '^', highlight: true, blush: true },
                mouth: { shape: '‿', style: this.colors.mouth },
                animation: ['bounce', 'sparkle']
            },
            sad: {
                eyes: { shape: '•', droplet: true },
                mouth: { shape: '︵', style: this.colors.mouth },
                animation: ['droop']
            },
            neutral: {
                eyes: { shape: '-' },
                mouth: { shape: '―', style: this.colors.mouth },
                animation: ['idle']
            },
            singing: {
                eyes: { shape: '♪', highlight: true, blush: true },
                mouth: { shape: 'O', style: this.colors.mouth },
                animation: ['bounce']
            },
            angry: {
                eyes: { shape: '>', highlight: false },
                mouth: { shape: '︿', style: this.colors.mouth },
                animation: ['shake']
            }
        };

        // 初始化绘制
        this.updateAvatar('neutral');
    }

    async processText(text: string): Promise<string> {
        try {
            const emotion = this.analyzeEmotion(text);
            if (emotion !== this.currentEmotion) {
                this.updateAvatar(emotion);
            }
            return emotion;
        } catch (error) {
            console.error(`[${this.agentName}] Error processing text:`, error);
            return 'neutral';
        }
    }

    private analyzeEmotion(text: string): string {
        const emotions = {
            happy: [
                'happy', 'glad', 'joy', 'excited', 'yay', 'smile', 'laugh', 'haha', 
                'wonderful', 'great', 'awesome', 'amazing', '😊', '😄', '😃', '🥰', 
                '❤️', '🎉', '🎊', '🌟', 'fantastic', 'excellent', 'perfect'
            ],
            sad: [
                'sad', 'unhappy', 'depressed', 'down', 'cry', 'tears', 'sorry',
                'unfortunate', 'regret', 'miss', '😢', '😭', '😔', '💔', 'disappointed'
            ],
            angry: [
                'angry', 'mad', 'furious', 'upset', 'annoyed', 'irritated',
                'frustrated', '😠', '😡', '💢', 'hate', 'terrible', 'awful'
            ],
            singing: [
                'sing', 'song', 'music', 'tune', 'melody', 'musical', '🎵', '🎶',
                'karaoke', 'concert', 'perform'
            ]
        };

        const lowerText = text.toLowerCase();
        
        // 检查每个情绪类型的关键词
        for (const [emotion, keywords] of Object.entries(emotions)) {
            // 使用正则表达式匹配整个单词
            const hasKeyword = keywords.some(keyword => {
                if (keyword.match(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/u)) {
                    // 如果是表情符号，直接检查是否包含
                    return lowerText.includes(keyword);
                } else {
                    // 如果是文字，检查是否是独立的单词
                    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
                    return regex.test(lowerText);
                }
            });

            if (hasKeyword) {
                return emotion;
            }
        }

        // 检查文本是否包含大量感叹号或表情符号
        if (text.match(/!{2,}/) || text.match(/[\u{1F300}-\u{1F9FF}][\u{1F300}-\u{1F9FF}]/u)) {
            return 'happy';
        }

        return 'neutral';
    }

    updateAvatar(emotion: string): void {
        // 如果情绪相同且动画正在进行，则跳过
        if (this.currentEmotion === emotion && this.animationsInProgress) {
            return;
        }
        
        this.currentEmotion = emotion;
        
        // 清除画布
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // 绘制角色
        if (this.agentName === 'Garfield') {
            this.drawGarfield();
        } else {
            this.drawSnoop();
        }
        
        // 应用动画
        if (!this.animationsInProgress) {
            this.animationsInProgress = true;
            requestAnimationFrame(() => {
                this.applyEmotionAnimations();
                this.animationsInProgress = false;
            });
        }
        
        // 设置自动重置定时器
        if (emotion !== 'neutral') {
            if (this.emotionResetTimer) {
                clearTimeout(this.emotionResetTimer);
            }
            this.emotionResetTimer = setTimeout(() => {
                if (this.currentEmotion === emotion) {
                    this.updateAvatar('neutral');
                }
            }, 20000);
        }
    }

    private applyEmotionAnimations(): void {
        const state = this.emotionStates[this.currentEmotion];
        if (!state?.animation) return;
        
        // 清除现有动画
        this.canvas.getAnimations().forEach(animation => animation.cancel());
        
        // 应用新动画
        state.animation.forEach((type: string) => {
            const keyframes = this.getKeyframes(type);
            if (keyframes) {
                this.canvas.animate(keyframes, {
                    duration: 1000,
                    iterations: type === 'idle' ? Infinity : 3,
                    easing: 'ease-in-out'
                });
            }
        });
    }

    private getKeyframes(type: string): Keyframe[] | null {
        const keyframes = {
            bounce: [
                { transform: 'translateY(0)' },
                { transform: 'translateY(-10px)' },
                { transform: 'translateY(0)' }
            ],
            shake: [
                { transform: 'translateX(-3px)' },
                { transform: 'translateX(3px)' },
                { transform: 'translateX(0)' }
            ],
            droop: [
                { transform: 'rotate(0deg)' },
                { transform: 'rotate(-5deg)' },
                { transform: 'rotate(0deg)' }
            ],
            sparkle: [
                { filter: 'brightness(1)' },
                { filter: 'brightness(1.2)' },
                { filter: 'brightness(1)' }
            ],
            idle: [
                { transform: 'translateY(0)' },
                { transform: 'translateY(-2px)' },
                { transform: 'translateY(0)' }
            ]
        };
        
        return keyframes[type as keyof typeof keyframes] || null;
    }

    startMouthAnimation(isActive: boolean): void {
        if (this.mouthAnimationInterval) {
            clearInterval(this.mouthAnimationInterval);
            this.mouthAnimationInterval = null;
        }
        
        if (isActive && this.currentEmotion === 'singing') {
            this.mouthAnimationInterval = setInterval(() => {
                this.mouthAnimationFrame = (this.mouthAnimationFrame + 1) % 3;
                this.updateAvatar(this.currentEmotion);
            }, 300);
        }
    }

    getCurrentEmotion(): string {
        return this.currentEmotion;
    }

    private drawGarfield(): void {
        // 绘制头部
        this.ctx.fillStyle = this.colors.skin;
        this.ctx.beginPath();
        this.ctx.arc(this.size * 0.5, this.size * 0.5, this.size * 0.35, 0, Math.PI * 2);
        this.ctx.fill();
        
        // 绘制耳朵
        this.drawEars();
        
        // 绘制条纹
        this.drawStripes();
        
        // 绘制表情
        this.drawExpression();
        
        // 绘制胡须
        this.drawWhiskers();
    }
    
    private drawSnoop(): void {
        // 绘制头部
        this.ctx.fillStyle = this.colors.skin;
        this.ctx.beginPath();
        this.ctx.arc(this.size * 0.5, this.size * 0.5, this.size * 0.35, 0, Math.PI * 2);
        this.ctx.fill();
        
        // 绘制耳朵
        this.drawEars();
        
        // 绘制表情
        this.drawExpression();
        
        // 绘制项圈
        this.drawCollar();
    }

    private drawEars(): void {
        if (this.agentName === 'Garfield') {
            // Garfield的耳朵
            this.ctx.fillStyle = this.colors.skin;
            this.ctx.beginPath();
            this.ctx.moveTo(this.size * 0.25, this.size * 0.3);
            this.ctx.lineTo(this.size * 0.15, this.size * 0.15);
            this.ctx.lineTo(this.size * 0.35, this.size * 0.25);
            this.ctx.fill();
            
            this.ctx.beginPath();
            this.ctx.moveTo(this.size * 0.75, this.size * 0.3);
            this.ctx.lineTo(this.size * 0.85, this.size * 0.15);
            this.ctx.lineTo(this.size * 0.65, this.size * 0.25);
            this.ctx.fill();
        } else {
            // Snoop的耳朵
            this.ctx.fillStyle = this.colors.skin;
            this.ctx.beginPath();
            this.ctx.ellipse(this.size * 0.3, this.size * 0.25, this.size * 0.15, this.size * 0.2, 0, 0, Math.PI * 2);
            this.ctx.fill();
            
            this.ctx.beginPath();
            this.ctx.ellipse(this.size * 0.7, this.size * 0.25, this.size * 0.15, this.size * 0.2, 0, 0, Math.PI * 2);
            this.ctx.fill();
            
            // 耳朵轮廓
            this.ctx.strokeStyle = this.colors.hair;
            this.ctx.lineWidth = 1;
            this.ctx.stroke();
        }
    }

    private drawStripes(): void {
        if (this.agentName === 'Garfield') {
            this.ctx.fillStyle = this.colors.stripes;
            this.ctx.fillRect(this.size * 0.4, this.size * 0.2, this.size * 0.05, this.size * 0.1);
            this.ctx.fillRect(this.size * 0.55, this.size * 0.2, this.size * 0.05, this.size * 0.1);
            this.ctx.fillRect(this.size * 0.2, this.size * 0.4, this.size * 0.1, this.size * 0.05);
            this.ctx.fillRect(this.size * 0.7, this.size * 0.4, this.size * 0.1, this.size * 0.05);
        }
    }

    private drawExpression(): void {
        const state = this.emotionStates[this.currentEmotion] || this.emotionStates.neutral;
        const eyeY = this.size * 0.4;
        
        // 绘制眼睛
        this.drawEyes(eyeY, state.eyes);
        
        // 绘制嘴巴
        const mouthY = this.size * (this.agentName === 'Snoop' ? 0.65 : 0.6);
        this.drawMouth(mouthY, state.mouth);
        
        // 如果需要，添加腮红
        if (state.eyes.blush) {
            this.drawBlush();
        }
    }

    private drawEyes(eyeY: number, eyeState: any): void {
        const x1 = this.size * (this.agentName === 'Snoop' ? 0.4 : 0.35);
        const x2 = this.size * (this.agentName === 'Snoop' ? 0.6 : 0.65);
        
        this.ctx.fillStyle = this.colors.eyes;
        this.ctx.font = `${this.size * 0.15}px monospace`;
        this.ctx.fillText(eyeState.shape, x1, eyeY);
        this.ctx.fillText(eyeState.shape, x2, eyeY);
        
        if (eyeState.highlight) {
            this.ctx.fillStyle = this.colors.highlight;
            this.ctx.fillRect(x1 + 2, eyeY - 4, 2, 2);
            this.ctx.fillRect(x2 + 2, eyeY - 4, 2, 2);
        }
    }

    private drawMouth(y: number, mouthState: any): void {
        this.ctx.fillStyle = mouthState.style;
        if (this.currentEmotion === 'singing' && this.mouthAnimationInterval) {
            const shapes = ['O', 'o', '●'];
            this.ctx.font = `${this.size * 0.2}px monospace`;
            this.ctx.fillText(shapes[this.mouthAnimationFrame], this.size * 0.5, y);
        } else {
            this.ctx.font = `${this.size * 0.15}px monospace`;
            this.ctx.fillText(mouthState.shape, this.size * 0.5, y);
        }
    }

    private drawWhiskers(): void {
        if (this.agentName === 'Garfield') {
            this.ctx.strokeStyle = '#ffffff';
            this.ctx.lineWidth = 1;
            
            // 左侧胡须
            this.ctx.beginPath();
            this.ctx.moveTo(this.size * 0.3, this.size * 0.55);
            this.ctx.lineTo(this.size * 0.1, this.size * 0.5);
            this.ctx.stroke();
            
            this.ctx.beginPath();
            this.ctx.moveTo(this.size * 0.3, this.size * 0.6);
            this.ctx.lineTo(this.size * 0.1, this.size * 0.6);
            this.ctx.stroke();
            
            // 右侧胡须
            this.ctx.beginPath();
            this.ctx.moveTo(this.size * 0.7, this.size * 0.55);
            this.ctx.lineTo(this.size * 0.9, this.size * 0.5);
            this.ctx.stroke();
            
            this.ctx.beginPath();
            this.ctx.moveTo(this.size * 0.7, this.size * 0.6);
            this.ctx.lineTo(this.size * 0.9, this.size * 0.6);
            this.ctx.stroke();
        }
    }

    private drawCollar(): void {
        if (this.agentName === 'Snoop') {
            // 绘制项圈
            this.ctx.strokeStyle = this.colors.clothes;
            this.ctx.lineWidth = 3;
            this.ctx.beginPath();
            this.ctx.arc(this.size * 0.5, this.size * 0.75, this.size * 0.15, Math.PI * 0.25, Math.PI * 0.75);
            this.ctx.stroke();
            
            // 绘制项圈吊牌
            this.ctx.fillStyle = this.colors.accessories;
            this.ctx.beginPath();
            this.ctx.arc(this.size * 0.5, this.size * 0.8, this.size * 0.04, 0, Math.PI * 2);
            this.ctx.fill();
        }
    }

    private drawBlush(): void {
        this.ctx.fillStyle = this.colors.blush;
        this.ctx.globalAlpha = 0.3;
        this.ctx.beginPath();
        this.ctx.ellipse(this.size * 0.3, this.size * 0.55, 5, 3, 0, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.beginPath();
        this.ctx.ellipse(this.size * 0.7, this.size * 0.55, 5, 3, 0, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.globalAlpha = 1;
    }
}

class TTSSystem {
    private tts: Speech;
    private isInitialized: boolean = false;
    private characterConfig: {
        pitch: number;
        rate: number;
        volume: number;
    };

    constructor(characterName: string) {
        console.log(`[Speech] Initializing TTS system for ${characterName}`);
        this.tts = new Speech();
        this.characterConfig = this.getCharacterVoiceConfig(characterName);
        this.initialize();
    }

    private async initialize() {
        try {
            console.log('[Speech] Starting initialization...');
            const result = await this.tts.init({
                volume: this.characterConfig.volume,
                lang: 'en-US',
                rate: this.characterConfig.rate,
                pitch: this.characterConfig.pitch,
                splitSentences: true,
                listeners: {
                    onvoiceschanged: () => {
                        console.log('[Speech] Voices changed, attempting to set voice...');
                        this.setVoice();
                    }
                }
            });

            console.log('[Speech] Initialization result:', result);
            if (result) {
                console.log('[Speech] TTS is ready to play');
                this.isInitialized = true;
                await this.setVoice();
            }
        } catch (error) {
            console.error('[Speech] TTS initialization failed:', error);
        }
    }

    private async setVoice() {
        try {
            // 获取可用的声音列表
            const ttsVoices = window.speechSynthesis.getVoices();
            console.log('[Speech] System voices:', ttsVoices);
            
            //const ttsVoices = this.tts.getVoices();
            //console.log('[Speech] TTS voices:', ttsVoices);

            // 尝试找到合适的声音
            let selectedVoice = ttsVoices.find((voice: Voice) => {
                console.log('[Speech] Checking voice:', voice.name, voice.lang);
                return voice.lang.startsWith('en') && 
                       voice.name.includes('Male');
            });

            if (!selectedVoice) {
                console.log('[Speech] No male English voice found, trying any English voice');
                selectedVoice = ttsVoices.find((voice: Voice) => voice.lang.startsWith('en'));
            }

            if (selectedVoice) {
                console.log('[Speech] Selected voice:', selectedVoice.name);
                await this.tts.setVoice(selectedVoice.name);
                
                // 设置其他参数
                this.tts.setRate(this.characterConfig.rate);
                this.tts.setPitch(this.characterConfig.pitch);
                this.tts.setVolume(this.characterConfig.volume);
                
                console.log('[Speech] Voice configuration complete:', {
                    voice: selectedVoice.name,
                    rate: this.characterConfig.rate,
                    pitch: this.characterConfig.pitch,
                    volume: this.characterConfig.volume
                });
            } else {
                console.log('[Speech] No suitable voice found, using default system voice');
            }
        } catch (error) {
            console.error('[Speech] Failed to set voice:', error);
        }
    }

    private getCharacterVoiceConfig(characterName: string) {
        const config = {
            garfield: {
                pitch: 0.7,  // 更深的声音
                rate: 0.85,  // 慵懒的语速
                volume: 1.0
            },
            snoop: {
                pitch: 0.9,  // 略低的声音
                rate: 1.1,   // 快速的语速
                volume: 1.0
            },
            default: {
                pitch: 1.0,
                rate: 1.0,
                volume: 1.0
            }
        };

        const selectedConfig = config[characterName.toLowerCase() as keyof typeof config] || config.default;
        console.log(`[Speech] Voice config for ${characterName}:`, selectedConfig);
        return selectedConfig;
    }

    async speak(text: string): Promise<void> {
        if (!this.isInitialized) {
            console.warn('[Speech] TTS not initialized yet');
            return;
        }

        try {
            console.log(`[Speech] Speaking: "${text}"`);
            
            // 创建一个动画间隔来更新头像
            let mouthAnimationInterval: NodeJS.Timeout | null = null;
            
            await this.tts.speak({
                text,
                queue: false, // 打断之前的语音
                listeners: {
                    onstart: () => {
                        console.log('[Speech] Started speaking');
                        // 开始嘴部动画
                        if (window.avatarSystem) {
                            window.avatarSystem.startMouthAnimation(true);
                            // 创建动画间隔
                            mouthAnimationInterval = setInterval(() => {
                                if (window.avatarSystem) {
                                    window.avatarSystem.updateAvatar(
                                        window.avatarSystem.getCurrentEmotion()
                                    );
                                }
                            }, 300);
                        }
                    },
                    onend: () => {
                        console.log('[Speech] Finished speaking');
                        // 停止嘴部动画
                        if (window.avatarSystem) {
                            window.avatarSystem.startMouthAnimation(false);
                            // 清除动画间隔
                            if (mouthAnimationInterval) {
                                clearInterval(mouthAnimationInterval);
                                mouthAnimationInterval = null;
                            }
                        }
                    },
                    onerror: (error) => {
                        console.error('[Speech] Error:', error);
                        // 出错时也要停止动画
                        if (window.avatarSystem) {
                            window.avatarSystem.startMouthAnimation(false);
                            if (mouthAnimationInterval) {
                                clearInterval(mouthAnimationInterval);
                                mouthAnimationInterval = null;
                            }
                        }
                    }
                }
            });
        } catch (error) {
            console.error('[Speech] Failed to speak:', error);
            // 确保在错误时停止动画
            if (window.avatarSystem) {
                window.avatarSystem.startMouthAnimation(false);
            }
        }
    }

    stop(): void {
        if (this.isInitialized) {
            console.log('[Speech] Stopping speech');
            this.tts.cancel();
        }
    }
}

export function AvatarViewer({ latestMessage, agentId, agentName, role, isActive }: Props) {
    const avatarContainerRef = useRef<HTMLDivElement>(null);
    const avatarSystemRef = useRef<PixelAvatarSystem | null>(null);
    const speechSystemRef = useRef<TTSSystem | null>(null);
    const [currentEmotion, setCurrentEmotion] = useState<string>('neutral');
    const [lastActiveEmotion, setLastActiveEmotion] = useState<string>('neutral');
    const [processedMessageId, setProcessedMessageId] = useState<string>('');
    //const [isDeveloperMessage, setIsDeveloperMessage] = useState<boolean>(false);

    // 初始化头像系统
    useEffect(() => {
        if (!avatarContainerRef.current) return;
        
        avatarSystemRef.current = new PixelAvatarSystemImpl(
            avatarContainerRef.current,
            64,
            role,
            agentName
        );
        
        // 设置全局引用
        window.avatarSystem = avatarSystemRef.current;
        
        return () => {
            const canvas = avatarContainerRef.current?.querySelector('canvas');
            if (canvas) {
                canvas.getAnimations().forEach(animation => animation.cancel());
            }
            window.avatarSystem = null;
        };
    }, []);

    // 初始化语音合成系统 - 添加热重载支持
    useEffect(() => {
        const initSpeechSystem = () => {
            if (speechSystemRef.current) {
                speechSystemRef.current.stop();
            }
            speechSystemRef.current = new TTSSystem(agentName);
        };

        initSpeechSystem();

        // 添加热重载支持
        if (import.meta.hot) {
            import.meta.hot.accept(() => {
                console.log('[Speech] Hot reloading speech system...');
                initSpeechSystem();
            });
        }

        return () => {
            speechSystemRef.current?.stop();
        };
    }, [agentName]);

    // 处理活动状态变化
    useEffect(() => {
        if (!avatarSystemRef.current) return;
        
        if (isActive) {
            if (lastActiveEmotion !== 'neutral') {
                setCurrentEmotion(lastActiveEmotion);
                avatarSystemRef.current.updateAvatar(lastActiveEmotion);
            }
            avatarSystemRef.current.startMouthAnimation(true);
        } else {
            if (currentEmotion !== 'neutral') {
                setLastActiveEmotion(currentEmotion);
                setCurrentEmotion('neutral');
                avatarSystemRef.current.updateAvatar('neutral');
            }
            avatarSystemRef.current.startMouthAnimation(false);
        }
    }, [isActive, lastActiveEmotion, currentEmotion]);

    // 处理消息更新
    useEffect(() => {
        if (!latestMessage?.text || !avatarSystemRef.current || !speechSystemRef.current) return;
        
        const messageId = `${latestMessage.text}-${latestMessage.createdAt}`;
        if (processedMessageId === messageId) return;
        
        if (!latestMessage.isLoading) {
            setProcessedMessageId(messageId);

            // 处理文本，移除表情符号但保留语气
            const processTextForSpeech = (text: string) => {
                // 移除表情符号但在句尾添加适当的语气
                const textWithoutEmoji = text.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/gu, '');
                
                // 根据表情符号添加语气词
                if (text.match(/[😊😄😃🥰❤️🎉🎊🌟]/u)) {
                    return textWithoutEmoji + ' (happily)';
                } else if (text.match(/[😢😭😔💔]/u)) {
                    return textWithoutEmoji + ' (sadly)';
                } else if (text.match(/[😠😡💢]/u)) {
                    return textWithoutEmoji + ' (angrily)';
                } else if (text.match(/[🎵🎶]/u)) {
                    return textWithoutEmoji + ' (melodically)';
                }
                
                return textWithoutEmoji;
            };

            // 处理常规agent消息
            avatarSystemRef.current.processText(latestMessage.text).then(emotion => {
                if (isActive) {
                    setCurrentEmotion(emotion);
                    setLastActiveEmotion(emotion);
                    
                    // 使用处理后的文本进行语音播放
                    console.log('[Speech] Processing text:', latestMessage.text);
                    const processedText = processTextForSpeech(latestMessage.text);
                    console.log('[Speech] Processed text:', processedText);
                    speechSystemRef.current?.speak(processedText);
                    
                    // 如果是唱歌状态，播放音乐
                    if (emotion === 'singing') {
                        const audio = new Audio('/Garfield.mp3');
                        
                        // 清理之前的事件监听器
                        const handleEnded = () => {
                            setCurrentEmotion('neutral');
                            setLastActiveEmotion('neutral');
                            avatarSystemRef.current?.updateAvatar('neutral');
                            audio.removeEventListener('ended', handleEnded);
                        };
                        
                        audio.addEventListener('ended', handleEnded);
                        audio.play().catch(error => {
                            console.error('Error playing audio:', error);
                            handleEnded(); // 如果播放失败，也重置状态
                        });
                    }
                } else {
                    setLastActiveEmotion(emotion);
                }
            });
        } 
    }, [latestMessage, agentId, agentName, processedMessageId, isActive]);

    return (
        <div className={`flex flex-col items-center gap-2 transition-all duration-300 ${isActive ? 'scale-105' : 'scale-100'}`}>
            <div className="text-sm font-semibold text-primary">
                {agentName} {currentEmotion !== 'neutral' && 
                    <span className="text-xs text-muted-foreground">({currentEmotion})</span>
                }
            </div>
            <div 
                ref={avatarContainerRef} 
                className={`w-24 h-24 flex items-center justify-center rounded-full shadow-md backdrop-blur-sm border-2 transition-all duration-300
                    ${isActive ? 'border-primary bg-background/80' : 'border-border/50 bg-background/50'} 
                    ${currentEmotion !== 'neutral' && `border-${currentEmotion}`}`}
                data-emotion={currentEmotion}
            />
            <div className="text-xs text-muted-foreground">
                {`${role} (ID: ${agentId.substring(0, 8)}...)`}
            </div>
            
            {latestMessage?.text && !latestMessage.isLoading && (
                <div className="w-full">
                    <div 
                        className={`bg-card/50 backdrop-blur-sm rounded-lg p-2 text-xs shadow-sm border
                            ${'border-purple-500 bg-purple-50/10'}`}
                        style={{
                            animation: 'fadeIn 0.3s ease-in-out',
                            borderColor: getEmotionColor(currentEmotion)
                        }}
                    >
                        <p className="text-foreground/90 leading-relaxed break-words">
                            {latestMessage.text}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

function getEmotionColor(emotion: string): string {
    const colors: Record<string, string> = {
        happy: '#10b981',
        sad: '#3b82f6',
        surprised: '#8b5cf6',
        angry: '#ef4444',
        singing: '#ec4899',
        neutral: '#e5e7eb'
    };
    return colors[emotion] || colors.neutral;
} 