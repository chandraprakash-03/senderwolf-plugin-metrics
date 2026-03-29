/**
 * Type definitions for @senderwolf/plugin-metrics
 */

export interface MetricsStats {
    /** Currently busy SMTP connections */
    activeConnections: number;
    /** Connections established but idle */
    idleConnections: number;
    /** Jobs waiting for a free connection slot */
    queuedRequests: number;
    /** Pool's configured max connection limit */
    maxConnections: number;
    /** Cumulative successful email deliveries since construction or last reset() */
    totalSent: number;
    /** Cumulative failed delivery attempts since construction or last reset() */
    failedDeliveries: number;
    /** Cumulative estimated bytes sent through the pool */
    pooledBytes: number;
    /** Seconds since MetricsPlugin was constructed or last reset() */
    uptime: number;
    /** Epoch milliseconds of this snapshot */
    timestamp: number;
}

export declare class MetricsPlugin {
    constructor();

    /**
     * Monkey-patch a live SMTPConnectionPool to intercept sends and failures.
     * Must be called once before any emails are sent through the pool.
     *
     * @example
     * import { SMTPConnectionPool } from 'senderwolf';
     * import { MetricsPlugin } from '@senderwolf/plugin-metrics';
     *
     * const pool = new SMTPConnectionPool({ maxConnections: 5 });
     * const metrics = new MetricsPlugin().instrument(pool);
     */
    instrument(pool: object): this;

    /**
     * Returns a live statistics snapshot of the instrumented pool.
     */
    getStats(): MetricsStats;

    /**
     * Reset all accumulator counters (totalSent, failedDeliveries, pooledBytes, uptime).
     * Does NOT affect pool-level connection state.
     */
    reset(): void;

    /**
     * Start a lightweight HTTP server exposing metrics endpoints.
     *
     * Endpoints:
     *   GET /metrics       → JSON (MetricsStats)
     *   GET /metrics/text  → Prometheus text format
     *   GET /health        → { status: "ok", uptime: number }
     *
     * @param port Default: 9100
     */
    startServer(port?: number): Promise<void>;

    /**
     * Gracefully stop the HTTP metrics server.
     */
    stopServer(): Promise<void>;
}
