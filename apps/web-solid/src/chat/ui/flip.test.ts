import { expect, test } from "bun:test"
import { flipTransform } from "./flip"

test("the picture starts centred on its thumbnail at the thumbnail's width", () => {
  const box = { left: 100, top: 50, width: 800, height: 600 }
  const thumb = { left: 20, top: 700, width: 100, height: 75 }
  // Centres: picture (500, 350), thumbnail (70, 737.5).
  expect(flipTransform(box, thumb)).toBe("translate(-430px, 387.5px) scale(0.125)")
})

test("a picture already at its thumbnail does not move", () => {
  const box = { left: 10, top: 10, width: 200, height: 100 }
  expect(flipTransform(box, box)).toBe("translate(0px, 0px) scale(1)")
})
