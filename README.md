# @senderwolf/plugin-metrics

Auto-instruments the `SMTPConnectionPool` and exports live statistics — active connections, pooled bytes, failed deliveries — via JSON and Prometheus-compatible HTTP endpoints.

**Zero external dependencies.** Uses only Node.js built-ins.

---

## Installation

```bash
npm install @senderwolf/plugin-metrics
```

---

## Quick Start

```js
import { sendEmail, closeAllPools, getPoolStats } from 'senderwolf';
import { SMTPConnectionPool } from 'senderwolf/lib/connectionPool.js';
import { MetricsPlugin } from '@senderwolf/plugin-metrics';

// Create and instrument a pool
const pool = new SMTPConnectionPool({ maxConnections: 5 });
const metrics = new MetricsPlugin().instrument(pool);

// Start the metrics HTTP server
await metrics.startServer(9100); // optional

// Send emails normally
await sendEmail({ smtp: { usePool: true, ... }, mail: { ... } });

// Read stats programmatically
const stats = metrics.getStats();
console.log(stats);
// {
//   activeConnections: 1,
//   idleConnections: 0,
//   queuedRequests: 0,
//   maxConnections: 5,
//   totalSent: 12,
//   failedDeliveries: 0,
//   pooledBytes: 48320,
//   uptime: 34,
//   timestamp: 1711700000000
// }

// Stop server when done
await metrics.stopServer();
```

---

## HTTP Endpoints

| Endpoint | Description |
|---|---|
| `GET /metrics` | JSON snapshot of all stats |
| `GET /metrics/text` | Prometheus text format (compatible with `prometheus.yml` scrape config) |
| `GET /health` | `{ status: "ok", uptime: <seconds> }` |

### Example Prometheus scrape config

```yaml
scrape_configs:
  - job_name: senderwolf
    static_configs:
      - targets: ['localhost:9100']
    metrics_path: /metrics/text
```

---

## API

### `new MetricsPlugin()`

Creates a new plugin instance.

### `.instrument(pool)`

Monkey-patches a `SMTPConnectionPool` instance to intercept sends/failures. Call once, before any mail is sent. Returns `this` for chaining.

### `.getStats()` → `MetricsStats`

Returns a live stats snapshot. Fields:

| Field | Type | Description |
|---|---|---|
| `activeConnections` | `number` | Currently busy connections |
| `idleConnections` | `number` | Connected but idle |
| `queuedRequests` | `number` | Waiting for a free slot |
| `maxConnections` | `number` | Pool's configured maximum |
| `totalSent` | `number` | Cumulative successful sends |
| `failedDeliveries` | `number` | Cumulative send failures |
| `pooledBytes` | `number` | Estimated bytes sent (utf8) |
| `uptime` | `number` | Seconds since construction / last `reset()` |
| `timestamp` | `number` | Epoch ms of snapshot |

### `.reset()`

Zeroes `totalSent`, `failedDeliveries`, `pooledBytes`, and resets uptime. Does not affect the pool's connection state.

### `.startServer(port?: number)`

Starts the HTTP metrics server on the given port (default `9100`). Returns a `Promise<void>`.

### `.stopServer()`

Gracefully closes the HTTP server. Returns a `Promise<void>`.

---

## License

MIT © Chandraprakash
