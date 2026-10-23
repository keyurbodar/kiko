import fragment from "./glacier.frag?raw"

export function mountGlacier(canvas: HTMLCanvasElement): () => void {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, powerPreference: "low-power" })
  if (!gl) return () => {}

  const vertex = gl.createShader(gl.VERTEX_SHADER)
  const pixel = gl.createShader(gl.FRAGMENT_SHADER)
  const program = gl.createProgram()
  const buffer = gl.createBuffer()
  const release = () => {
    gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(pixel)
    gl.getExtension("WEBGL_lose_context")?.loseContext()
  }
  if (!vertex || !pixel || !program || !buffer) {
    release()
    return () => {}
  }
  gl.shaderSource(vertex, "attribute vec2 p;void main(){gl_Position=vec4(p,0,1);}")
  gl.shaderSource(pixel, fragment)
  gl.compileShader(vertex)
  gl.compileShader(pixel)
  gl.attachShader(program, vertex)
  gl.attachShader(program, pixel)
  gl.linkProgram(program)
  if (
    !gl.getShaderParameter(vertex, gl.COMPILE_STATUS) ||
    !gl.getShaderParameter(pixel, gl.COMPILE_STATUS) ||
    !gl.getProgramParameter(program, gl.LINK_STATUS)
  ) {
    release()
    return () => {}
  }
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, "p")
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  const resolution = gl.getUniformLocation(program, "r")
  const time = gl.getUniformLocation(program, "t")
  const density = gl.getUniformLocation(program, "d")
  const reduced = matchMedia("(prefers-reduced-motion: reduce)")
  let visible = true
  let lost = false
  let frame = 0
  let previous = 0
  let elapsed = 40
  let scale = 1

  const draw = () => {
    if (lost || !canvas.width || !canvas.height) return
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.uniform2f(resolution, canvas.width, canvas.height)
    gl.uniform1f(time, reduced.matches ? 40 : elapsed)
    gl.uniform1f(density, scale)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    canvas.dataset.ready = "true"
  }
  const tick = (now: number) => {
    if (now - previous >= 1000 / 30) {
      elapsed += Math.min((now - previous) / 1000, 0.1)
      previous = now
      draw()
    }
    frame = requestAnimationFrame(tick)
  }
  const sync = () => {
    cancelAnimationFrame(frame)
    if (lost || document.hidden || !visible) return
    draw()
    previous = performance.now()
    if (!reduced.matches) frame = requestAnimationFrame(tick)
  }
  const resize = () => {
    const { width, height } = canvas.getBoundingClientRect()
    scale = Math.min(devicePixelRatio || 1, 1.25, 1440 / Math.max(width, 1))
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    sync()
  }
  const resizeObserver = new ResizeObserver(resize)
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? false
    sync()
  })
  const contextLost = () => {
    lost = true
    cancelAnimationFrame(frame)
    delete canvas.dataset.ready
  }
  resizeObserver.observe(canvas)
  intersection.observe(canvas)
  document.addEventListener("visibilitychange", sync)
  reduced.addEventListener("change", sync)
  canvas.addEventListener("webglcontextlost", contextLost)
  resize()
  return () => {
    cancelAnimationFrame(frame)
    resizeObserver.disconnect()
    intersection.disconnect()
    document.removeEventListener("visibilitychange", sync)
    reduced.removeEventListener("change", sync)
    canvas.removeEventListener("webglcontextlost", contextLost)
    delete canvas.dataset.ready
    release()
  }
}
