import { hello } from "./index";

test("hello returns greeting", () => {
  expect(hello("world")).toBe("Hello, world!");
});
