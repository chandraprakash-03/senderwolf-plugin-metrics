/**
 * @senderwolf/plugin-metrics
 *
 * Auto-instruments an SMTPConnectionPool instance and exports statistics:
 *   - activeConnections  : currently busy connections
 *   - idleConnections    : connected but idle
 *   - queuedRequests     : jobs waiting for a free connection
 *   - totalSent          : lifetime successful deliveries
 *   - failedDeliveries   : lifetime failed delivery attempts
 *   - pooledBytes        : cumulative bytes sent through the pool
 *   - uptime             : seconds since MetricsPlugin was constructed
 *   - timestamp          : epoch ms of last stats snapshot
 *
 * HTTP endpoints (raw node:http, zero external deps):
 *   GET /metrics       → JSON
 *   GET /metrics/text  → Prometheus text format
 *   GET /health        → { status: "ok" }
 */

import http from 'node:http';

export class MetricsPlugin {
    constructor() {
        this._startedAt = Date.now();
        this._totalSent = 0;
        this._failedDeliveries = 0;
        this._pooledBytes = 0;
        this._pool = null;
        this._server = null;
        this._instrumented = false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Instrumentation
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Monkey-patch a live SMTPConnectionPool to intercept sends/failures.
     * Call this right after creating your pool (or after getConnectionPool).
     *
     * @param {import('senderwolf').SMTPConnectionPool} pool
     * @returns {this}
     */
    instrument(pool) {
        if (this._instrumented) {
            throw new Error('[plugin-metrics] Already instrumenting a pool. Create a new MetricsPlugin per pool.');
        }

        this._pool = pool;
        this._instrumented = true;

        const self = this;

        // Wrap createConnection to intercept the PooledSMTPConnection
        const originalCreateConnection = pool.createConnection.bind(pool);
        pool.createConnection = async function (config, key) {
            const conn = await originalCreateConnection(config, key);
            self._patchConnection(conn);
            return conn;
        };

        // Also patch any connections already inside pool.connections
        for (const conn of pool.connections.values()) {
            this._patchConnection(conn);
        }

        return this;
    }

    /**
     * Patch a PooledSMTPConnection instance (internal).
     */
    _patchConnection(conn) {
        if (conn.__metricsPatched) return;
        conn.__metricsPatched = true;

        const self = this;
        const originalSendMail = conn.sendMail.bind(conn);

        conn.sendMail = async function (mailOptions) {
            // Estimate bytes: sum header/body sizes roughly
            const estimatedBytes = self._estimateBytes(mailOptions);
            try {
                const messageId = await originalSendMail(mailOptions);
                self._totalSent++;
                self._pooledBytes += estimatedBytes;
                return messageId;
            } catch (err) {
                self._failedDeliveries++;
                throw err;
            }
        };
    }

    /**
     * Rough byte estimate of a mail payload.
     */
    _estimateBytes(mailOptions) {
        let size = 0;
        const count = (val) => {
            if (typeof val === 'string') size += Buffer.byteLength(val, 'utf8');
            else if (Buffer.isBuffer(val)) size += val.length;
        };
        count(mailOptions.subject || '');
        count(mailOptions.html || '');
        count(mailOptions.text || '');
        if (Array.isArray(mailOptions.attachments)) {
            for (const att of mailOptions.attachments) {
                count(att.content || '');
            }
        }
        return size;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Stats
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Returns a stats snapshot.
     * @returns {MetricsStats}
     */
    getStats() {
        const poolStats = this._pool ? this._pool.getStats() : {
            activeConnections: 0,
            idleConnections: 0,
            queuedRequests: 0,
            messagesSent: 0,
            maxConnections: 0,
        };

        return {
            activeConnections: poolStats.activeConnections,
            idleConnections: poolStats.idleConnections,
            queuedRequests: poolStats.queuedRequests,
            maxConnections: poolStats.maxConnections,
            totalSent: this._totalSent,
            failedDeliveries: this._failedDeliveries,
            pooledBytes: this._pooledBytes,
            uptime: Math.floor((Date.now() - this._startedAt) / 1000),
            timestamp: Date.now(),
        };
    }

    /**
     * Reset all accumulator counters (does NOT reset pool-level state).
     */
    reset() {
        this._totalSent = 0;
        this._failedDeliveries = 0;
        this._pooledBytes = 0;
        this._startedAt = Date.now();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HTTP Server (zero external deps — raw node:http)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Start a lightweight HTTP metrics server.
     * @param {number} [port=9100]
     * @returns {Promise<void>}
     */
    startServer(port = 9100) {
        return new Promise((resolve, reject) => {
            if (this._server) {
                return resolve();
            }

            this._server = http.createServer((req, res) => {
                const url = new URL(req.url, `http://localhost:${port}`);
                const pathname = url.pathname;

                if (req.method !== 'GET') {
                    res.writeHead(405, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'Method Not Allowed' }));
                }

                if (pathname === '/metrics') {
                    const stats = this.getStats();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify(stats, null, 2));
                }

                if (pathname === '/metrics/text') {
                    const stats = this.getStats();
                    const text = this._toPrometheusText(stats);
                    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
                    return res.end(text);
                }

                if (pathname === '/health') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ status: 'ok', uptime: Math.floor((Date.now() - this._startedAt) / 1000) }));
                }

                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Not Found' }));
            });

            this._server.once('error', reject);
            this._server.listen(port, () => {
                console.log(`[plugin-metrics] Metrics server listening on http://localhost:${port}`);
                resolve();
            });
        });
    }

    /**
     * Gracefully stop the HTTP server.
     * @returns {Promise<void>}
     */
    stopServer() {
        return new Promise((resolve) => {
            if (!this._server) return resolve();
            this._server.close(() => {
                this._server = null;
                resolve();
            });
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Prometheus text format
    // ─────────────────────────────────────────────────────────────────────────

    _toPrometheusText(stats) {
        const lines = [
            '# HELP senderwolf_active_connections Currently busy SMTP connections',
            '# TYPE senderwolf_active_connections gauge',
            `senderwolf_active_connections ${stats.activeConnections}`,
            '',
            '# HELP senderwolf_idle_connections SMTP connections connected but idle',
            '# TYPE senderwolf_idle_connections gauge',
            `senderwolf_idle_connections ${stats.idleConnections}`,
            '',
            '# HELP senderwolf_queued_requests Jobs waiting for a free connection',
            '# TYPE senderwolf_queued_requests gauge',
            `senderwolf_queued_requests ${stats.queuedRequests}`,
            '',
            '# HELP senderwolf_max_connections Pool max connection limit',
            '# TYPE senderwolf_max_connections gauge',
            `senderwolf_max_connections ${stats.maxConnections}`,
            '',
            '# HELP senderwolf_total_sent_total Cumulative successful email deliveries',
            '# TYPE senderwolf_total_sent_total counter',
            `senderwolf_total_sent_total ${stats.totalSent}`,
            '',
            '# HELP senderwolf_failed_deliveries_total Cumulative failed delivery attempts',
            '# TYPE senderwolf_failed_deliveries_total counter',
            `senderwolf_failed_deliveries_total ${stats.failedDeliveries}`,
            '',
            '# HELP senderwolf_pooled_bytes_total Cumulative bytes sent through the pool',
            '# TYPE senderwolf_pooled_bytes_total counter',
            `senderwolf_pooled_bytes_total ${stats.pooledBytes}`,
            '',
            '# HELP senderwolf_uptime_seconds Seconds since MetricsPlugin was constructed',
            '# TYPE senderwolf_uptime_seconds gauge',
            `senderwolf_uptime_seconds ${stats.uptime}`,
        ];
        return lines.join('\n');
    }
}
