import { useEffect, useRef } from 'react'
import { fx } from '../fx.ts'

const VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}'
const FRAG = `
precision mediump float;
uniform vec2 r;
uniform float t, hue, energy, since, bhue;
vec3 hsv(float h, float s, float v) {
  vec3 k = clamp(abs(mod(h * 6. + vec3(0., 4., 2.), 6.) - 3.) - 1., 0., 1.);
  return v * mix(vec3(1.), k, s);
}
float fbm(vec2 p) {
  float a = .5, s = 0.;
  for (int i = 0; i < 4; i++) { s += a * sin(p.x) * sin(p.y); p = mat2(1.6, 1.2, -1.2, 1.6) * p + .7; a *= .5; }
  return s;
}
void main() {
  vec2 p = (gl_FragCoord.xy - .5 * r) / r.y;
  float tt = t * .035;
  vec2 q = vec2(fbm(p * 1.8 + tt), fbm(p * 1.8 - tt + 3.1));
  float f = fbm(p * 1.4 + q * (1.6 + energy) + tt * .6);
  float h = hue / 360.;
  vec3 col = mix(hsv(h, .8, .55), hsv(h + .13, .85, .45), smoothstep(-.6, .6, q.x));
  col = mix(col, hsv(h - .16, .75, .4), smoothstep(-.4, .7, f));
  float glow = smoothstep(1.4, 0., length(p - vec2(-.35, .55)));
  col *= .12 + .32 * glow + energy * .75 * (.3 + glow);
  // 完成時的一次綻放：從中心擴散的光環，3 秒內退回
  if (since < 4.) {
    float d = length(p), rad = since * .85, amp = exp(-since * 1.3);
    float ring = exp(-pow((d - rad) * 5., 2.));
    col += hsv(bhue / 360., .55, 1.) * (ring * .9 + exp(-d * 2.2) * .7) * amp;
  }
  col = mix(vec3(.047, .047, .055), col, .9);
  gl_FragColor = vec4(col, 1.);
}`

export function Backdrop() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false })
    if (!gl) return
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG))
    gl.bindAttribLocation(prog, 0, 'a')
    gl.linkProgram(prog)
    gl.useProgram(prog)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    const u = (n: string) => gl.getUniformLocation(prog, n)
    const [uR, uT, uHue, uEnergy, uSince, uBhue] = ['r', 't', 'hue', 'energy', 'since', 'bhue'].map(u)

    const bins = new Uint8Array(128)
    let hue = fx.hue
    let energy = 0
    let frame = 0
    let raf = 0
    const t0 = performance.now()

    const resize = () => {
      const scale = 0.5 // 半解析度，模糊本來就是想要的
      canvas.width = Math.max(1, Math.floor(innerWidth * scale))
      canvas.height = Math.max(1, Math.floor(innerHeight * scale))
      gl.viewport(0, 0, canvas.width, canvas.height)
    }
    resize()
    addEventListener('resize', resize)

    const loop = () => {
      raf = requestAnimationFrame(loop)
      const now = performance.now()
      const since = (now - fx.bloomAt) / 1000
      const active = fx.playing || since < 4 || energy > 0.01
      // 安靜時降到約 15fps
      if (!active && frame++ % 4) return
      let target = 0
      if (fx.playing && fx.analyser) {
        fx.analyser.getByteFrequencyData(bins)
        let sum = 0
        for (let i = 1; i < 24; i++) sum += bins[i]
        target = Math.min(1, Math.pow(sum / (23 * 255), 1.6) * 1.6)
      }
      energy += (target - energy) * (target > energy ? 0.35 : 0.08)
      hue += ((((fx.hue - hue) % 360) + 540) % 360 - 180) * 0.02
      gl.uniform2f(uR, canvas.width, canvas.height)
      gl.uniform1f(uT, (now - t0) / 1000)
      gl.uniform1f(uHue, hue)
      gl.uniform1f(uEnergy, energy)
      gl.uniform1f(uSince, since)
      gl.uniform1f(uBhue, fx.bloomHue)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    loop()
    return () => {
      cancelAnimationFrame(raf)
      removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={ref} className="backdrop" aria-hidden />
}
