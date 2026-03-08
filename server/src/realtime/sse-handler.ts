import type { Context } from 'hono';
import { createSubscriber } from './redis';
import type { SSEEvent } from './publisher';

/**
 * Creates an SSE Response that subscribes to Redis channels and streams events.
 *
 * @param c - Hono context
 * @param channels - Redis channels to subscribe to
 * @param onConnect - Optional callback returning initial state snapshot
 */
export function createSSEStream(
  c: Context,
  channels: string[],
  onConnect?: () => Promise<SSEEvent | null>,
): Response {
  let sub: ReturnType<typeof createSubscriber> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      function send(data: string) {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // Controller closed — client disconnected
        }
      }

      // Send connected event
      send(JSON.stringify({ type: 'connected' }));

      // Send initial state snapshot if callback provided
      if (onConnect) {
        try {
          const snapshot = await onConnect();
          if (snapshot) {
            send(JSON.stringify(snapshot));
          }
        } catch (err) {
          console.error('SSE onConnect error:', (err as Error).message);
        }
      }

      // Create dedicated Redis subscriber
      sub = createSubscriber();

      sub.on('message', (_channel: string, message: string) => {
        send(message);
      });

      try {
        await sub.subscribe(...channels);
      } catch (err) {
        console.error('Redis subscribe error:', (err as Error).message);
      }

      // Heartbeat every 30 seconds
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          if (heartbeat) clearInterval(heartbeat);
        }
      }, 30_000);
    },

    cancel(_reason) {
      if (heartbeat) clearInterval(heartbeat);
      if (sub) {
        sub.unsubscribe().catch(() => {});
        sub.quit().catch(() => {});
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
