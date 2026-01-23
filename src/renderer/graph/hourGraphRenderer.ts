// Hour breakdown graph rendering

import { HourlyBucket } from '../types.js';

declare const Chart: any;

/**
 * Render a mini graph for a single hour in the breakdown modal
 */
export function renderHourGraph(bucket: HourlyBucket, index: number): void {
  const canvas = document.getElementById(`hourGraph${index}`) as HTMLCanvasElement;
  if (!canvas) return;
  
  const ctx = canvas.getContext('2d')!;
  
  if (bucket.history.length === 0) return;
  
  // Sample data to max 60 points for performance
  const sampleInterval = Math.max(1, Math.floor(bucket.history.length / 60));
  const sampledHistory = bucket.history.filter((_, i) => i % sampleInterval === 0 || i === bucket.history.length - 1);
  
  // Create labels showing time progression (always showing as if it's a full hour)
  const labels = Array.from({ length: 61 }, (_, i) => {
    if (i % 10 === 0) return `${i}m`;
    return '';
  });
  
  // Map the actual data across the full 60-minute span with timestamps
  const dataPoints: { x: number; y: number; time: number }[] = Array.from({ length: 61 }, (_, i) => {
    const dataIndex = Math.floor((i / 60) * (sampledHistory.length - 1));
    const point = sampledHistory[dataIndex];
    return {
      x: i,
      y: point ? point.value - bucket.startValue : 0,
      time: point ? point.time : 0
    };
  });
  
  // Calculate start time for this hour (approximate based on bucket)
  const hourStartTime = bucket.history.length > 0 ? bucket.history[0].time : Date.now();
  
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        data: dataPoints.map(p => p.y),
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
      animation: false,
      scales: {
        x: { 
          display: true,
          grid: { color: '#7E7E7E', drawBorder: false },
          ticks: { color: '#FAFAFA', maxTicksLimit: 7 }
        },
        y: { 
          display: true,
          grid: { color: '#7E7E7E', drawBorder: false },
          ticks: { 
            color: '#FAFAFA', 
            maxTicksLimit: 5,
            callback: function(value: any) {
              const num = value as number;
              // Only show decimal if non-zero
              return num % 1 === 0 ? num.toFixed(0) : num.toFixed(1);
            }
          }
        }
      },
      plugins: {
        legend: { display: false },
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
              // Format value - only show decimal if non-zero
              const formatted = value % 1 === 0 ? value.toFixed(0) : value.toFixed(1);
              return `${formatted} FE`;
            },
            label: (context: any) => {
              const dataIndex = context.dataIndex;
              
              if (dataIndex >= 0 && dataIndex < dataPoints.length) {
                const point = dataPoints[dataIndex];
                let date: Date;
                
                if (point.time > 0) {
                  date = new Date(point.time);
                } else {
                  // Fallback: calculate time from hour start + minutes
                  date = new Date(hourStartTime + dataIndex * 60000);
                }
                
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
}
