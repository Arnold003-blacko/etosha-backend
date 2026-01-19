import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: true, // Allow all origins (same as backend CORS config)
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['*'],
  },
  namespace: '/dashboard',
  transports: ['websocket', 'polling'],
  allowEIO3: true,
})
export class DashboardGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(DashboardGateway.name);
  private clients: Map<string, Socket> = new Map();

  handleConnection(client: Socket) {
    this.clients.set(client.id, client);
    this.logger.log(`Client connected: ${client.id}`);
    
    // Send initial connection confirmation
    client.emit('connected', { message: 'Connected to dashboard updates' });
  }

  handleDisconnect(client: Socket) {
    this.clients.delete(client.id);
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /**
   * Broadcast dashboard update to all connected clients
   */
  broadcastDashboardUpdate() {
    this.server.emit('dashboard-update', {
      timestamp: new Date().toISOString(),
      message: 'Dashboard data has been updated',
    });
    this.logger.log('Broadcasting dashboard update to all clients');
  }

  /**
   * Get the number of connected clients
   */
  getConnectedClientsCount(): number {
    return this.clients.size;
  }
}
