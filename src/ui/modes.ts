import type { PairMode } from '../types';
import type { SegmentedOption } from './Segmented';

export const MONITOR_MODE_OPTIONS: readonly SegmentedOption<PairMode>[] = [
  {
    value: 'passphrase',
    label: 'Passphrase',
    hint: 'Type the same passphrase on both phones. Easiest option — needs internet to make the connection.',
  },
  {
    value: 'link',
    label: 'Share a link',
    hint: 'Send an invite link over WhatsApp or iMessage. No third-party server involved, but takes two steps.',
  },
];

export const RECEIVER_MODE_OPTIONS: readonly SegmentedOption<PairMode>[] = [
  { value: 'passphrase', label: 'Passphrase' },
  {
    value: 'link',
    label: 'I have a link',
    hint: 'Open the invite link the monitor phone sent you, then enter the passphrase.',
  },
];
