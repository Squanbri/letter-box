interface LetterBoxSessionBridge {
  load(): Promise<string | null>;
  save(value: string): Promise<void>;
  clear(): Promise<void>;
  onUpdated?(listener: (value: string) => void): () => void;
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

interface LetterBoxOnboardingEvent {
  phase: 'waiting-browser' | 'waiting-code' | 'checking' | 'success' | 'error';
  email?: string;
  account?: unknown;
  message?: string;
}

interface LetterBoxAccountsBridge {
  addOAuth(input: { providerId: 'gmail' | 'yandex'; accountId?: string }): Promise<unknown>;
  addBasic(input: unknown): Promise<unknown>;
  submitOAuthCode(code: string): Promise<unknown>;
  cancelOAuth(): Promise<void>;
  forgetTokens(key: string): Promise<void>;
  onOnboarding(listener: (event: LetterBoxOnboardingEvent) => void): () => void;
}

interface Window {
  letterBoxSession?: LetterBoxSessionBridge;
  letterBoxCompose?: LetterBoxComposeBridge;
  letterBoxWindow?: LetterBoxWindowBridge;
  letterBoxAccounts?: LetterBoxAccountsBridge;
}
