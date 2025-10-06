// src/components/console/bus/index.ts
import { useBusChannel } from "./useBusChannel";

export const useAiChannel = () => {
  const ch = useBusChannel("ai");
  return {
    sendToAiConsole: ch.send,
    feedFromAiConsole: ch.feed,
    boundAiTabId: ch.boundTabId,
    isBoundToAiConsole: ch.isBound,
    canSendToAiConsole: ch.canSend,
  };
};

export const useTracesChannel = () => useBusChannel("traces"); // when you add traces bindings
export const useLogsChannel = () => useBusChannel("logs");     // when you add logs bindings
