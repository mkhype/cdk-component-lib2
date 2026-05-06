export function hello(name: string): string {
  return `Hello, ${name}!`;
}

export function greet(name: string, greeting = "Hi"): string {
  return `${greeting}, ${name}2!`;
}
