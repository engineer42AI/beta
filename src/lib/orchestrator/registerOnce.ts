// src/lib/orchestrator/registerOnce.ts
type Handler = (msg: any) => void;

// Global registry keyed by bus instance, then by "channel::key"
const __REG__ =
  ((globalThis as any).__e42RegisterOnce__ as Map<any, Set<string>>) ??
  ( (globalThis as any).__e42RegisterOnce__ = new Map<any, Set<string>>() );

export function registerHandlerOnce(
  bus: any,
  channel: string,
  key: string,      // stable string like "agent.send/v1"
  fn: Handler
): boolean {
  let set = __REG__.get(bus);
  if (!set) {
    set = new Set<string>();
    __REG__.set(bus, set);
  }
  const token = `${channel}::${key}`;
  if (set.has(token)) return false;     // already registered

  bus.registerHandler(channel, fn);
  set.add(token);
  return true;
}