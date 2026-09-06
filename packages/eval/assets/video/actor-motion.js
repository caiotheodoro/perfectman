const FACE_POSES = {
  neutral: [6, 'M30 33L44 33', 'M56 33L70 33', 'M43 64Q50 64 57 64', 0],
  angry: [4.3, 'M29 28L44 36', 'M56 36L71 28', 'M40 67Q50 58 60 67', 1],
  worried: [7, 'M30 35L44 28', 'M56 28L70 35', 'M43 67Q50 60 57 67', 1],
  tired: [3.5, 'M30 33L44 34', 'M56 34L70 33', 'M43 66Q50 64 57 66', .7],
  smile: [5.5, 'M30 30L44 31', 'M56 31L70 30', 'M40 61Q50 76 60 61', 0],
  shock: [8, 'M30 26L44 25', 'M56 25L70 26', 'M43 64Q50 64 57 64', 1],
};
function expression(index, state, at) {
  const face = FACE_POSES[state] || FACE_POSES.neutral, target = '#actor-' + index;
  tl.to(target + ' .eye', { attr: { ry: face[0] }, duration: .17 }, at);
  tl.to(target + ' .bl', { attr: { d: face[1] }, opacity: face[4], duration: .17 }, at);
  tl.to(target + ' .br', { attr: { d: face[2] }, opacity: face[4], duration: .17 }, at);
  tl.to(target + ' .mouth', { attr: { d: face[3] }, opacity: state === 'shock' ? 0 : 1, duration: .17 }, at);
  tl.to(target + ' .gasp', { attr: { ry: 7 }, opacity: state === 'shock' ? 1 : 0, duration: .17 }, at);
}
function actorPose(index, point, at, reframe = false) {
  const target = '#actor-' + index;
  tl.set(target + ' .identity', { opacity: 1 }, at);
  if (reframe || !positions.has(index)) {
    tl.set(target, { x: point.x - 105, y: point.y - 150, scale: point.scale, opacity: 0, zIndex: point.y }, at);
    tl.to(target, { opacity: 1, duration: .25 }, at + .08);
  } else tl.to(target, { x: point.x - 105, y: point.y - 150, scale: point.scale, opacity: 1, zIndex: point.y, duration: .42 }, at);
  positions.set(index, point);
}
function walk(index, destination, at, entering) {
  const target = '#actor-' + index;
  tl.set(target + ' .identity', { opacity: 0 }, at);
  if (entering) tl.set(target, { x: 320, y: 337, scale: .6, opacity: 1, zIndex: 650 }, at);
  tl.to(target, { x: destination.x - 105, y: destination.y - 150, scale: destination.scale, duration: .72, ease: 'power1.inOut' }, at);
  for (const [side, direction] of [['left', 1], ['right', -1]]) {
    tl.to(target + ' .leg-' + side, { rotation: direction * 18, svgOrigin: side === 'left' ? '39 128' : '61 128', duration: .09, repeat: 5, yoyo: true }, at + .03);
    tl.to(target + ' .leg-' + side, { rotation: 0, duration: .12 }, at + .65);
  }
  if (!entering) tl.to(target, { opacity: 0, duration: .18 }, at + .61);
  else {
    tl.set(target, { zIndex: destination.y }, at + .72);
    tl.to(target + ' .identity', { opacity: 1, duration: .18 }, at + .72);
  }
}
function microInteractions(beat, layout) {
  const at = beat.start, stop = at + beat.duration, active = beat.actor;
  for (const index of layout.keys()) {
    const state = recordedFaces.get(index) || 'neutral', eye = FACE_POSES[state][0];
    // Finite neutral blinks are presentation; expression changes require a source cue.
    for (let t = at + .9 + index % 3 * .23; t < stop - .5; t += 3.4) {
      tl.to('#actor-' + index + ' .eye', { attr: { ry: 1 }, duration: .055 }, t);
      tl.to('#actor-' + index + ' .eye', { attr: { ry: eye }, duration: .11 }, t + .055);
    }
    tl.to('#actor-' + index + ' .look', { x: 0, y: 0, duration: .2 }, stop - .4);
  }
  if (active < 0 || !layout.has(active)) return;
  const target = '#actor-' + active, state = beat.face || 'neutral';
  const recipient = beat.recipientIndexes.find(index => layout.has(index));
  const direction = recipient === undefined ? 0 : Math.sign(layout.get(recipient).x - layout.get(active).x);
  tl.to(target + ' .look', { x: direction * 3, y: 0, duration: .2 }, at + .15);
  if (recipient !== undefined) tl.to('#actor-' + recipient + ' .look', { x: -direction * 2, duration: .2 }, at + .3);
  const arousal = beat.emotion?.values?.arousal;
  const energy = typeof arousal === 'number' ? Math.max(.2, Math.min(1, arousal)) : .35;
  const pose = state === 'worried' ? [-102, 102] : state === 'angry' ? [-30, 30] : [8, -8];
  tl.to(target + ' .arm-left', { rotation: pose[0], svgOrigin: '31 101', duration: .3 }, at + .12);
  tl.to(target + ' .arm-right', { rotation: pose[1], svgOrigin: '69 101', duration: .3 }, at + .12);
  if (beat.kind === 'message') {
    const side = direction < 0 ? 'left' : 'right', gesture = direction < 0 ? 65 : -65;
    tl.to(target + ' .arm-' + side, { rotation: gesture * (.65 + energy * .35), duration: .23 }, at + .38);
    tl.to(target + ' .head', { rotation: direction * 3, svgOrigin: '50 48', duration: .28 }, at + .3);
    tl.to(target + ' .mouth', { opacity: 0, duration: .08 }, at + .5);
    tl.to(target + ' .gasp', { opacity: 1, attr: { ry: 2.3 }, duration: .1 }, at + .5);
    tl.to(target + ' .gasp', { attr: { ry: 5 }, duration: .14, repeat: Math.max(0, Math.floor((beat.duration - 1.35) / .14) - 1), yoyo: true }, at + .6);
    expression(active, state, stop - .42);
  }
  if (state === 'angry' || state === 'shock') {
    tl.to(target + ' .accent', { opacity: .8, duration: .12 }, at + .15);
    tl.to(target + ' .accent', { opacity: 0, duration: .3 }, at + .7);
  }
  if (beat.stageAction?.kind === 'invite') tl.to(target + ' .arm-left', { rotation: 90, svgOrigin: '31 101', duration: .3 }, at + .35);
  tl.to(target + ' .head', { rotation: 0, duration: .22 }, stop - .4);
  tl.to(target + ' .arm-left', { rotation: 0, duration: .22 }, stop - .4);
  tl.to(target + ' .arm-right', { rotation: 0, duration: .22 }, stop - .4);
}
