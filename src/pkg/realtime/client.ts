import type { SyncOperation } from '../types.js';
import type { 
  RealtimeClientConfig, 
  RealtimeClientConfigResolved, 
  RealtimeStatus,
  RealtimeEvent,
  OperationsEvent
} from './types.js';
import { EventEmitter } from './event-emitter.js';

/**
 * Client-side realtime connection manager.
 * Handles SSE connections with automatic reconnection and polling fallback.
 */
export class RealtimeClient extends EventEmitter {
  private config: RealtimeClientConfigResolved;
  private eventSource: EventSource | null = null;
  private status: RealtimeStatus = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private clientId: string = '';
  private lastEventId: string = '';

  constructor(config: RealtimeClientConfig = {}) {
    super();
    this.config = this.resolveConfig(config);
  }

  private resolveConfig(config: RealtimeClientConfig): RealtimeClientConfigResolved {
    return {
      enabled: config.enabled ?? true,
      endpoint: config.endpoint ?? '/api/sync/realtime',
      tables: config.tables ?? [], // Empty = all tables
      reconnectInterval: config.reconnectInterval ?? 1000,
      maxReconnectInterval: config.maxReconnectInterval ?? 30000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
      heartbeatTimeout: config.heartbeatTimeout ?? 45000,
      onStatusChange: config.onStatusChange ?? (() => {}),
      onOperations: config.onOperations ?? (() => {}),
      onError: config.onError ?? (() => {}),
    };
  }

  /**
   * Initialize the realtime client with a client ID
   */
  init(clientId: string): void {
    this.clientId = clientId;
    if (this.config.enabled) {
      this.connect();
    }
  }

  /**
   * Update configuration at runtime
   */
  configure(config: Partial<RealtimeClientConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current connection status
   */
  getStatus(): RealtimeStatus {
    return this.status;
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return this.status === 'connected';
  }

  /**
   * Connect to the SSE endpoint
   */
  connect(): void {
    if (!this.config.enabled) {
      console.warn('Realtime is disabled');
      return;
    }

    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      console.warn('SSE not available, using polling fallback');
      this.setStatus('fallback');
      return;
    }

    if (this.eventSource) {
      this.disconnect();
    }

    this.setStatus('connecting');

    try {
      const url = this.buildEndpointUrl();
      this.eventSource = new EventSource(url);

      this.eventSource.onopen = () => {
        this.reconnectAttempts = 0;
        this.setStatus('connected');
        this.startHeartbeatMonitor();
        this.emit('connected', {});
      };

      this.eventSource.onmessage = (event) => {
        this.handleMessage(event);
      };

      this.eventSource.onerror = (error) => {
        this.handleError(error);
      };

      // Listen for specific event types
      this.eventSource.addEventListener('operations', (event: MessageEvent) => {
        this.handleOperationsEvent(event);
      });

      this.eventSource.addEventListener('heartbeat', () => {
        this.resetHeartbeatMonitor();
      });

    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Disconnect from the SSE endpoint
   */
  disconnect(): void {
    this.clearTimers();

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.setStatus('disconnected');
    this.emit('disconnected', {});
  }

  /**
   * Force reconnection
   */
  reconnect(): void {
    this.disconnect();
    this.reconnectAttempts = 0;
    this.connect();
  }

  /**
   * Enable realtime and connect
   */
  enable(): void {
    this.config.enabled = true;
    this.connect();
  }

  /**
   * Disable realtime and disconnect
   */
  disable(): void {
    this.config.enabled = false;
    this.disconnect();
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.disconnect();
    this.removeAllListeners();
  }


  private buildEndpointUrl(): string {
    const url = new URL(this.config.endpoint, window.location.origin);
    url.searchParams.set('clientId', this.clientId);
    
    if (this.config.tables.length > 0) {
      url.searchParams.set('tables', this.config.tables.join(','));
    }
    
    if (this.lastEventId) {
      url.searchParams.set('lastEventId', this.lastEventId);
    }
    
    return url.toString();
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const data: RealtimeEvent = JSON.parse(event.data);
      
      if (event.lastEventId) {
        this.lastEventId = event.lastEventId;
      }

      this.emit(data.type, data.data);
    } catch (error) {
      console.error('Failed to parse SSE message:', error);
    }
  }

  private handleOperationsEvent(event: MessageEvent): void {
    try {
      const data: OperationsEvent = JSON.parse(event.data);
      
      if (event.lastEventId) {
        this.lastEventId = event.lastEventId;
      }

      this.resetHeartbeatMonitor();
      this.config.onOperations(data.operations);
      this.emit('operations', data.operations);
    } catch (error) {
      console.error('Failed to parse operations event:', error);
    }
  }

  private handleError(error: any): void {
    console.error('SSE error:', error);
    
    this.clearTimers();
    
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.config.onError(error instanceof Error ? error : new Error('SSE connection failed'));
    this.emit('error', error);

    // Attempt reconnection with exponential backoff
    if (this.reconnectAttempts < this.config.maxReconnectAttempts) {
      this.scheduleReconnect();
    } else {
      console.warn('Max reconnect attempts reached, falling back to polling');
      this.setStatus('fallback');
      this.emit('fallback', {});
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(2, this.reconnectAttempts),
      this.config.maxReconnectInterval
    );

    this.reconnectAttempts++;
    this.setStatus('connecting');

    console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private startHeartbeatMonitor(): void {
    this.resetHeartbeatMonitor();
  }

  private resetHeartbeatMonitor(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
    }

    this.heartbeatTimer = setTimeout(() => {
      console.warn('Heartbeat timeout, reconnecting...');
      this.handleError(new Error('Heartbeat timeout'));
    }, this.config.heartbeatTimeout);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private setStatus(status: RealtimeStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.config.onStatusChange(status);
      this.emit('statusChange', status);
    }
  }
}

/**
 * Create a realtime client with the given configuration.
 * Simple factory function for ease of use.
 */
export function createRealtimeClient(config?: RealtimeClientConfig): RealtimeClient {
  return new RealtimeClient(config);
}
