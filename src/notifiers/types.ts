import type { DigestedReport } from '../types.js';

/**
 * Where the report goes. The counterpart to Source: Slack becomes slack.ts,
 * email becomes email.ts, and nothing upstream changes.
 *
 * One method, same reasoning as Source. There is one channel today.
 */
export interface Notifier {
  readonly channel: string;
  send(report: DigestedReport): Promise<void>;
}
