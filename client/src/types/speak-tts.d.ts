declare module 'speak-tts' {
    interface Voice {
        name: string;
        lang: string;
    }

    interface SpeakConfig {
        text: string;
        queue?: boolean;
        listeners?: {
            onstart?: () => void;
            onend?: () => void;
            onerror?: (error: Error) => void;
        };
    }

    interface InitConfig {
        volume?: number;
        lang?: string;
        rate?: number;
        pitch?: number;
        voice?: string;
        splitSentences?: boolean;
        listeners?: {
            onvoiceschanged?: () => void;
        };
    }

    export default class Speech {
        init(config?: InitConfig): Promise<boolean>;
        speak(config: SpeakConfig): Promise<void>;
        cancel(): void;
        pause(): void;
        resume(): void;
        getVoices(): Voice[];
        setVoice(voice: string): Promise<void>;
        setLanguage(lang: string): Promise<void>;
        setRate(rate: number): void;
        setPitch(pitch: number): void;
        setVolume(volume: number): void;
    }
} 