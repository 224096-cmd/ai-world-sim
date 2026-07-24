// ============================================================
// シード付き疑似乱数 (mulberry32) と、地形生成用の簡易バリューノイズ
// 外部ライブラリに依存せず、毎回異なる/再現可能な世界を作れるようにする
// ============================================================

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** 0以上1未満の浮動小数 */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** min以上max未満 */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)];
  }

  /** 配列をシャッフルした新しい配列を返す */
  shuffle<T>(arr: readonly T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}

/**
 * 格子点に乱数を割り当て、双線形補間するだけの簡易バリューノイズ。
 * Perlin/Simplexほど滑らかではないが、大陸っぽい地形の起伏には十分。
 */
export class ValueNoise2D {
  private gridCache = new Map<string, number>();
  private seedOffset: number;

  constructor(rng: Rng, private cellSize: number) {
    // このノイズ場固有のオフセットをシードから決定
    // (rngを1回消費し、以後は座標ベースの決定論的ハッシュを使う)
    this.seedOffset = rng.next() * 10000;
  }

  private gridValue(gx: number, gy: number): number {
    const key = `${gx},${gy}`;
    let v = this.gridCache.get(key);
    if (v === undefined) {
      const hash =
        Math.sin(gx * 127.1 + gy * 311.7 + this.seedOffset) * 43758.5453;
      v = hash - Math.floor(hash);
      this.gridCache.set(key, v);
    }
    return v;
  }

  private smooth(t: number): number {
    return t * t * (3 - 2 * t);
  }

  sample(x: number, y: number): number {
    const gx = Math.floor(x / this.cellSize);
    const gy = Math.floor(y / this.cellSize);
    const fx = this.smooth((x % this.cellSize) / this.cellSize);
    const fy = this.smooth((y % this.cellSize) / this.cellSize);

    const v00 = this.gridValue(gx, gy);
    const v10 = this.gridValue(gx + 1, gy);
    const v01 = this.gridValue(gx, gy + 1);
    const v11 = this.gridValue(gx + 1, gy + 1);

    const top = v00 + (v10 - v00) * fx;
    const bottom = v01 + (v11 - v01) * fx;
    return top + (bottom - top) * fy;
  }

  /** オクターブを重ねてより自然な起伏にする */
  fractal(x: number, y: number, octaves = 4, persistence = 0.5): number {
    let total = 0;
    let amplitude = 1;
    let maxValue = 0;
    let freq = 1;
    for (let i = 0; i < octaves; i++) {
      total += this.sampleScaled(x * freq, y * freq) * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      freq *= 2;
    }
    return total / maxValue;
  }

  private sampleScaled(x: number, y: number): number {
    return this.sample(x, y);
  }
}
