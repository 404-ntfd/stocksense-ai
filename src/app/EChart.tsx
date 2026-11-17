// Thin React wrapper over Apache ECharts: modular imports, canvas renderer, no animation loops.
// Charts render once and resize on demand; nothing runs while the screen is idle.
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, HeatmapChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([BarChart, LineChart, PieChart, HeatmapChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, MarkAreaComponent, MarkLineComponent, CanvasRenderer]);

export function EChart({ option, height = 240, label, testId, onPoint }: { option: EChartsCoreOption; height?: number; label: string; testId?: string; onPoint?: (name: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const onPointRef = useRef(onPoint);
  onPointRef.current = onPoint;

  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, undefined, { renderer: 'canvas' });
    chart.current = c;
    c.on('click', (p) => { const name = (p as { name?: string }).name; if (name) onPointRef.current?.(name); });
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    return () => { ro.disconnect(); c.dispose(); chart.current = null; };
  }, []);

  useEffect(() => {
    chart.current?.setOption({ animation: false, ...option }, { notMerge: true });
  }, [option]);

  return <div ref={el} role="img" aria-label={label} data-testid={testId} style={{ height, width: '100%' }} />;
}
