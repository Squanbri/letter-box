import { Body, Controller, Post } from '@nestjs/common';

interface RendererLog {
  level?: 'info' | 'warn' | 'error';
  message?: string;
  stack?: string;
}

@Controller('diagnostics')
export class DiagnosticsController {
  @Post('log')
  writeRendererLog(@Body() entry: RendererLog): { logged: true } {
    const message = String(entry.message ?? 'Сообщение renderer').slice(0, 4000);
    const stack = entry.stack ? String(entry.stack).slice(0, 8000) : undefined;
    const writer = entry.level === 'warn'
      ? console.warn
      : entry.level === 'info'
        ? console.info
        : console.error;

    writer('[renderer]', message, stack ?? '');
    return { logged: true };
  }
}

