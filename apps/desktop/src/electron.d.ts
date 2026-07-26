interface LetterBoxSessionBridge {
  load(): Promise<string | null>;
  save(value: string): Promise<void>;
  clear(): Promise<void>;
}

interface Window {
  letterBoxSession?: LetterBoxSessionBridge;
}
