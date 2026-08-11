import { logger } from '../log.js';
import type { DigestedReport } from '../types.js';
import { buildPayload } from './discord.js';
import type { Notifier } from './types.js';

/**
 * Prints the report instead of posting it. Used by `--dry-run`.
 *
 * It renders the digest for a human to read AND dumps the exact Discord
 * payload, so a dry run verifies the real embed rather than a stand-in --
 * a field over Discord's length limit shows up here, not in production.
 */
export function createConsoleNotifier(): Notifier {
  const log = logger('report');

  return {
    channel: 'console',

    async send(report: DigestedReport): Promise<void> {
      const payload = buildPayload(report);
      const embed = payload.embeds[0];

      console.log('');
      console.log('─'.repeat(72));
      console.log(embed?.title ?? 'Campaign Video Report');
      console.log('─'.repeat(72));
      console.log(report.digest);
      console.log('');

      for (const field of embed?.fields ?? []) {
        console.log(`${field.name}: ${field.value.replace(/\n/g, '\n  ')}`);
      }

      console.log('─'.repeat(72));
      console.log(`(${embed?.footer.text ?? ''})`);
      console.log('');
      log.info('exact Discord payload that would have been posted:');
      console.log(JSON.stringify(payload, null, 2));
    },
  };
}
