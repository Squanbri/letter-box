import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication, LoggerService } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { configureRuntime, RuntimeOptions } from './runtime';
import { FileCredentialStore } from './account/file-credential.store';

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
  configureRuntime({
    ...options,
    credentialStore: options.credentialStore ?? new FileCredentialStore(),
  });
  const app = await NestFactory.create(AppModule, {
    logger: new RuntimeLogger(),
  });
  app.setGlobalPrefix('api/v1');
  const allowedOrigins = process.env.CORS_ORIGINS
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      const nativeClient = !origin || origin === 'null';
      const configured = !allowedOrigins?.length || allowedOrigins.includes(origin ?? '');
      callback(null, nativeClient || configured);
    },
  });
  if (process.env.TRUST_PROXY === 'true') {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }
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
  const host = process.env.API_HOST ?? '127.0.0.1';
  await app.listen(port, host);
  const address = app.getHttpServer().address() as AddressInfo;
  const publicHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  const url = `http://${publicHost}:${address.port}`;
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
