export function calculateAveragePrice(prices: number[]): number | null {
  if (prices.length === 0) {
    return null; // No data at all
  }

  // For very small datasets, use all prices (maybe skip just 1 from each end if possible)
  if (prices.length <= 3) {
    return prices.reduce((acc, price) => acc + price, 0) / prices.length;
  }

  // For small datasets (4-19), skip first and last listing
  if (prices.length < 20) {
    const pricesForAverage = prices.slice(1, -1);
    const sum = pricesForAverage.reduce((acc, price) => acc + price, 0);
    return sum / pricesForAverage.length;
  }

  // For medium datasets (20-39), skip first/last 25%
  if (prices.length < 40) {
    const skipCount = Math.floor(prices.length / 4);
    const pricesForAverage = prices.slice(skipCount, -skipCount);
    const sum = pricesForAverage.reduce((acc, price) => acc + price, 0);
    return sum / pricesForAverage.length;
  }

  // For larger datasets (40+), use a more sophisticated approach:
  // - Skip fewer from the start (10-15%) since low prices are usually legitimate
  // - Skip more from the end (30-40%) to handle outliers and inflated prices
  const skipStart = Math.max(5, Math.floor(prices.length * 0.1)); // At least 5, or 10% of listings
  const skipEnd = Math.floor(prices.length * 0.35); // Skip 35% from the end to catch outliers
  
  // Make sure we have at least some prices left
  if (skipStart + skipEnd >= prices.length) {
    // Fallback: use middle 50%
    const skipCount = Math.floor(prices.length * 0.25);
    const pricesForAverage = prices.slice(skipCount, -skipCount);
    const sum = pricesForAverage.reduce((acc, price) => acc + price, 0);
    return sum / pricesForAverage.length;
  }
  
  const pricesForAverage = prices.slice(skipStart, -skipEnd);
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