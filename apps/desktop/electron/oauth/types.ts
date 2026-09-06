export interface AuthResult {
  type: 'oauth' | 'basic';
  email: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  password?: string;
}

export interface AuthStrategy {
  authenticate(context?: { email?: string }): Promise<AuthResult>;
}

export interface TokenResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export type OnboardingPhase =
  | 'waiting-browser'
  | 'waiting-code'
  | 'checking'
  | 'success'
  | 'error';

export interface OnboardingEvent {
  phase: OnboardingPhase;
  email?: string;
  account?: unknown;
  message?: string;
}
