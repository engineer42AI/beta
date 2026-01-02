// src/components/console/bus/index.ts
import { usePageBusChannel, useConsoleBusChannel } from "./useBusChannel";

/* Page-side  */
export const useAiChannel = () => {
  const ch = usePageBusChannel("ai");
  return {
    sendToAiConsole: ch.send,
    feedFromAiConsole: ch.feed,
    boundAiTabId: ch.boundTabId,
    isBoundToAiConsole: ch.isBound,
    canSendToAiConsole: ch.canSend,
  };
};

/* Console-side */
export const useAiConsoleChannel = (opts?: { maxFeed?: number }) => {
  const ch = useConsoleBusChannel("ai", opts);
  return {
    sendToPage: ch.sendToPage,
    feedFromPage: ch.feedFromPage,
    activeAiTabId: ch.activeAiTabId,
    isLinkedToPage: ch.isLinkedToPage,
    binding: ch.binding,
    clearFeedForCurrentTab: ch.clearFeedForCurrentTab,
  };
};

export const useTracesChannel = () => usePageBusChannel("traces"); // when you add traces bindings
export const useLogsChannel = () => usePageBusChannel("logs");     // when you add logs bindings
