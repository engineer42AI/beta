// src/app/(protected)/system-b/browse-cert-specs-v4/console_workflow.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConsoleStore } from '@/stores/console-store';

export default function BrowseCertSpecsWorkflow() {
  const [input, setInput] = useState('');
  const sendMessageToPage = useConsoleStore((s) => s.sendToPage);

  const handleSubmit = () => {
    if (!input.trim()) return;
    // Simulate console → page event
    sendMessageToPage({
      pageKey: '/system-b/browse-cert-specs-v4',
      payload: { query: input, timestamp: new Date().toISOString() },
    });
    setInput('');
  };

  return (
    <div className="space-y-3">
      <textarea
        className="w-full border rounded p-2 min-h-[80px]"
        placeholder="Ask something about CS-25…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      <Button onClick={handleSubmit}>Submit to Page</Button>
    </div>
  );
}