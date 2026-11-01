import { describe, expect, it } from "vitest";
import { paintTexture } from "../public/render.js";

function texture(cells, ages) {
  const scale = 4, now = 1000;
  const g = { cols: cells.length, rows: 1, fadeMs: 1000 };
  const out = new Uint8ClampedArray(g.cols * scale * scale * 4);
  const shadow = new Uint8ClampedArray(out.length);
  paintTexture(new Uint8Array(cells), new Float64Array(ages.map((age) => now - age)), now,
    g, ["#ffe600", "#4123d9"], out, shadow, scale);
  const pixel = (data, x, y = 1) => [...data.slice((y * g.cols * scale + x) * 4, (y * g.cols * scale + x) * 4 + 4)];
  return { out, shadow, pixel };
}

describe("paint texture", () => {
  it("shows each team's colour and only gives fresh paint a wet shadow", () => {
    const t = texture([1, 0, 2], [50, 0, 900]);
    expect(t.pixel(t.out, 1).slice(0, 3)).toEqual([255, 230, 0]);
    expect(t.pixel(t.shadow, 1)[3]).toBeGreaterThan(0);
    expect(t.pixel(t.out, 10).slice(0, 3)).toEqual([65, 35, 217]);
    expect(t.pixel(t.shadow, 10)[3]).toBe(0);
    expect(t.pixel(t.out, 5)[3]).toBeLessThan(t.pixel(t.out, 1)[3]);
  });

  it("fades the same owner through fresh, middle and old paint, then clears bare cells", () => {
    const opacity = [50, 700, 900].map((age) => {
      const t = texture([1], [age]);
      return t.pixel(t.out, 1)[3];
    });
    expect(opacity[0]).toBeGreaterThan(opacity[1]);
    expect(opacity[1]).toBeGreaterThan(opacity[2]);
    const bare = texture([0], [0]);
    expect(bare.out.every((value) => value === 0)).toBe(true);
    expect(bare.shadow.every((value) => value === 0)).toBe(true);
  });
});
