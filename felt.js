/* The sketchbook's mat: grass, mapped, under the cards.
   ---------------------------------------------------------------------------
   Classic script, same shape as sketchbook.js. The grid paper used to be two
   CSS gradients; this is the same surface, drawn with the PBR maps in
   assets/sketchbook/felt/ so the nap catches the light the way a playing mat
   does.

   Maps are Grass 003 from ambientCG (CC0): albedo, OpenGL normal, roughness,
   ambient occlusion, displacement. Lighting is a fill from above plus a key
   that follows the pointer — a wash, not a spotlight, so the nap moves without
   bleaching a disc out of the cloth. A phone has no mouse, so there the key stands
   still overhead-left (the same side the chips' shadows already fall from)
   and the tracking is not wired up at all. Safari on iPhone has been known
   to report hover:hover and to synthesise a mouse pointerType after a tap,
   which would leave the pool sitting on the cloth; the UA is what actually
   decides a phone. A desktop that has asked for less motion still gets the
   lamp — that request is not a phone.

   WebGL 1, no three, no bundler. If the context never arrives the CSS
   fallback on #surface (the albedo, tiled) is what you see. */
(function () {
    'use strict';

    var surface = document.getElementById('surface');
    var felt = document.getElementById('felt');
    var canvas = document.getElementById('mat');
    if (!surface || !felt || !canvas) return;

    // The home Playground card is a cover on a Three.js ring. A second
    // WebGL context here loses to the carousel, the maps never stay lit,
    // and a 1920px mat was the letterbox. CSS albedo on #surface is the
    // cloth; the full playground page still gets the lit nap.
    if (!document.getElementById('table')) {
        canvas.style.display = 'none';
        return;
    }

    var gl = canvas.getContext('webgl', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'low-power',
        preserveDrawingBuffer: false,
    });
    if (!gl) return;

    canvas.addEventListener('webglcontextlost', function () {
        canvas.classList.remove('is-lit');
    });

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
        'uniform sampler2D uMark;',
        'uniform vec2 uMarkOrig;',
        'uniform vec2 uMarkSize;',
        'varying vec2 vUv;',
        'void main() {',
        '  vec2 uv = (vUv * uRes) / uTile;',
        '  float h = texture2D(uHeight, uv).r;',
        '  vec2 aspect = vec2(1.0, uRes.y / max(uRes.x, 1.0));',
        '  vec2 tracked = (uLight - vUv) * aspect;',
        '  vec2 view = mix(tracked, vec2(0.0), uEven);',
        '  uv += view * (h - 0.5) * 0.06;',
        '  vec3 albedo = pow(texture2D(uAlbedo, uv).rgb, vec3(2.2));',
        '  albedo = mix(albedo, vec3(0.07, 0.28, 0.12), 0.16);',
        '  vec2 mu = (vUv - uMarkOrig) / max(uMarkSize, vec2(1.0e-5));',
        '  float inside = step(0.0, mu.x) * step(mu.x, 1.0) * step(0.0, mu.y) * step(mu.y, 1.0);',
        '  float ink = texture2D(uMark, clamp(mu, 0.0, 1.0)).a * inside;',
        '  albedo = mix(albedo, albedo * 0.30 + vec3(0.78, 0.80, 0.70), ink);',
        '  vec3 n = normalize(texture2D(uNormal, uv).rgb * 2.0 - 1.0);',
        '  float rough = texture2D(uRough, uv).r;',
        '  rough = mix(rough, max(rough, 0.72), ink);',
        '  float ao = texture2D(uAO, uv).r;',
        '  vec3 V = vec3(0.0, 0.0, 1.0);',
        '  vec3 L = mix(normalize(vec3(tracked, 0.70)),',
        '               normalize(vec3(-0.22, 0.32, 0.92)), uEven);',
        '  vec3 H = normalize(L + V);',
        '  float ndl = max(dot(n, L), 0.0);',
        '  float spec = pow(max(dot(n, H), 0.0), mix(8.0, 48.0, 1.0 - rough));',
        '  spec *= (1.0 - rough) * 0.32;',
        '  float pool = mix(exp(-dot(tracked, tracked) * 1.45), 0.0, uEven);',
        '  vec3 fill = vec3(0.20, 0.26, 0.16);',
        '  vec3 col = albedo * (fill * ao + ndl * (0.68 + 0.20 * pool))',
        '           + spec * vec3(0.88, 1.0, 0.58) * (0.40 + 0.28 * pool);',
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
        mark: gl.getUniformLocation(prog, 'uMark'),
        markOrig: gl.getUniformLocation(prog, 'uMarkOrig'),
        markSize: gl.getUniformLocation(prog, 'uMarkSize'),
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

    var units = { albedo: 0, normal: 1, rough: 2, ao: 3, height: 4, mark: 5 };
    makeTex(units.albedo, false);
    makeTex(units.normal, true);
    makeTex(units.rough, true);
    makeTex(units.ao, true);
    makeTex(units.height, true);

    var markTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + units.mark);
    gl.bindTexture(gl.TEXTURE_2D, markTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 0]));

    gl.uniform1i(loc.albedo, units.albedo);
    gl.uniform1i(loc.normal, units.normal);
    gl.uniform1i(loc.rough, units.rough);
    gl.uniform1i(loc.ao, units.ao);
    gl.uniform1i(loc.height, units.height);
    gl.uniform1i(loc.mark, units.mark);
    gl.uniform1f(loc.tile, TILE);
    gl.uniform2f(loc.markOrig, 0, 0);
    gl.uniform2f(loc.markSize, 0, 0);

    var markCanvas = document.createElement('canvas');
    var markCtx = markCanvas.getContext('2d');
    var MARK_PAD = 32;

    var light = [0.5, 0.72];
    var coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)');
    var noHover = window.matchMedia && window.matchMedia('(hover: none)');
    // A phone, and only a phone — except the home Playground card, which
    // is a cover sitting on a Three.js ring. Tracking there redraws the
    // nap on every pointermove and fights the carousel for the frame.
    // Media queries are not enough for a phone: iOS will report a mouse
    // after a tap, which is how the pool was surviving there.
    var onHomeCard = !document.getElementById('table');
    function lampEven() {
        if (onHomeCard) return true;
        var ua = navigator.userAgent || '';
        if (navigator.userAgentData && navigator.userAgentData.mobile) return true;
        if (/iPhone|iPod/i.test(ua)) return true;
        if (/Android/i.test(ua) && /Mobile/i.test(ua)) return true;
        if (coarsePointer && coarsePointer.matches) return true;
        if (noHover && noHover.matches) return true;
        return false;
    }
    var even = lampEven();
    document.documentElement.classList.toggle('no-mat-lamp', even);
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
    // Same green as --felt, so a newly allocated buffer is cloth and not a
    // black frame while the first draw is still queued.
    gl.clearColor(0.165, 0.271, 0.157, 1);

    function resize() {
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        cssW = Math.max(1, surface.clientWidth);
        cssH = Math.max(1, surface.clientHeight);
        var w = Math.round(cssW * dpr);
        var h = Math.round(cssH * dpr);
        if (canvas.width === w && canvas.height === h) return false;
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
        gl.uniform2f(loc.res, cssW, cssH);
        gl.clear(gl.COLOR_BUFFER_BIT);
        dirty = true;
        return true;
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
        if (even || lampEven() || !cssW || !cssH) return;
        if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
        var r = canvas.getBoundingClientRect();
        if (!r.width || !r.height) return;
        light[0] = (e.clientX - r.left) / r.width;
        light[1] = 1 - (e.clientY - r.top) / r.height;
        dirty = true;
        requestDraw();
    }

    function listenLamp(on) {
        var opts = { capture: true };
        var addOpts = { passive: true, capture: true };
        if (on) {
            felt.addEventListener('pointermove', setLightFromEvent, addOpts);
            window.addEventListener('pointermove', setLightFromEvent, addOpts);
        } else {
            felt.removeEventListener('pointermove', setLightFromEvent, opts);
            window.removeEventListener('pointermove', setLightFromEvent, opts);
        }
    }

    function setEven(on) {
        even = on;
        document.documentElement.classList.toggle('no-mat-lamp', even);
        gl.uniform1f(loc.even, even ? 1 : 0);
        listenLamp(!even);
        dirty = true;
        requestDraw();
    }

    listenLamp(!even);
    function onLampMedia() { setEven(lampEven()); }
    function watchMedia(mq) {
        if (!mq) return;
        if (mq.addEventListener) mq.addEventListener('change', onLampMedia);
        else if (mq.addListener) mq.addListener(onLampMedia);
    }
    watchMedia(coarsePointer);
    watchMedia(noHover);

    function stamp() {
        // The name is lifted into the grass albedo, then lit with the rest
        // of the nap — a print in the cloth, not a caption sitting on it.
        var heading = document.getElementById('table-heading');
        var title = heading && heading.querySelector('.mat-title');
        var tag = heading && heading.querySelector('.mat-tag');
        if (!title || !tag || !markCtx || !cssW || !cssH) return;

        var titleCs = window.getComputedStyle(title);
        var tagCs = window.getComputedStyle(tag);
        var titleSize = parseFloat(titleCs.fontSize) || 72;
        var tagSize = parseFloat(tagCs.fontSize) || 24;
        var titleH = titleSize * 1.05;
        var tagH = tagSize * (parseFloat(tagCs.lineHeight) ? 1 : 1.2);
        if (tagCs.lineHeight && tagCs.lineHeight !== 'normal') {
            var lh = parseFloat(tagCs.lineHeight);
            if (lh) tagH = lh;
        }
        var gap = parseFloat(tagCs.marginTop);
        if (!(gap > 0)) gap = 0.18 * tagSize;

        markCtx.font = titleCs.font;
        if (typeof markCtx.letterSpacing === 'string') {
            markCtx.letterSpacing = titleCs.letterSpacing;
        }
        var titleW = markCtx.measureText(title.textContent || 'Playground').width;
        markCtx.font = tagCs.font;
        if (typeof markCtx.letterSpacing === 'string') {
            markCtx.letterSpacing = tagCs.letterSpacing;
        }
        var tagW = markCtx.measureText(tag.textContent || '').width;

        var blockW = Math.max(titleW, tagW);
        var blockH = titleH + gap + tagH;
        var w = Math.max(2, Math.ceil(blockW + MARK_PAD * 2));
        var h = Math.max(2, Math.ceil(blockH + MARK_PAD * 2));
        markCanvas.width = w;
        markCanvas.height = h;
        markCtx.setTransform(1, 0, 0, 1, 0, 0);
        markCtx.clearRect(0, 0, w, h);
        markCtx.fillStyle = '#ffffff';
        markCtx.textAlign = 'center';
        markCtx.textBaseline = 'middle';

        var cx = w / 2;
        markCtx.font = titleCs.font;
        if (typeof markCtx.letterSpacing === 'string') {
            markCtx.letterSpacing = titleCs.letterSpacing;
        }
        markCtx.fillText(title.textContent || 'Playground', cx, MARK_PAD + titleH / 2);
        markCtx.font = tagCs.font;
        if (typeof markCtx.letterSpacing === 'string') {
            markCtx.letterSpacing = tagCs.letterSpacing;
        }
        markCtx.fillText(tag.textContent || '', cx, MARK_PAD + titleH + gap + tagH / 2);

        var left = (cssW - w) / 2;
        var top = (cssH - h) / 2;
        gl.uniform2f(loc.markOrig, left / cssW, 1 - (top + h) / cssH);
        gl.uniform2f(loc.markSize, w / cssW, h / cssH);

        gl.activeTexture(gl.TEXTURE0 + units.mark);
        gl.bindTexture(gl.TEXTURE_2D, markTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, markCanvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        document.documentElement.classList.add('mat-ink');
        dirty = true;
        requestDraw();
    }

    function resizeAndPaint() {
        var grew = resize();
        // Paint this turn. A rAF later is a black (or empty) bottom on the
        // frame the cloth grew.
        if (grew) stamp();
        if (dirty) draw();
        else requestDraw();
    }

    if (typeof ResizeObserver === 'function') {
        new ResizeObserver(resizeAndPaint).observe(surface);
    } else {
        window.addEventListener('resize', resizeAndPaint);
    }

    resizeAndPaint();

    // The visible opening of the mat, copied into a 2-d context. Coordinates
    // are in the surface's CSS pixels — the same space chips and cards live
    // in — so the caller can crop to #felt without knowing the drawing
    // buffer's own size. Returns false if there is nothing to copy yet.
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { stamp(); }).catch(function () {});
    }

    window.Felt = {
        stamp: stamp,
        blit: function (dest, sx, sy, sw, sh, dx, dy, dw, dh) {
            if (!dest || !canvas.width || !cssW || !cssH) return false;
            if (!(sw > 0 && sh > 0 && dw > 0 && dh > 0)) return false;
            dest.drawImage(
                canvas,
                sx * (canvas.width / cssW),
                sy * (canvas.height / cssH),
                sw * (canvas.width / cssW),
                sh * (canvas.height / cssH),
                dx, dy, dw, dh
            );
            return true;
        },
    };
})();
