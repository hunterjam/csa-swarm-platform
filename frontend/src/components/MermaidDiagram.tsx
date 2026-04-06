'use client';

import { useEffect, useId, useRef } from 'react';

interface Props {
  source: string;
}

export default function MermaidDiagram({ source }: Props) {
  const id = useId().replace(/:/g, '');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!source || !containerRef.current) return;

    let cancelled = false;
    (async () => {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' });
      try {
        const { svg } = await mermaid.render(`mermaid-${id}`, source);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (err) {
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = `<pre class="text-red-500 text-xs whitespace-pre-wrap">${String(err)}</pre>`;
        }
      }
    })();

    return () => { cancelled = true; };
  }, [source, id]);

  return <div ref={containerRef} className="overflow-auto" />;
}
