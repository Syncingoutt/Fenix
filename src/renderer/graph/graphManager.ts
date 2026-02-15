// Main graph/chart management

import { MAX_POINTS } from '../constants.js';
import { getWealthMode, getRealtimeHistory, getHourlyHistory, setRealtimeHistory, setHourlyHistory } from '../state/wealthState.js';

declare const Chart: any;

let chart: any = null;
let resizeObserver: ResizeObserver | null = null;
let resizeRafId: number | null = null;

function scheduleGraphResize(): void {
  if (!chart) return;
  if (resizeRafId !== null) {
    cancelAnimationFrame(resizeRafId);
  }
  resizeRafId = requestAnimationFrame(() => {
    resizeRafId = null;
    chart.resize();
    chart.update('none');
  });
}

/**
 * Initialize the main wealth graph
 */
export function initGraph(): void {
  const canvas = document.getElementById('wealth-graph') as HTMLCanvasElement;
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d')!;

  // Destroy existing chart if it exists
  if (chart) {
    chart.destroy();
  }
  resizeObserver?.disconnect();
  resizeObserver = null;

  const borderColor = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#7e7e7e';

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: 'Wealth (FE)',
        data: [],
        borderColor: '#DE5C0B',
        backgroundColor: 'rgba(222, 92, 11, 0.1)',
        borderWidth: 2,
        tension: 0.4,
        pointRadius: 0,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      devicePixelRatio: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 3) : 2,
      animation: false,
      normalized: true,
      scales: {
        x: {
          type: 'time',
          display: true,
          bounds: 'data',
          time: {
            minUnit: 'minute',
            tooltipFormat: 'HH:mm:ss',
            displayFormats: {
              minute: 'HH:mm',
              hour: 'HH:mm',
              day: 'MMM d, HH:mm'
            }
          },
          border: { color: borderColor },
          grid: { 
            display: false
          },
          ticks: {
            color: '#FAFAFA',
            autoSkip: true,
            includeBounds: true,
            maxTicksLimit: 10
          }
        },
        y: {
          display: true,
          border: { color: borderColor },
          grid: { 
            display: false
          },
          ticks: {
            color: '#FAFAFA',
            precision: 0,
            callback: function(value: any) {
              const num = value as number;
              return num % 1 === 0 ? num.toString() : '';
            }
          }
        }
      },
      parsing: false,
      plugins: {
        legend: { 
          display: false 
        },
        tooltip: {
          enabled: true,
          backgroundColor: '#272727',
          titleColor: '#FAFAFA',
          bodyColor: '#FAFAFA',
          borderColor: '#7E7E7E',
          borderWidth: 1,
          displayColors: false,
          boxWidth: 0,
          boxHeight: 0,
          callbacks: {
            title: (items: any[]) => {
              if (items.length === 0) return '';
              const item = items[0];
              const value = item.parsed.y;
              return `Wealth: ${Math.round(value)} FE`;
            },
            label: (context: any) => {
              const pointTime = context.parsed.x;
              if (!pointTime) return '';
              return new Date(pointTime).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
              });
            },
            footer: () => ''
          }
        },
        decimation: {
          enabled: true,
          algorithm: 'lttb',
          samples: 1000
        }
      },
      interaction: {
        intersect: false,
        mode: 'nearest',
        axis: 'x'
      }
    }
  });

  // Keep the canvas backing store in sync with CSS-driven container size changes.
  if (typeof ResizeObserver !== 'undefined') {
    const resizeTarget = canvas.parentElement ?? canvas;
    resizeObserver = new ResizeObserver(() => {
      scheduleGraphResize();
    });
    resizeObserver.observe(resizeTarget);
  }

  scheduleGraphResize();
  updateGraph();
}

export function resizeGraph(): void {
  scheduleGraphResize();
}

/**
 * Push a point to realtime history (always tracks)
 */
export function pushRealtimePoint(value: number): void {
  const now = Date.now();
  const point = { time: now, value: Math.round(value) };
  
  const realtimeHistory = getRealtimeHistory();
  
  // Always push to realtime history (Total tracking never stops)
  realtimeHistory.push(point);
  if (realtimeHistory.length > MAX_POINTS) {
    realtimeHistory.shift();
  }
  
  setRealtimeHistory(realtimeHistory);
  
  // Only update graph if we're in realtime mode
  if (getWealthMode() === 'realtime') {
    updateGraph();
  }
}

/**
 * Push a point to history (legacy - for mode-based tracking)
 */
export function pushPoint(value: number): void {
  const now = Date.now();
  const point = { time: now, value: Math.round(value) };
  
  const wealthMode = getWealthMode();
  const realtimeHistory = getRealtimeHistory();
  const hourlyHistory = getHourlyHistory();
  
  if (wealthMode === 'realtime') {
    realtimeHistory.push(point);
    if (realtimeHistory.length > MAX_POINTS) {
      realtimeHistory.shift();
    }
    setRealtimeHistory(realtimeHistory);
  } else {
    hourlyHistory.push(point);
    if (hourlyHistory.length > MAX_POINTS) {
      hourlyHistory.shift();
    }
    setHourlyHistory(hourlyHistory);
  }

  updateGraph();
}

/**
 * Update the graph with current history data
 */
export function updateGraph(): void {
  if (!chart) return;

  const wealthMode = getWealthMode();
  const currentHistory = wealthMode === 'realtime' ? getRealtimeHistory() : getHourlyHistory();
  let data = currentHistory.map((p) => ({ x: p.time, y: p.value }));

  const placeholder = document.getElementById('wealth-graph-placeholder');
  if (placeholder) {
    if (wealthMode === 'hourly' && currentHistory.length === 0) {
      placeholder.classList.add('visible');
    } else {
      placeholder.classList.remove('visible');
    }
  }

  chart.options.scales.x.ticks.maxTicksLimit = 10;
  if (currentHistory.length > 0) {
    const firstPointTime = currentHistory[0].time;
    const firstMinuteStart = Math.floor(firstPointTime / 60000) * 60000;
    const lastPointTime = currentHistory[currentHistory.length - 1].time;

    // Add an anchor point at the left bound so the line starts exactly at the first timestamp tick.
    if (firstMinuteStart < firstPointTime) {
      data = [{ x: firstMinuteStart, y: currentHistory[0].value }, ...data];
    }

    chart.data.datasets[0].data = data;
    chart.options.scales.x.min = firstMinuteStart;
    chart.options.scales.x.max = lastPointTime;
  } else {
    chart.data.datasets[0].data = data;
    chart.options.scales.x.min = undefined;
    chart.options.scales.x.max = undefined;
  }
  
  chart.update('none');
}
