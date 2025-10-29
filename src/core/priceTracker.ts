export function calculateAveragePrice(prices: number[]): number | null {
  if (prices.length < 50) {
    return null; // Not enough data
  }

  // Skip first 20 and last 20 listings
  const pricesForAverage = prices.length >= 40 
    ? prices.slice(20, -20)  // Skip first 20 and last 20
    : prices.slice(Math.floor(prices.length / 4), -Math.floor(prices.length / 4)); // Skip first/last 25% if less than 40
  
  const sum = pricesForAverage.reduce((acc, price) => acc + price, 0);
  return sum / pricesForAverage.length;
}

export function processPriceCheckData(baseId: string, prices: number[]): { baseId: string; avgPrice: number } | null {
  const avgPrice = calculateAveragePrice(prices);
  
  if (avgPrice === null) {
    return null;
  }

  return { baseId, avgPrice };
}