/** A refused write shows a warning that stays, with « Exporter le bureau » (backlog T0-4). */
import { describe, expect, it } from 'vitest';
import { reportStorageFailure } from '@oel/collab-client';
import { toastHistory, toastQueue } from '@oel/emboss';
import { warnOnStorageFailure } from '../src/bureau/storageWarning';

const quota = () => new DOMException('Quota exceeded', 'QuotaExceededError');

describe('storage warning', () => {
  it('stays on screen, once, and offers the export', () => {
    let exported = 0;
    const stop = warnOnStorageFailure(() => exported++);
    reportStorageFailure(quota());
    reportStorageFailure(quota());
    const warnings = toastQueue.visibleToasts.filter((q) => q.content.tone === 'warning');
    expect(warnings).toHaveLength(1);
    const [warning] = warnings as [(typeof warnings)[number]];
    expect(warning.timeout).toBeUndefined();
    expect(toastHistory.get().items[0]?.title).toBe('Plus d’espace sur cet appareil');
    warning.content.action!.onAction();
    expect(exported).toBe(1);
    stop();
  });

  it('does not call a full disk a private window', () => {
    // A new subscriber hears the full disk at once…
    const stop = warnOnStorageFailure(() => {});
    const items = () => toastHistory.get().items;
    expect(items()[0]?.title).toBe('Plus d’espace sur cet appareil');
    const before = items().length;
    // …and Firefox's refusals that follow are the same failure, already on screen.
    reportStorageFailure(new DOMException('No mutations', 'InvalidStateError'));
    expect(items()).toHaveLength(before);
    stop();
  });
});
