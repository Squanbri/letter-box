import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication, LoggerService } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { configureRuntime, RuntimeOptions } from './runtime';

export interface ApiHandle {
  url: string;
  close(): Promise<void>;
}

class RuntimeLogger implements LoggerService {
  log(message: unknown, context?: string): void {
    console.info(this.prefix(context), message);
  }

  error(message: unknown, trace?: string, context?: string): void {
    console.error(this.prefix(context), message, trace ?? '');
  }

  warn(message: unknown, context?: string): void {
    console.warn(this.prefix(context), message);
  }

  debug(message: unknown, context?: string): void {
    console.info(this.prefix(context), message);
  }

  verbose(message: unknown, context?: string): void {
    console.info(this.prefix(context), message);
  }

  private prefix(context?: string): string {
    return context ? `[backend:${context}]` : '[backend]';
  }
}

export async function startApi(
  options: RuntimeOptions & { port?: number } = {},
): Promise<ApiHandle> {
  configureRuntime(options);
  const app = await NestFactory.create(AppModule, {
    logger: new RuntimeLogger(),
  });
  app.enableCors({ origin: true });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const startedAt = Date.now();
    response.on('finish', () => {
      console.info(
        '[backend:http]',
        request.method,
        request.path,
        response.statusCode,
        `${Date.now() - startedAt}ms`,
      );
    });
    next();
  });
  const port = options.port ?? Number(process.env.API_PORT ?? 3000);
  await app.listen(port, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;
  console.log(`Letter Box API: ${url}`);

  return {
    url,
    close: () => closeApi(app),
  };
}

async function closeApi(app: INestApplication): Promise<void> {
  await app.close();
}

if (require.main === module) {
  void startApi();
}
