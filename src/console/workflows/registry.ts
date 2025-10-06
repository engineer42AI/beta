// src/console/workflows/registry.ts
export type ConsoleWorkflowProps = {
  tabId: string;
  originKey: string;        // route the tab belongs to
};

type Loader = () => Promise<{ default: React.ComponentType<ConsoleWorkflowProps> }>;

const map: Array<{ test: (route: string) => boolean; load: Loader }> = [
  {
    test: (r) => r.startsWith("/system-b/browse-cert-specs-V4"),
    load: () =>
      import("@/app/(protected)/system-b/browse-cert-specs-V4/console_workflow"),
  },
  // add more pages here…
];

export async function loadWorkflowFor(originKey: string) {
  switch (originKey) {
    case '/system-b/browse-cert-specs-v4':
      return (await import('@/app/(protected)/system-b/browse-cert-specs-v4/console_workflow')).default;
    default:
      return null;
  }
}