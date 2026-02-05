import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

// 🔒 WebSocket CORS configuration - matches backend CORS settings
const getWebSocketOrigins = () => {
  const corsOrigins = process.env.CORS_ORIGINS 
    ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
    : (process.env.NODE_ENV === 'production' ? [] : true); // Allow all in dev, none in prod unless specified
  return corsOrigins;
};

@WebSocketGateway({
  cors: {
    origin: getWebSocketOrigins(), // Use same CORS configuration as backend
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
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

  constructor(
    @Inject(forwardRef(() => DashboardService))
    private readonly dashboardService: DashboardService,
  ) {}

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
   * Also invalidates the dashboard stats cache
   */
  broadcastDashboardUpdate() {
    // ✅ PERFORMANCE: Invalidate cache when dashboard data changes
    this.dashboardService.invalidateDashboardCache();
    
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
