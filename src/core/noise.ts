// ============================================================
// 地形生成用ノイズ (整数ハッシュ方式)
//
// 旧 ValueNoise2D は Math.sin ベースで負座標に弱く、値の分布も偏っていた。
// ここでは整数ハッシュ + Hermite補間で、負の座標でも破綻しない
// 素直なバリューノイズを実装し、fBm / リッジノイズを提供する。
// ============================================================

export class Noise2D {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  /** 格子点のハッシュ値 (0-1) */
  private hash(ix: number, iy: number): number {
    let h = (ix * 374761393 + iy * 668265263 + this.seed * 2654435761) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  private static smooth(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  /** 補間済みノイズ (0-1) */
  value(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = Noise2D.smooth(x - ix);
    const fy = Noise2D.smooth(y - iy);

    const v00 = this.hash(ix, iy);
    const v10 = this.hash(ix + 1, iy);
    const v01 = this.hash(ix, iy + 1);
    const v11 = this.hash(ix + 1, iy + 1);

    const top = v00 + (v10 - v00) * fx;
    const bottom = v01 + (v11 - v01) * fx;
    return top + (bottom - top) * fy;
  }

  /** 複数オクターブを重ねた起伏 (0-1) */
  fbm(x: number, y: number, octaves = 5, persistence = 0.5, lacunarity = 2): number {
    let total = 0;
    let amplitude = 1;
    let max = 0;
    let freq = 1;
    for (let i = 0; i < octaves; i++) {
      total += this.value(x * freq, y * freq) * amplitude;
      max += amplitude;
      amplitude *= persistence;
      freq *= lacunarity;
    }
    return total / max;
  }

  /** 尾根状のノイズ (山脈用, 0-1) */
  ridged(x: number, y: number, octaves = 4): number {
    let total = 0;
    let amplitude = 1;
    let max = 0;
    let freq = 1;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.value(x * freq, y * freq) * 2 - 1);
      total += n * n * amplitude;
      max += amplitude;
      amplitude *= 0.5;
      freq *= 2;
    }
    return total / max;
  }
}