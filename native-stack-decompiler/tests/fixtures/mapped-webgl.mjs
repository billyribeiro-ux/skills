import assert from "node:assert/strict";

export const mappedWebglInputs = {
  "src/main.ts":
    "import {mount} from './stage/mount'; mount(document.querySelector('canvas'));",
  "src/stage/mount.ts": `import {program} from './gl/program';
      export function mount(canvas: HTMLCanvasElement) {
        const gl=canvas.getContext('webgl',{preserveDrawingBuffer:true});
        if(!gl) throw Error('WebGL is unavailable');
        const p=program(gl);gl.useProgram(p);
        const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
        gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
        const position=gl.getAttribLocation(p,'position');
        gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
        const tint=gl.getUniformLocation(p,'tint');let held=0,scrolled=0,frame=0;
        canvas.addEventListener('pointerdown',()=>held=1);
        window.addEventListener('pointerup',()=>held=0);
        window.addEventListener('scroll',()=>scrolled=window.scrollY>100?1:0);
        function draw(){gl.uniform3f(tint,held,scrolled,(++frame%100)/100);
          gl.drawArrays(gl.TRIANGLES,0,3); requestAnimationFrame(draw);}
        draw();
      }`,
  "src/stage/gl/program.ts": `import vertex from './shaders/pass.vert';
      import fragment from './shaders/color.frag';
      export function program(gl: WebGLRenderingContext){
        const p=gl.createProgram();
        for(const [kind,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]] as const){
          const shader=gl.createShader(kind);gl.shaderSource(shader,source);gl.compileShader(shader);
          if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
          gl.attachShader(p,shader);
        }
        gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
        return p;
      }`,
  "src/stage/gl/shaders/pass.vert":
    "attribute vec2 position; void main(){gl_Position=vec4(position,0.,1.);}",
  "src/stage/gl/shaders/color.frag":
    "precision mediump float; uniform vec3 tint; void main(){gl_FragColor=vec4(tint,1.);}",
};

export async function assertWebglMotion(page) {
  const pixel = () =>
    page.evaluate(() => {
      const gl = document.querySelector("canvas").getContext("webgl");
      const bytes = new Uint8Array(4);
      gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      return [...bytes];
    });
  const baseline = await pixel();
  assert.deepEqual(baseline.slice(0, 2), [0, 0]);
  assert.equal(baseline[3], 255);
  const animate = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  await animate();
  assert.notEqual((await pixel())[2], baseline[2]);
  await page.mouse.move(32, 32);
  await page.mouse.down();
  await animate();
  assert.equal((await pixel())[0], 255);
  await page.mouse.wheel(0, 480);
  await page.waitForFunction(() => window.scrollY > 100);
  await animate();
  assert.deepEqual((await pixel()).slice(0, 2), [255, 255]);
  await page.mouse.up();
  await animate();
  assert.deepEqual((await pixel()).slice(0, 2), [0, 255]);
}
