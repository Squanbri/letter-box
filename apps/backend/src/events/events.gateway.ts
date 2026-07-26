import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { ServerEvent } from '@letter-box/contracts';
import { Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import {
  ACCOUNT_REPOSITORY,
  AccountRepositoryContract,
} from '../database/repository.contracts';

@WebSocketGateway({
  cors: { origin: true },
})
export class EventsGateway implements OnGatewayConnection {
  @WebSocketServer()
  private server!: Server;

  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(ACCOUNT_REPOSITORY)
    private readonly accounts: AccountRepositoryContract,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string') {
      socket.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      socket.data.userId = payload.sub;
    } catch {
      socket.disconnect(true);
    }
  }

  publish(event: ServerEvent): void {
    if (!this.server) return;
    void this.publishToOwners(event);
  }

  private async publishToOwners(event: ServerEvent): Promise<void> {
    const sockets = await this.server.fetchSockets();
    await Promise.all(sockets.map(async (socket) => {
      const userId = socket.data.userId;
      if (typeof userId !== 'string') return;
      if (await this.accounts.find(userId, event.accountId)) {
        socket.emit('server.event', event);
      }
    }));
  }
}
