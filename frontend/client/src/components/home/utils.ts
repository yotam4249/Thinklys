export function gradientFromSeed(seed: string) {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    const h1 = h % 360;
    const h2 = (h1 + 40 + (h % 40)) % 360;
    return `linear-gradient(135deg, hsl(${h1} 80% 60%), hsl(${h2} 75% 55%))`;
  }
  
  export function fmtTime(iso?: string) {
    return iso ? new Date(iso).toLocaleString() : "";
  }
  