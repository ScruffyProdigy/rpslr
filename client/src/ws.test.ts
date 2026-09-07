import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectMatchSocket } from './ws';

/** Minimal stand-in for the browser WebSocket, so we can drive open/close. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('connectMatchSocket', () => {
  it('reports the drop so callers can show a reconnecting state', () => {
    const onClose = vi.fn();
    connectMatchSocket('RPS-1234', 'player-a', { onState: () => {}, onClose });

    FakeSocket.instances[0].open();
    expect(onClose).not.toHaveBeenCalled();

    FakeSocket.instances[0].close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reconnects, re-subscribes, and reports the reopen', () => {
    const onOpen = vi.fn();
    connectMatchSocket('RPS-1234', 'player-a', { onState: () => {}, onOpen });

    FakeSocket.instances[0].open();
    FakeSocket.instances[0].close();
    vi.advanceTimersByTime(5000);

    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.instances[1].open();
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(FakeSocket.instances[1].sent).toEqual([
      // Re-subscribing must carry the player id too, or a reconnect would look
      // to the server like the player never came back.
      JSON.stringify({ type: 'subscribe', ref: 'RPS-1234', playerId: 'player-a' }),
    ]);
  });

  it('stays quiet once the caller closes it', () => {
    const onClose = vi.fn();
    const socket = connectMatchSocket('RPS-1234', 'player-a', { onState: () => {}, onClose });

    FakeSocket.instances[0].open();
    socket.close();

    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
