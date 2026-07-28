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
    return process.env.OLLAMA_MODEL ?? 'qwen3:0.6b';
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
          num_predict: 48,
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
