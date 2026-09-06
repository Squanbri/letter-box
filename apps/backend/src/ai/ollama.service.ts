import { Injectable, Logger } from '@nestjs/common';
import {
  buildClassificationPrompt,
  parseClassificationResponse,
  type MessageTag,
} from './classification.tags';

@Injectable()
export class OllamaService {
  private readonly logger = new Logger(OllamaService.name);

  get enabled(): boolean {
    return process.env.OLLAMA_ENABLED !== 'false';
  }

  get baseUrl(): string {
    return (process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '');
  }

  get model(): string {
    return process.env.OLLAMA_MODEL ?? 'qwen2.5:7b';
  }

  /** True when the local Ollama HTTP API answers. */
  async healthy(timeoutMs = 2_000): Promise<boolean> {
    if (!this.enabled) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      return response.ok;
    } catch (error) {
      this.logger.warn(
        `Ollama недоступен (${this.baseUrl}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async classify(input: {
    subject: string | null;
    from: string | null;
    text: string;
  }): Promise<MessageTag[]> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: buildClassificationPrompt(input),
        stream: false,
        format: 'json',
        keep_alive: '30m',
        options: {
          temperature: 0.2,
          num_predict: 64,
        },
      }),
    });
    if (!response.ok) {
      const details = await response.text().catch(() => '');
      throw new Error(`Ollama ${response.status}: ${details.slice(0, 200)}`);
    }
    const payload = await response.json() as { response?: string };
    if (typeof payload.response !== 'string') {
      throw new Error('Ollama вернул пустой ответ');
    }
    this.logger.debug(`Ollama raw: ${payload.response.slice(0, 200)}`);
    return parseClassificationResponse(payload.response);
  }
}
