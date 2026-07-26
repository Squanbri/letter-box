import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Public } from './auth/public.decorator';
import { PrismaDatabaseService } from './database/prisma-database.service';
import { SyncQueueService } from './sync/sync-queue.service';

interface HealthResponse {
  status: 'ok';
}

interface ReadinessResponse extends HealthResponse {
  postgres: 'ok';
  redis: 'ok';
  syncWorkers: number;
}

@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly database: PrismaDatabaseService,
    private readonly syncQueue: SyncQueueService,
  ) {}

  @Get()
  live(): HealthResponse {
    return { status: 'ok' };
  }

  @Get('live')
  getLive(): HealthResponse {
    return this.live();
  }

  @Get('ready')
  async ready(): Promise<ReadinessResponse> {
    try {
      const [, syncWorkers] = await Promise.all([
        this.database.ping(),
        this.syncQueue.workerCount(),
      ]);
      if (syncWorkers < 1) {
        throw new Error('Нет доступных sync workers');
      }
      return {
        status: 'ok',
        postgres: 'ok',
        redis: 'ok',
        syncWorkers,
      };
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Неизвестная ошибка readiness';
      throw new ServiceUnavailableException(message);
    }
  }
}
