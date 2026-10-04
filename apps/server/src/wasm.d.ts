// Wrangler imports a `.wasm` file as a compiled `WebAssembly.Module` (its default `CompiledWasm` rule).
declare module "*.wasm" {
  const module: WebAssembly.Module
  export default module
}
