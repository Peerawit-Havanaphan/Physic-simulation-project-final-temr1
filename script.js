(function () {
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const tabFlat = document.getElementById('tabFlat');
  const tabIncline = document.getElementById('tabIncline');
  const angleRow = document.getElementById('angleRow');
  const posRow = document.getElementById('posRow');
  const posLow = document.getElementById('posLow');
  const posHigh = document.getElementById('posHigh');
  const lblFRow = document.getElementById('lblFRow');

  const massEl = document.getElementById('mass'), fEl = document.getElementById('appliedF'),
        muSEl = document.getElementById('muS'), muKEl = document.getElementById('muK'), angleEl = document.getElementById('angle');
  const lblMass = document.getElementById('lblMass'), lblF = document.getElementById('lblF'),
        lblMuS = document.getElementById('lblMuS'), lblMuK = document.getElementById('lblMuK'), lblAngle = document.getElementById('lblAngle');

  const statT = document.getElementById('statT'), statV = document.getElementById('statV'),
        statS = document.getElementById('statS'), statA = document.getElementById('statA'),
        statFnet = document.getElementById('statFnet');
  const statusBadge = document.getElementById('statusBadge');
  const formulaBox = document.getElementById('formulaBox');

  const fbdPanel = document.getElementById('fbdPanel');
  const fbdCv = document.getElementById('fbdCv');
  const fbdCtx = fbdCv.getContext('2d');
  const fbdFormula = document.getElementById('fbdFormula');
  const btnFBD = document.getElementById('btnFBD');
  let fbdVisible = false;

  let mode = 'flat';        // 'flat' | 'incline'
  let position = 'low';     // 'low' | 'high'  (start position on the incline)
  const rampMeters = 6;     // length of incline track represented, in meters
  const trackLenFlat = 9;   // visual loop length for flat mode

  let g = 10;
  let running = false, rafId = null, lastTime = null;
  let t = 0, s = 0, v = 0, a = 0, stopped = false, stopReason = '';

  function syncLabels() {
    lblMass.textContent = parseFloat(massEl.value).toFixed(1);
    lblF.textContent = parseFloat(fEl.value).toFixed(1);
    lblMuS.textContent = parseFloat(muSEl.value).toFixed(2);
    lblMuK.textContent = parseFloat(muKEl.value).toFixed(2);
    lblAngle.textContent = angleEl.value;
    if (mode === 'flat') {
      lblFRow.firstChild.textContent = 'แรงดึง F (N): ';
    } else if (position === 'low') {
      lblFRow.firstChild.textContent = 'แรงดึง F ทิศขึ้นพื้นเอียง (N): ';
    } else {
      lblFRow.firstChild.textContent = 'แรงดึง F ทิศลงพื้นเอียง (N): ';
    }
  }

  // Signed applied force along the slope: +up-slope at the "low" start position,
  // -down-slope at the "high" start position (matches the up-positive convention below).
  function signedIncline(F) { return position === 'low' ? F : -F; }

  // Sign convention: on the incline, POSITIVE = up-slope, matching the rendering direction.
  // The object always starts at rest; motion is driven by the applied force F, resisted
  // by friction and, on the incline, by gravity's component.
  //
  // Two separate friction coefficients are modeled, as in real physics:
  //  - μs (static): while at rest, this is the MAX friction can resist before the object
  //    breaks free. If the driving force doesn't exceed μs·N, static friction holds it
  //    in place exactly (a = 0), matching the driving force so nothing moves.
  //  - μk (kinetic): once the object is actually sliding, kinetic friction — normally
  //    somewhat lower than static — is what opposes the motion instead.
  function computeAccel(currentV) {
    const muS = parseFloat(muSEl.value);
    const muK = parseFloat(muKEl.value);
    const m = parseFloat(massEl.value);
    const F = parseFloat(fEl.value);
    if (mode === 'flat') {
      const aF = F / m;                 // F always pushes in the positive direction
      const maxStatic = muS * g;        // static friction threshold (magnitude)
      const maxKinetic = muK * g;       // kinetic friction while sliding (magnitude)
      if (currentV === 0) {
        if (Math.abs(aF) <= maxStatic) return 0; // static friction holds it in place
        return aF - Math.sign(aF) * maxKinetic;  // broke free: kinetic friction now applies
      }
      const dir = currentV > 0 ? 1 : -1;
      return aF - dir * maxKinetic;
    } else {
      const theta = parseFloat(angleEl.value) * Math.PI / 180;
      const aF = signedIncline(F) / m;
      const aGravity = -g * Math.sin(theta);              // gravity always pulls down-slope
      const maxStatic = muS * g * Math.cos(theta);         // static friction threshold (magnitude)
      const maxKinetic = muK * g * Math.cos(theta);        // kinetic friction while sliding (magnitude)
      const net = aF + aGravity;
      if (currentV === 0) {
        if (Math.abs(net) <= maxStatic) return 0; // static friction holds it in place
        return net - Math.sign(net) * maxKinetic; // broke free: kinetic friction now applies
      }
      const dir = currentV > 0 ? 1 : -1;
      return net - dir * maxKinetic;
    }
  }

  function reset() {
    running = false; lastTime = null;
    cancelAnimationFrame(rafId);
    t = 0; s = 0; v = 0; stopped = false; stopReason = '';
    a = computeAccel(v);
    updateStats();
    draw();
  }

  function currentFrac() {
    if (mode !== 'incline') return 0;
    const frac0 = position === 'low' ? 0 : 1;
    let f = frac0 + s / rampMeters;
    return Math.min(1, Math.max(0, f));
  }

  function updateStats() {
    statT.textContent = t.toFixed(2);
    statV.textContent = v.toFixed(2);
    statS.textContent = s.toFixed(2);
    statA.textContent = a.toFixed(2);
    // Newton's 2nd law the other way round: once a is known, F_net = m·a.
    // This is the same net force that produced the motion above — showing it
    // here makes the link between "แรงลัพธ์" and the resulting a/v/s explicit.
    const mNow = parseFloat(massEl.value);
    statFnet.textContent = (mNow * a).toFixed(2);

    const moving = Math.abs(v) > 0.01;
    if (stopped && stopReason) {
      statusBadge.textContent = stopReason;
      statusBadge.className = 'badge stopped';
    } else if (!moving && a === 0) {
      statusBadge.textContent = 'นิ่ง (แรงไม่พอเอาชนะแรงเสียดทาน)';
      statusBadge.className = 'badge stopped';
    } else {
      statusBadge.textContent = moving ? 'กำลังเคลื่อนที่' : 'หยุดนิ่ง';
      statusBadge.className = 'badge ' + (moving ? 'moving' : 'stopped');
    }

    const m = parseFloat(massEl.value), muS = parseFloat(muSEl.value), muK = parseFloat(muKEl.value), F = parseFloat(fEl.value);
    if (mode === 'flat') {
      const fsMax = muS * m * g;
      const fk = muK * m * g;
      if (F <= fsMax) {
        formulaBox.innerHTML =
          `<b>แรงลัพธ์ (F_net) = ΣF = F − f_s</b><br>` +
          `F = ${F.toFixed(1)} N, f_s ต้านไว้พอดี = ${F.toFixed(1)} N (สูงสุด f_s,max = μs·mg = ${fsMax.toFixed(2)} N)<br>` +
          `F_net = ${F.toFixed(1)} − ${F.toFixed(1)} = 0 N → a = F_net / m = 0 m/s² (วัตถุไม่ขยับ)`;
      } else {
        const fnet = F - fk;
        formulaBox.innerHTML =
          `<b>แรงลัพธ์ (F_net) = ΣF = F − f_k</b><br>` +
          `F = ${F.toFixed(1)} N (F เกิน f_s,max = ${fsMax.toFixed(2)} N จึงหลุดและใช้ f_k = μk·mg = ${fk.toFixed(2)} N ต้านแทน)<br>` +
          `F_net = ${F.toFixed(1)} − ${fk.toFixed(2)} = ${fnet.toFixed(2)} N<br>` +
          `<b>a = F_net / m</b> = ${fnet.toFixed(2)} / ${m.toFixed(1)} ≈ ${(fnet / m).toFixed(2)} m/s² → v และ s เพิ่มขึ้นตาม a นี้ตลอดเวลา`;
      }
    } else {
      const th = parseFloat(angleEl.value);
      const rad = th * Math.PI / 180;
      const comp = g * Math.sin(rad);              // gravity component (m/s²) down-slope
      const frS = muS * g * Math.cos(rad);          // max static friction (m/s²)
      const frK = muK * g * Math.cos(rad);          // kinetic friction (m/s²)
      const Fs = signedIncline(F);
      const netBeforeFriction = Fs / m - comp;       // up-positive, before friction
      const mgSinTheta = m * comp;
      if (Math.abs(netBeforeFriction) <= frS) {
        formulaBox.innerHTML =
          `เริ่มต้นที่ตำแหน่ง${position === 'low' ? 'ต่ำ (ฐาน)' : 'สูง (ยอด)'} (บวก = ขึ้น, ลบ = ลง)<br>` +
          `<b>แรงลัพธ์ (F_net) = ΣF = F ∓ mg sinθ − f_s</b><br>` +
          `F = ${F.toFixed(1)} N, mg sinθ = ${mgSinTheta.toFixed(2)} N, f_s ต้านไว้พอดี (สูงสุด f_s,max = μs·mg cosθ ≈ ${(m * frS).toFixed(2)} N)<br>` +
          `F_net = 0 N → a = F_net / m = 0 m/s² (วัตถุไม่ขยับ)`;
      } else {
        const netAfterFriction = netBeforeFriction - Math.sign(netBeforeFriction) * frK;
        const fnetForce = m * netAfterFriction;
        formulaBox.innerHTML =
          `เริ่มต้นที่ตำแหน่ง${position === 'low' ? 'ต่ำ (ฐาน)' : 'สูง (ยอด)'} (บวก = ขึ้น, ลบ = ลง)<br>` +
          `<b>แรงลัพธ์ (F_net) = ΣF = F ∓ mg sinθ − f_k</b><br>` +
          `F = ${F.toFixed(1)} N, mg sinθ = ${mgSinTheta.toFixed(2)} N, f_k = μk·mg cosθ ≈ ${(m * frK).toFixed(2)} N (เกิน f_s,max แล้วหลุดจากจุดนิ่ง)<br>` +
          `F_net ≈ ${fnetForce.toFixed(2)} N<br>` +
          `<b>a = F_net / m</b> ≈ ${netAfterFriction.toFixed(2)} m/s² (บวก = ขึ้น, ลบ = ลง) → v และ s เปลี่ยนตาม a นี้ตลอดเวลา`;
      }
    }
    if (fbdVisible) drawFBD();
  }

  function step(ts) {
    if (!running) return;
    if (lastTime === null) {
      // First frame after Start: only establish the time reference.
      // Computing physics here would give dt = 0, and since the start
      // position sits exactly at frac 0 (low) or frac 1 (high), a dt = 0
      // step lands exactly on the boundary and used to trigger a false
      // "reached the edge" stop before any real motion happened.
      lastTime = ts;
      rafId = requestAnimationFrame(step);
      return;
    }
    let dt = (ts - lastTime) / 1000;
    dt = Math.min(dt, 0.033);
    lastTime = ts;

    if (!stopped) {
      a = computeAccel(v);
      let newV = v + a * dt;

      if (mode === 'flat') {
        if ((v > 0 && newV < 0) || (v < 0 && newV > 0)) newV = 0;
        s += v * dt + 0.5 * a * dt * dt;
        v = newV;
        if (Math.abs(v) < 0.01 && a === 0) { stopped = true; stopReason = 'หยุดนิ่ง'; }
      } else {
        let newS = s + v * dt + 0.5 * a * dt * dt;
        const frac0 = position === 'low' ? 0 : 1;
        let candidateFrac = frac0 + newS / rampMeters;
        if (candidateFrac <= 0) {
          newS = -frac0 * rampMeters;
          newV = 0; stopped = true; stopReason = 'ถึงฐานด้านล่างแล้ว';
        } else if (candidateFrac >= 1) {
          newS = (1 - frac0) * rampMeters;
          newV = 0; stopped = true; stopReason = 'ถึงยอดด้านบนแล้ว';
        } else if (Math.abs(newV) < 0.01 && a === 0) {
          stopped = true; stopReason = 'หยุดนิ่ง (แรงเสียดทานสมดุล)';
        }
        s = newS;
        v = newV;
      }
      t += dt;
    }
    updateStats();
    draw();
    rafId = requestAnimationFrame(step);
  }

  function draw() {
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    const groundColor = getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || '#334155';
    const boxColor = getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#fb923c';
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#e2e8f0';
    const forceColor = '#f97316';

    if (mode === 'flat') {
      const groundY = h - 60;
      ctx.strokeStyle = groundColor; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(20, groundY); ctx.lineTo(w - 20, groundY); ctx.stroke();
      const usableW = w - 100;
      let x = 60 + (((s % trackLenFlat) + trackLenFlat) % trackLenFlat / trackLenFlat) * usableW;
      ctx.fillStyle = boxColor;
      ctx.fillRect(x - 17, groundY - 34, 34, 34);
      drawVelocityArrow(x, groundY - 48, v, textColor);
      drawNetForceArrow(x, groundY - 66, parseFloat(massEl.value) * a, forceColor);
    } else {
      const theta = parseFloat(angleEl.value) * Math.PI / 180;
      const baseX = 40, baseY = h - 40;
      const rampLen = Math.min(w - 80, 560);
      const topX = baseX + rampLen * Math.cos(theta);
      const topY = baseY - rampLen * Math.sin(theta);
      ctx.strokeStyle = groundColor; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(baseX, baseY); ctx.lineTo(topX, topY); ctx.stroke();
      ctx.strokeStyle = 'rgba(148,163,184,.3)';
      ctx.beginPath(); ctx.moveTo(baseX, baseY); ctx.lineTo(baseX + rampLen, baseY); ctx.stroke();

      const frac = currentFrac();
      const bx = baseX + frac * rampLen * Math.cos(theta);
      const by = baseY - frac * rampLen * Math.sin(theta);
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(-theta);
      ctx.fillStyle = boxColor;
      ctx.fillRect(-17, -38, 34, 34);
      ctx.restore();

      // Net force arrow, drawn parallel to the slope (positive a = up-slope),
      // offset above the block so it never overlaps it.
      const alongX = Math.cos(theta), alongY = -Math.sin(theta);
      const normalX = -Math.sin(theta), normalY = -Math.cos(theta);
      const fx = bx + normalX * 50, fy = by + normalY * 50;
      drawNetForceArrow(fx, fy, parseFloat(massEl.value) * a, forceColor, alongX, alongY);

      ctx.fillStyle = textColor; ctx.font = '13px sans-serif';
      ctx.fillText(angleEl.value + '°', baseX + 26, baseY - 12);
      ctx.fillStyle = textColor === '#0f172a' ? '#64748b' : '#94a3b8';
      ctx.fillText('ฐาน', baseX - 4, baseY + 20);
      ctx.fillText('ยอด', topX - 12, topY - 10);
    }
  }

  function drawVelocityArrow(x, y, vel, textColor) {
    if (Math.abs(vel) < 0.05) return;
    const dir = vel > 0 ? 1 : -1;
    const len = Math.min(Math.abs(vel) * 6, 60);
    ctx.strokeStyle = textColor; ctx.fillStyle = textColor; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dir * len, y); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + dir * len, y);
    ctx.lineTo(x + dir * len - dir * 7, y - 5);
    ctx.lineTo(x + dir * len - dir * 7, y + 5);
    ctx.closePath(); ctx.fill();
  }

  // Draws the net-force arrow that visually ties the motion to F_net = m·a.
  // dirX/dirY is the unit "positive" direction (horizontal for flat mode,
  // parallel to the slope for incline mode); the arrow flips along that axis
  // when forceVal is negative, exactly like the velocity arrow does.
  function drawNetForceArrow(x, y, forceVal, color, dirX = 1, dirY = 0) {
    if (Math.abs(forceVal) < 0.05) return;
    const sign = forceVal > 0 ? 1 : -1;
    const ux = dirX * sign, uy = dirY * sign;
    const len = Math.min(Math.abs(forceVal) * 3, 70);
    const x2 = x + ux * len, y2 = y + uy * len;
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
    const ang = Math.atan2(uy, ux);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 8 * Math.cos(ang - 0.4), y2 - 8 * Math.sin(ang - 0.4));
    ctx.lineTo(x2 - 8 * Math.cos(ang + 0.4), y2 - 8 * Math.sin(ang + 0.4));
    ctx.closePath(); ctx.fill();
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('F_net', x2 + ux * 14, y2 + uy * 14);
    ctx.restore();
  }

  // ---------- Free Body Diagram ----------
  // Design goals: arrows start from different anchor points (not all from one spot),
  // on-canvas labels are short symbols only (full numbers live in the HTML panel below),
  // and the incline's weight-decomposition gets its own separate inset so it never
  // competes for space with the real forces (N, W, f) on the block.
  function drawFBD() {
    const w = fbdCv.width, h = fbdCv.height;
    fbdCtx.clearRect(0, 0, w, h);
    const panelBg = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() || '#1e293b';
    const boxColor = getComputedStyle(document.documentElement).getPropertyValue('--accent2').trim() || '#fb923c';
    const lineColor = getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || '#334155';
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#e2e8f0';
    const Wcolor = '#f87171', Ncolor = '#38bdf8', fcolor = '#facc15', compColor = '#a78bfa', Fcolor = '#34d399';

    const m = parseFloat(massEl.value), muS = parseFloat(muSEl.value), muK = parseFloat(muKEl.value), g0 = g, Fval = parseFloat(fEl.value);
    const moving = Math.abs(v) > 0.01;
    const dirSign = v !== 0 ? (v > 0 ? 1 : -1) : (a !== 0 ? (a > 0 ? 1 : -1) : 1);

    fbdCtx.textBaseline = 'middle';

    // Arrow with a short label placed at a fixed offset along the arrow's own
    // direction (never proportional to length), so short arrows still get clear labels.
    function arrow(x1, y1, dx, dy, mag, color, label, dashed) {
      const len = Math.min(85, 22 + mag * 5.5);
      const x2 = x1 + dx * len, y2 = y1 + dy * len;
      fbdCtx.save();
      fbdCtx.strokeStyle = color; fbdCtx.fillStyle = color; fbdCtx.lineWidth = 2.5;
      if (dashed) fbdCtx.setLineDash([5, 4]);
      fbdCtx.beginPath(); fbdCtx.moveTo(x1, y1); fbdCtx.lineTo(x2, y2); fbdCtx.stroke();
      fbdCtx.setLineDash([]);
      const ang = Math.atan2(dy, dx);
      fbdCtx.beginPath();
      fbdCtx.moveTo(x2, y2);
      fbdCtx.lineTo(x2 - 9 * Math.cos(ang - 0.4), y2 - 9 * Math.sin(ang - 0.4));
      fbdCtx.lineTo(x2 - 9 * Math.cos(ang + 0.4), y2 - 9 * Math.sin(ang + 0.4));
      fbdCtx.closePath(); fbdCtx.fill();
      if (label) {
        const lx = x2 + 16 * Math.cos(ang), ly = y2 + 16 * Math.sin(ang);
        fbdCtx.font = 'bold 13px sans-serif';
        fbdCtx.textAlign = 'center';
        fbdCtx.lineWidth = 3;
        fbdCtx.strokeStyle = panelBg;
        fbdCtx.strokeText(label, lx, ly);
        fbdCtx.fillStyle = color;
        fbdCtx.fillText(label, lx, ly);
      }
      fbdCtx.restore();
      return { x2, y2 };
    }

    if (mode === 'flat') {
      const Wf = m * g0, Nf = Wf;
      const fsMax = muS * Nf, fk = muK * Nf;
      const ff = moving ? fk : Math.min(fsMax, Math.abs(Fval)); // static friction only matches the driving force, up to its max
      const cx = w / 2, cy = h / 2 + 6;
      fbdCtx.fillStyle = boxColor;
      fbdCtx.fillRect(cx - 24, cy - 24, 48, 48);
      fbdCtx.strokeStyle = lineColor; fbdCtx.lineWidth = 1.5; fbdCtx.strokeRect(cx - 24, cy - 24, 48, 48);
      fbdCtx.strokeStyle = lineColor; fbdCtx.lineWidth = 3;
      fbdCtx.beginPath(); fbdCtx.moveTo(40, cy + 24); fbdCtx.lineTo(w - 40, cy + 24); fbdCtx.stroke();

      // Anchor N/W at the box's top and bottom edges; F from the right edge (direction
      // of push); f below the box opposing motion — four different anchors, no overlap.
      arrow(cx, cy - 24, 0, -1, Nf, Ncolor, 'N');
      arrow(cx, cy + 24, 0, 1, Wf, Wcolor, 'W');
      arrow(cx + 24, cy, 1, 0, Fval, Fcolor, 'F');
      arrow(cx - dirSign * 30, cy + 44, -dirSign, 0, ff, fcolor, moving ? 'f_k' : 'f_s');

      fbdFormula.innerHTML =
        `<span style="color:${Ncolor}">■</span> N = ${Nf.toFixed(1)} N &nbsp; ` +
        `<span style="color:${Wcolor}">■</span> W = mg = ${Wf.toFixed(1)} N &nbsp; ` +
        `<span style="color:${Fcolor}">■</span> F = ${Fval.toFixed(1)} N<br>` +
        `<span style="color:${fcolor}">■</span> f_s,max = μs·N = ${fsMax.toFixed(1)} N &nbsp; ` +
        `f_k = μk·N = ${fk.toFixed(1)} N &nbsp; (ตอนนี้ใช้ ${moving ? 'f_k เพราะกำลังเคลื่อนที่' : 'f_s เพราะยังนิ่งอยู่'} ≈ ${ff.toFixed(1)} N)<br>` +
        `บนพื้นราบ N สมดุลกับ W ในแนวดิ่ง (N = mg) ก่อนขยับแรงเสียดทานสถิตต้านตาม F พอดี (สูงสุด f_s,max) พอหลุดแล้วจะใช้ f_k ต้านทิศการเคลื่อนที่แทน`;
    } else {
      const theta = parseFloat(angleEl.value) * Math.PI / 180;
      const Wf = m * g0;
      const Nf = Wf * Math.cos(theta);
      const fsMax = muS * Nf, fk = muK * Nf;
      const ff = moving ? fk : Math.min(fsMax, Math.abs(signedIncline(Fval) - Wf * Math.sin(theta)));
      const compAlong = Wf * Math.sin(theta);
      const compPerp = Wf * Math.cos(theta);

      // ---- Left: the block with real forces N, W, f ----
      const cx = 165, cy = 180;
      const rampLen = 230;
      const bx = cx - rampLen / 2 * Math.cos(theta), by = cy + rampLen / 2 * Math.sin(theta);
      const tx = cx + rampLen / 2 * Math.cos(theta), ty = cy - rampLen / 2 * Math.sin(theta);
      fbdCtx.strokeStyle = lineColor; fbdCtx.lineWidth = 3;
      fbdCtx.beginPath(); fbdCtx.moveTo(bx, by); fbdCtx.lineTo(tx, ty); fbdCtx.stroke();

      fbdCtx.save();
      fbdCtx.translate(cx, cy);
      fbdCtx.rotate(-theta);
      fbdCtx.fillStyle = boxColor;
      fbdCtx.fillRect(-20, -40, 40, 40);
      fbdCtx.strokeStyle = lineColor; fbdCtx.lineWidth = 1.5; fbdCtx.strokeRect(-20, -40, 40, 40);
      fbdCtx.restore();

      // Anchor points around the block, each force starting from a different spot:
      const upSlope = { x: Math.cos(theta), y: -Math.sin(theta) };
      const normalDir = { x: -Math.sin(theta), y: -Math.cos(theta) };
      const topPt = { x: cx - 40 * Math.sin(theta), y: cy - 40 * Math.cos(theta) };   // top face
      const centerPt = { x: cx - 20 * Math.sin(theta), y: cy - 20 * Math.cos(theta) }; // block center
      const contactPt = { x: cx, y: cy };                                              // contact point on slope

      arrow(topPt.x, topPt.y, normalDir.x, normalDir.y, Nf, Ncolor, 'N');
      arrow(centerPt.x, centerPt.y, 0, 1, Wf, Wcolor, 'W');
      const fDir = dirSign > 0 ? { x: -upSlope.x, y: -upSlope.y } : upSlope; // opposes motion
      arrow(contactPt.x, contactPt.y, fDir.x, fDir.y, ff, fcolor, moving ? 'f_k' : 'f_s');
      // F floats just above the block, parallel to the slope, offset along the
      // normal so it never overlaps the contact-line friction arrow below it.
      const fPushDir = position === 'low' ? upSlope : { x: -upSlope.x, y: -upSlope.y };
      const fAnchor = { x: centerPt.x + normalDir.x * 26, y: centerPt.y + normalDir.y * 26 };
      arrow(fAnchor.x, fAnchor.y, fPushDir.x, fPushDir.y, Fval, Fcolor, 'F');

      fbdCtx.fillStyle = textColor; fbdCtx.font = '12px sans-serif'; fbdCtx.textAlign = 'left';
      fbdCtx.fillText(angleEl.value + '°', bx + 14, by - 8);

      // ---- Right: separate inset showing W decomposed into components ----
      const icx = 490, icy = 90;
      fbdCtx.fillStyle = textColor; fbdCtx.font = 'bold 12px sans-serif'; fbdCtx.textAlign = 'left';
      fbdCtx.fillText('แยกแรง W เป็นแนวขนาน/ตั้งฉากกับพื้นเอียง', 380, 30);
      // light reference incline direction at the inset
      fbdCtx.strokeStyle = 'rgba(148,163,184,.35)'; fbdCtx.lineWidth = 2;
      fbdCtx.beginPath();
      fbdCtx.moveTo(icx - 46 * Math.cos(theta), icy + 46 * Math.sin(theta));
      fbdCtx.lineTo(icx + 46 * Math.cos(theta), icy - 46 * Math.sin(theta));
      fbdCtx.stroke();

      arrow(icx, icy, 0, 1, Wf, Wcolor, 'W');
      arrow(icx, icy, -upSlope.x, -upSlope.y, compAlong, compColor, 'mg sinθ', true);
      arrow(icx, icy, -normalDir.x, -normalDir.y, compPerp, '#2dd4bf', 'mg cosθ', true);

      fbdFormula.innerHTML =
        `<span style="color:${Ncolor}">■</span> N = mg cosθ = ${Nf.toFixed(1)} N &nbsp; ` +
        `<span style="color:${Wcolor}">■</span> W = mg = ${Wf.toFixed(1)} N &nbsp; ` +
        `<span style="color:${Fcolor}">■</span> F = ${Fval.toFixed(1)} N<br>` +
        `<span style="color:${fcolor}">■</span> f_s,max = μs·N = ${fsMax.toFixed(1)} N &nbsp; ` +
        `f_k = μk·N = ${fk.toFixed(1)} N &nbsp; (ตอนนี้ใช้ ${moving ? 'f_k เพราะกำลังเคลื่อนที่' : 'f_s เพราะยังนิ่งอยู่'} ≈ ${ff.toFixed(1)} N)<br>` +
        `<span style="color:${compColor}">■</span> mg sinθ = ${compAlong.toFixed(1)} N (ทำให้ไถลลง) &nbsp; ` +
        `<span style="color:#2dd4bf">■</span> mg cosθ = ${compPerp.toFixed(1)} N (สมดุลกับ N)<br>` +
        `เริ่มจากตำแหน่ง${position === 'low' ? 'ต่ำ (ฐาน)' : 'สูง (ยอด)'} — F ดันไปตามพื้นเอียง ก่อนขยับ f_s ต้านไว้จนถึง f_s,max พอหลุดแล้วใช้ f_k ต้านทิศการเคลื่อนที่แทน`;
    }
  }

  // ---------- UI wiring ----------
  function switchMode(newMode) {
    mode = newMode;
    tabFlat.classList.toggle('active', mode === 'flat');
    tabIncline.classList.toggle('active', mode === 'incline');
    angleRow.style.display = mode === 'incline' ? 'block' : 'none';
    posRow.style.display = mode === 'incline' ? 'flex' : 'none';
    syncLabels();
    reset();
  }

  function switchPosition(newPos) {
    position = newPos;
    posLow.classList.toggle('active', position === 'low');
    posHigh.classList.toggle('active', position === 'high');
    syncLabels();
    reset();
  }

  tabFlat.addEventListener('click', () => switchMode('flat'));
  tabIncline.addEventListener('click', () => switchMode('incline'));
  posLow.addEventListener('click', () => switchPosition('low'));
  posHigh.addEventListener('click', () => switchPosition('high'));

  [massEl, fEl, muSEl, muKEl, angleEl].forEach(el => {
    el.addEventListener('input', () => {
      // Physically, kinetic friction shouldn't exceed static friction. If the user
      // drags one past the other, nudge the other one along so μk ≤ μs always holds.
      if (el === muSEl && parseFloat(muSEl.value) < parseFloat(muKEl.value)) muKEl.value = muSEl.value;
      if (el === muKEl && parseFloat(muKEl.value) > parseFloat(muSEl.value)) muSEl.value = muKEl.value;
      syncLabels();
      if (!running) reset(); else if (fbdVisible) drawFBD();
    });
  });

  document.getElementById('btnStart').addEventListener('click', () => {
    if (running) return;
    running = true; lastTime = null;
    rafId = requestAnimationFrame(step);
  });
  document.getElementById('btnPause').addEventListener('click', () => {
    running = false; cancelAnimationFrame(rafId);
  });
  document.getElementById('btnReset').addEventListener('click', reset);

  btnFBD.addEventListener('click', () => {
    fbdVisible = !fbdVisible;
    fbdPanel.style.display = fbdVisible ? 'block' : 'none';
    btnFBD.textContent = fbdVisible ? '📐 ซ่อน Free Body Diagram' : '📐 แสดง Free Body Diagram';
    if (fbdVisible) drawFBD();
  });

  syncLabels();
  reset();
})();
