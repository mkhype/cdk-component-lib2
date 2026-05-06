"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hello = hello;
exports.greet = greet;
function hello(name) {
    return `Hello, ${name}!`;
}
function greet(name, greeting = "Hi") {
    return `${greeting}, ${name}!`;
}
//# sourceMappingURL=index.js.map