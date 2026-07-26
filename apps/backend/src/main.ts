import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { AppModule } from './app.module';
import { configureRuntime, RuntimeOptions } from './runtime';

export interface ApiHandle {
  url: string;
  close(): Promise<void>;
}

export async function startApi(
  options: RuntimeOptions & { port?: number } = {},
): Promise<ApiHandle> {
  configureRuntime(options);
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true });
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
