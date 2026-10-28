import { cameraBasis, type GlobeCamera, type GlobeGeometry } from "./globeMath";

const vertexSource = `attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`;
const fragmentSource = `precision highp float;
uniform vec2 u_size;
uniform vec2 u_center;
uniform float u_radius;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_front;
uniform sampler2D u_day;
uniform sampler2D u_night;
uniform sampler2D u_stars;
const float PI = 3.141592653589793;
void main() {
  vec2 pixel = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y);
  vec2 skyUv = vec2(pixel.x / max(u_size.x, u_size.y * 2.0), pixel.y / u_size.y);
  vec3 starMap = texture2D(u_stars, skyUv).rgb;
  float starBrightness = max(starMap.r,max(starMap.g,starMap.b));
  // Keep the catalogue's point sources while suppressing the diffuse Milky Way.
  vec2 starStep = vec2(2.0/1024.0,2.0/512.0);
  vec3 surrounding = (texture2D(u_stars,skyUv+vec2(starStep.x,0.0)).rgb
    + texture2D(u_stars,skyUv-vec2(starStep.x,0.0)).rgb
    + texture2D(u_stars,skyUv+vec2(0.0,starStep.y)).rgb
    + texture2D(u_stars,skyUv-vec2(0.0,starStep.y)).rgb) * 0.25;
  float pointContrast = starBrightness-max(surrounding.r,max(surrounding.g,surrounding.b));
  vec3 sky = vec3(4.0,5.0,9.0)/255.0 + starMap * smoothstep(0.16,0.38,pointContrast) * smoothstep(0.28,0.75,starBrightness);
  vec2 sphere = vec2(pixel.x-u_center.x, u_center.y-pixel.y) / u_radius;
  float distance = length(sphere);
  vec3 color = sky;
  if (distance <= 1.0) {
    vec3 normal = vec3(sphere, sqrt(max(0.0, 1.0-dot(sphere,sphere))));
    vec3 world = u_right*normal.x + u_up*normal.y + u_front*normal.z;
    vec2 uv = vec2(atan(world.x,world.z)/(2.0*PI)+0.5, 0.5-asin(clamp(world.y,-1.0,1.0))/PI);
    vec3 day = texture2D(u_day, uv).rgb;
    float ocean = smoothstep(0.03,0.18,day.b-max(day.r,day.g));
    day = mix(day,day*vec3(0.85,1.65,1.85),ocean*0.75);
    vec3 night = texture2D(u_night, uv).rgb;
    vec3 light = normalize(vec3(0.72, 0.28, 0.45));
    float solar = dot(normal,light);
    float daylight = smoothstep(-0.16,0.18,solar);
    vec3 lit = pow(day,vec3(0.90)) * mix(0.035,0.28+0.85*max(0.0,solar),daylight);
    color = lit + night * vec3(1.0,0.76,0.46) * (1.0-daylight) * 1.35;
    float atmosphere = pow(1.0-normal.z,5.0) * (0.18 + 0.60*max(0.0,solar));
    color += vec3(0.12,0.40,0.95)*atmosphere;
    color = mix(sky,color,1.0-smoothstep(0.997,1.0,distance));
  } else {
    float glow = exp(-(distance-1.0)*105.0) * 0.48;
    color += vec3(0.12,0.40,0.95)*glow;
  }
  gl_FragColor = vec4(color,1.0);
}`;

export interface GlobeRenderer { render(camera: GlobeCamera, geometry: GlobeGeometry): void; destroy(): void }
/** WebGL 1 uses one quad and three local power-of-two textures. No external runtime or API. */
export function createGlobeRenderer(canvas: HTMLCanvasElement, onAssetError: () => void, onTextureChange: () => void): GlobeRenderer | null {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
  if (!gl) return null;
  const shaders: WebGLShader[] = [];
  const textures: WebGLTexture[] = [];
  const images: HTMLImageElement[] = [];
  let destroyed = false;
  const compile = (kind: number, source: string) => {
    const shader = gl.createShader(kind);
    if (!shader) throw new Error("Could not allocate a globe shader");
    shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "Globe shader failed");
    return shader;
  };
  const program = gl.createProgram(), buffer = gl.createBuffer();
  if (!program || !buffer) { if (program) gl.deleteProgram(program); if (buffer) gl.deleteBuffer(buffer); return null; }
  const dispose = () => { destroyed = true; images.forEach(image => { image.onload = null; image.onerror = null; }); textures.forEach(texture => gl.deleteTexture(texture)); shaders.forEach(shader => gl.deleteShader(shader)); gl.deleteBuffer(buffer); gl.deleteProgram(program); };
  try {
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource)); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Globe shader link failed");
    gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_position"); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    ["earth-day-clouds-2048.jpg", "earth-night-2048.png", "stars-2020-1024.jpg"].forEach((file, index) => {
      const texture = gl.createTexture(); if (!texture) throw new Error("Could not allocate globe texture");
      textures.push(texture); gl.activeTexture(gl.TEXTURE0+index); gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(index === 0 ? [15,32,48,255] : [0,0,0,255]));
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(program,["u_day","u_night","u_stars"][index]),index);
      const image = new Image(); images.push(image);
      image.onload = () => { if (destroyed || gl.isContextLost()) return; gl.activeTexture(gl.TEXTURE0+index); gl.bindTexture(gl.TEXTURE_2D,texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,0); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image); onTextureChange(); };
      image.onerror = () => { if (!destroyed) onAssetError(); };
      image.src = `/images/globe/${file}`;
    });
    const uniforms = Object.fromEntries(["u_size","u_center","u_radius","u_right","u_up","u_front"].map(name => [name,gl.getUniformLocation(program,name)]));
    return { render(camera,geometry) {
      if (destroyed || gl.isContextLost() || geometry.width <= 0 || geometry.height <= 0 || geometry.radius <= 0) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5), width = Math.round(geometry.width*ratio), height = Math.round(geometry.height*ratio);
      if (canvas.width !== width || canvas.height !== height) { canvas.width=width; canvas.height=height; }
      gl.viewport(0,0,width,height); gl.useProgram(program);
      gl.uniform2f(uniforms.u_size,width,height); gl.uniform2f(uniforms.u_center,geometry.centerX*ratio,geometry.centerY*ratio); gl.uniform1f(uniforms.u_radius,geometry.radius*ratio);
      const basis = cameraBasis(camera); gl.uniform3fv(uniforms.u_right,basis.right); gl.uniform3fv(uniforms.u_up,basis.up); gl.uniform3fv(uniforms.u_front,basis.front);
      gl.drawArrays(gl.TRIANGLES,0,6);
    }, destroy: dispose };
  } catch { dispose(); return null; }
}
