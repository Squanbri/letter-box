interface LetterBoxSessionBridge {
  load(): Promise<string | null>;
  save(value: string): Promise<void>;
  clear(): Promise<void>;
}

interface LetterBoxComposeBridge {
  open(payload: unknown): Promise<string>;
  load(id: string): Promise<unknown>;
  close(id: string): Promise<void>;
}

interface LetterBoxWindowBridge {
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  close(): Promise<void>;
}

interface Window {
  letterBoxSession?: LetterBoxSessionBridge;
  letterBoxCompose?: LetterBoxComposeBridge;
  letterBoxWindow?: LetterBoxWindowBridge;
}
