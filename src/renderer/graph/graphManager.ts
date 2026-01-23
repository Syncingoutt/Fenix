// Main graph/chart management

import { MAX_POINTS } from '../constants.js';
import { getWealthMode, getRealtimeHistory, getHourlyHistory, setRealtimeHistory, setHourlyHistory } from '../state/wealthState.js';

declare const Chart: any;

let chart: any = null;

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

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
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
      scales: {
        x: {
          display: true,
          grid: { 
            color: '#7E7E7E',
            drawBorder: false
          },
          ticks: {
            color: '#FAFAFA',
            maxTicksLimit: 10
          }
        },
        y: {
          display: true,
          grid: { 
            color: '#7E7E7E',
            drawBorder: false
          },
          ticks: {
            color: '#FAFAFA',
            callback: function(value: any) {
              const num = value as number;
              // Only show decimal if non-zero
              return num % 1 === 0 ? num.toFixed(0) : num.toFixed(1);
            }
          }
        }
      },
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
              if (items.length === 0 || !chart) return '';
              const item = items[0];
              const value = item.parsed.y;
              // Format value - only show decimal if non-zero
              const formatted = value % 1 === 0 ? value.toFixed(0) : value.toFixed(1);
              return `Wealth: ${formatted} FE`;
            },
            label: (context: any) => {
              if (!chart) return '';
              const dataIndex = context.dataIndex;
              
              // Get current history from chart (updated dynamically)
              const currentHistory = (chart as any).currentHistory || 
                (getWealthMode() === 'realtime' ? getRealtimeHistory() : getHourlyHistory());
              
              if (dataIndex >= 0 && dataIndex < currentHistory.length) {
                const point = currentHistory[dataIndex];
                const date = new Date(point.time);
                
                // Round to nearest minute (60 seconds) for smoother timestamp updates
                const roundedSeconds = Math.floor(date.getSeconds() / 60) * 60;
                const roundedDate = new Date(date);
                roundedDate.setSeconds(roundedSeconds);
                roundedDate.setMilliseconds(0);
                
                const hours = roundedDate.getHours().toString().padStart(2, '0');
                const minutes = roundedDate.getMinutes().toString().padStart(2, '0');
                return `${hours}:${minutes}`;
              }
              return '';
            },
            footer: () => '' // Remove default footer
          }
        }
      },
      interaction: {
        intersect: false,
        mode: 'index'
      }
    }
  });

  updateGraph();
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

  // Calculate time interval based on session length
  const sessionDurationHours = currentHistory.length / 3600;
  let intervalMinutes = 60;
  
  if (sessionDurationHours > 5) {
    intervalMinutes = 120;
  }
  if (sessionDurationHours > 10) {
    intervalMinutes = 180;
  }
  if (sessionDurationHours > 20) {
    intervalMinutes = 240;
  }

  const labels = currentHistory.map((p, index) => {
    const date = new Date(p.time);
    const minutes = date.getMinutes();
    const hours = date.getHours();
    
    if (index === 0 || index === currentHistory.length - 1) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }
    
    if (currentHistory.length > 0) {
      const elapsedMinutes = Math.floor((p.time - currentHistory[0].time) / 60000);
      if (elapsedMinutes % intervalMinutes === 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      }
    }
    
    return '';
  });

  const data = currentHistory.map(p => p.value);

  chart.data.labels = labels;
  chart.data.datasets[0].data = data;
  chart.options.scales.x.ticks.maxTicksLimit = Math.min(12, Math.ceil(sessionDurationHours));
  
  // Store history reference in chart for tooltip callbacks
  (chart as any).currentHistory = currentHistory;
  (chart as any).currentMode = wealthMode;
  
  chart.update('none');
}
