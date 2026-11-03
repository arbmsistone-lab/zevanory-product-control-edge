// ZEVANORY NC-007 / DEC-03: isolated P18-only worker. DRAFT ONLY.
// This entry point imports solely the P18 monitor; never the commercial worker.
import { runP18ExternalTrigger } from '../cf-worker/p18-dispatch.ts';

export type MonitorEnv = {
  P18_DISPATCH_TOKEN?: string;  // owner-owned Cloudflare secret; never in source or logs
  P18_STATE_KV?: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  };
};
export type MonitorController = { cron: string; scheduledTime: number };
export type MonitorContext = { waitUntil(promise: Promise<unknown>): void };

// Injectable runner is used only for offline proof of zero commercial side effects.
export function createP18OnlyHandler(runner: typeof runP18ExternalTrigger = runP18ExternalTrigger) {
  return {
    scheduled(controller: MonitorController, env: MonitorEnv, ctx: MonitorContext) {
      // Explicit environment allowlist: do NOT forward any Meta/Render/Telegram
      // token or commercial binding, even if accidentally provisioned.
      const monitorEnv: Record<string, unknown> = {
        P18_DISPATCH_TOKEN: env.P18_DISPATCH_TOKEN,
        T2_CREATIVE_ASSETS: env.P18_STATE_KV,
      };
      ctx.waitUntil(runner({ env: monitorEnv, scheduledTime: controller.scheduledTime }));
    },
  };
}

export default createP18OnlyHandler();
