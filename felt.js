/* The sketchbook's mat: grass, mapped, under the cards.
   ---------------------------------------------------------------------------
   Classic script, same shape as sketchbook.js. The grid paper used to be two
   CSS gradients; this is the same surface, drawn with the PBR maps in
   assets/sketchbook/felt/ so the nap catches the light the way a playing mat
   does.

   Maps are Grass 003 from ambientCG (CC0): albedo, OpenGL normal, roughness,
   ambient occlusion, displacement. Lighting is a fill from above plus a key
   that follows the pointer — on a mouse. A finger is not a lamp, so on a
   coarse pointer the key stands still overhead-left (the same side the chips'
   shadows already fall from) and the tracking is not wired up at all.

   WebGL 1, no three, no bundler. If the context never arrives the CSS
   fallback on #surface (the albedo, tiled) is what you see. */
(function () {
    'use strict';

    var surface = document.getElementById('surface');
    var felt = document.getElementById('felt');
    var canvas = document.getElementById('mat');
    if (!surface || !felt || !canvas) return;

    var gl = canvas.getContext('webgl', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'low-power',
    });
    if (!gl) return;

    var MAP = 'assets/sketchbook/felt/';
    // One tile is this many CSS pixels on a side. Grass 003 is 1.4m in the
    // real world; at ~520px the blades read as a mat's nap rather than as a
    // lawn you are standing in, and still as grass rather than as noise.
    var TILE = 520;

    var VS = [
        'attribute vec2 aPos;',
        'varying vec2 vUv;',
        'void main() {',
        '  vUv = aPos * 0.5 + 0.5;',
        '  gl_Position = vec4(aPos, 0.0, 1.0);',
        '}',
    ].join('\n');

    var FS = [
        'precision mediump float;',
        'uniform sampler2D uAlbedo;',
        'uniform sampler2D uNormal;',
        'uniform sampler2D uRough;',
        'uniform sampler2D uAO;',
        'uniform sampler2D uHeight;',
        'uniform vec2 uRes;',
        'uniform vec2 uLight;',
        'uniform float uTile;',
        'uniform float uEven;',
        'varying vec2 vUv;',
        'void main() {',
        '  vec2 uv = (vUv * uRes) / uTile;',
        '  float h = texture2D(uHeight, uv).r;',
        '  vec2 aspect = vec2(1.0, uRes.y / max(uRes.x, 1.0));',
        '  vec2 tracked = (uLight - vUv) * aspect;',
        '  vec2 view = mix(tracked, vec2(0.0), uEven);',
        '  uv += view * (h - 0.5) * 0.10;',
        '  vec3 albedo = pow(texture2D(uAlbedo, uv).rgb, vec3(2.2));',
        '  albedo = mix(albedo, vec3(0.07, 0.28, 0.12), 0.16);',
        '  vec3 n = normalize(texture2D(uNormal, uv).rgb * 2.0 - 1.0);',
        '  float rough = texture2D(uRough, uv).r;',
        '  float ao = texture2D(uAO, uv).r;',
        '  vec3 V = vec3(0.0, 0.0, 1.0);',
        '  vec3 L = mix(normalize(vec3(tracked, 0.55)),',
        '               normalize(vec3(-0.22, 0.32, 0.92)), uEven);',
        '  vec3 H = normalize(L + V);',
        '  float ndl = max(dot(n, L), 0.0);',
        '  float spec = pow(max(dot(n, H), 0.0), mix(8.0, 56.0, 1.0 - rough));',
        '  spec *= (1.0 - rough) * 0.32;',
        '  vec3 fill = vec3(0.20, 0.26, 0.15);',
        '  vec3 col = albedo * (fill * ao + ndl * 0.88) + spec * vec3(0.82, 0.98, 0.52);',
        '  vec2 edge = abs(vUv - 0.5) * 2.0;',
        '  col *= 1.0 - pow(max(edge.x, edge.y), 7.0) * 0.32;',
        '  gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);',
        '}',
    ].join('\n');

    function compile(type, src) {
        var sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
            console.error('[felt]', gl.getShaderInfoLog(sh));
            return null;
        }
        return sh;
    }

    var vs = compile(gl.VERTEX_SHADER, VS);
    var fs = compile(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return;

    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error('[felt]', gl.getProgramInfoLog(prog));
        return;
    }
    gl.useProgram(prog);

    var quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1,  1, -1,  -1, 1,
        -1,  1,  1, -1,   1, 1,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    var loc = {
        albedo: gl.getUniformLocation(prog, 'uAlbedo'),
        normal: gl.getUniformLocation(prog, 'uNormal'),
        rough: gl.getUniformLocation(prog, 'uRough'),
        ao: gl.getUniformLocation(prog, 'uAO'),
        height: gl.getUniformLocation(prog, 'uHeight'),
        res: gl.getUniformLocation(prog, 'uRes'),
        light: gl.getUniformLocation(prog, 'uLight'),
        tile: gl.getUniformLocation(prog, 'uTile'),
        even: gl.getUniformLocation(prog, 'uEven'),
    };

    function makeTex(unit, linear) {
        var t = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        // Placeholder so sampling before the image arrives is not a black flash
        // over the CSS fallback — a dark felt green, close to --felt.
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE,
            new Uint8Array(linear ? [128, 128, 255] : [42, 69, 40]));
        return t;
    }

    var units = { albedo: 0, normal: 1, rough: 2, ao: 3, height: 4 };
    makeTex(units.albedo, false);
    makeTex(units.normal, true);
    makeTex(units.rough, true);
    makeTex(units.ao, true);
    makeTex(units.height, true);

    gl.uniform1i(loc.albedo, units.albedo);
    gl.uniform1i(loc.normal, units.normal);
    gl.uniform1i(loc.rough, units.rough);
    gl.uniform1i(loc.ao, units.ao);
    gl.uniform1i(loc.height, units.height);
    gl.uniform1f(loc.tile, TILE);

    var light = [0.5, 0.72];
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    // Same test the custom cursor uses. A phone has no mouse to follow; the
    // key then sits still rather than chasing a finger across the cloth.
    var finePointer = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)');
    function lampEven() {
        return (reduceMotion && reduceMotion.matches)
            || !(finePointer && finePointer.matches)
            || !document.body.classList.contains('has-dot');
    }
    var even = lampEven();
    gl.uniform1f(loc.even, even ? 1 : 0);
    var dirty = true;

    var loaded = 0;

    function load(src, unit) {
        var img = new Image();
        img.decoding = 'async';
        img.onload = function () {
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
            gl.generateMipmap(gl.TEXTURE_2D);
            var aniso = gl.getExtension('EXT_texture_filter_anisotropic')
                || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
            if (aniso) {
                var max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 4;
                gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
            }
            loaded += 1;
            dirty = true;
            requestDraw();
        };
        img.onerror = function () { console.error('[felt] missing', src); };
        img.src = src;
    }

    load(MAP + 'albedo.jpg', units.albedo);
    load(MAP + 'normal.jpg', units.normal);
    load(MAP + 'roughness.jpg', units.rough);
    load(MAP + 'ao.jpg', units.ao);
    load(MAP + 'height.jpg', units.height);

    var cssW = 0, cssH = 0;

    function resize() {
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        cssW = Math.max(1, surface.clientWidth);
        cssH = Math.max(1, surface.clientHeight);
        var w = Math.round(cssW * dpr);
        var h = Math.round(cssH * dpr);
        if (canvas.width === w && canvas.height === h) return;
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
        gl.uniform2f(loc.res, cssW, cssH);
        dirty = true;
    }

    function draw() {
        pending = false;
        if (!dirty) return;
        dirty = false;
        gl.uniform2f(loc.light, light[0], light[1]);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        if (loaded >= 5) canvas.classList.add('is-lit');
    }

    var pending = false;
    function requestDraw() {
        if (pending) return;
        pending = true;
        requestAnimationFrame(draw);
    }

    function setLightFromEvent(e) {
        if (even || !cssW || !cssH) return;
        if (e.pointerType === 'touch') return;
        var r = canvas.getBoundingClientRect();
        if (!r.width || !r.height) return;
        light[0] = (e.clientX - r.left) / r.width;
        light[1] = 1 - (e.clientY - r.top) / r.height;
        dirty = true;
        requestDraw();
    }

    function setEven(on) {
        even = on;
        gl.uniform1f(loc.even, even ? 1 : 0);
        if (even) felt.removeEventListener('pointermove', setLightFromEvent, { capture: true });
        else felt.addEventListener('pointermove', setLightFromEvent, { passive: true, capture: true });
        dirty = true;
        requestDraw();
    }

    if (!even) felt.addEventListener('pointermove', setLightFromEvent, { passive: true, capture: true });
    // Leave the key where it was when the pointer leaves, rather than snapping
    // back: a light that jumped home every time you reached for the hand would
    // be noisier than a lamp that simply stays put.
    function onLampMedia() { setEven(lampEven()); }
    if (finePointer) {
        if (finePointer.addEventListener) finePointer.addEventListener('change', onLampMedia);
        else if (finePointer.addListener) finePointer.addListener(onLampMedia);
    }
    if (reduceMotion) {
        if (reduceMotion.addEventListener) reduceMotion.addEventListener('change', onLampMedia);
        else if (reduceMotion.addListener) reduceMotion.addListener(onLampMedia);
    }

    if (typeof ResizeObserver === 'function') {
        new ResizeObserver(function () { resize(); requestDraw(); }).observe(surface);
    } else {
        window.addEventListener('resize', function () { resize(); requestDraw(); });
    }

    resize();
    requestDraw();
})();
