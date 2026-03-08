import { getPubClient, businessChannel, jobChannel } from './redis';

export interface SSEEvent {
  type: 'agent_status' | 'cost_update' | 'new_logs' | 'task_update' | 'job_status';
  data: unknown;
}

/**
 * Fire-and-forget publisher. Publishes to BOTH business-wide and job-specific channels.
 * Redis blips never crash the worker.
 */
export async function publish(
  businessId: string,
  jobId: number,
  event: SSEEvent,
): Promise<void> {
  try {
    const payload = JSON.stringify(event);
    const pub = getPubClient();
    await Promise.all([
      pub.publish(businessChannel(businessId), payload),
      pub.publish(jobChannel(businessId, jobId), payload),
    ]);
  } catch (err) {
    console.error('Redis publish error (non-fatal):', (err as Error).message);
  }
}
