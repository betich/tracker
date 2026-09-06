import { useEffect, useLayoutEffect, useRef } from "react";
import "./SpinnyViewer.css";

const FRAME_COUNT = 9;

/** Horizontal drag distance, in px, that advances the sequence by one frame. */
const PIXELS_PER_FRAME = 42;
/** Only pointer samples this recent feed the release velocity. */
const VELOCITY_WINDOW_MS = 90;

/*
 * Release is two phases. First a coast: velocity decays exponentially, with a time
 * constant that grows with how hard it was thrown, so a hard swipe carries like a
 * heavy flywheel instead of travelling merely proportionally further. Then, once it
 * has slowed to a crawl, a spring takes over and eases it onto a whole frame.
 */

/** Coast time constant for a gentle release, and for one thrown at FLYWHEEL_SPEED. */
const COAST_MIN_SECONDS = 0.22;
const COAST_MAX_SECONDS = 0.95;
/** Release speed, in frames/second, at which the coast is at its longest. */
const FLYWHEEL_SPEED = 38;
/** Ceiling on coast distance, so a violent flick still comes to rest. */
const MAX_COAST_FRAMES = FRAME_COUNT * 3;
/** Coasting hands over to the settle spring below this speed, in frames/second. */
const SETTLE_SPEED = 5.5;
/** How far ahead the spring aims when it takes over, in seconds of travel. */
const SETTLE_LEAD_SECONDS = 0.11;

/** Settle spring: stiffness, and damping at a ratio of ~0.65 for a soft landing. */
const SPRING_STIFFNESS = 140;
const SPRING_DAMPING = 15.4;
/** Fixed physics substep, so the spring feels identical at 60Hz and 120Hz. */
const SUBSTEP_SECONDS = 1 / 240;
/** Below this displacement and speed the spring has arrived. */
const REST_DISTANCE = 0.001;
const REST_SPEED = 0.05;
/** Longest frame gap we integrate, so a backgrounded tab does not jump on return. */
const MAX_TICK_SECONDS = 0.064;

/** Spin speed, in frames/second, at which neighbouring frames cross-fade fully. */
const BLEND_SPEED = 7;

const frames = Array.from({ length: FRAME_COUNT }, (_, index) => `/images/spinny/${index + 1}.webp`);

const wrapFrame = (frame: number) => ((frame % FRAME_COUNT) + FRAME_COUNT) % FRAME_COUNT;

const prefersReducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** After a drag or throw, leave the figure alone this long before the compass reclaims it. */
const HEADING_GRACE_MS = 4000;
/** Fraction of the remaining gap closed each frame at 60fps, easing the follow. */
const HEADING_EASE = 0.18;

interface SpinnyViewerProps {
  /**
   * Shrink to an ornament that fits a footer: no hint, no reserved page height,
   * and cropped into its container. The frames have no alpha, so a compact
   * viewer keeps its white ground and reads as a sticker on a dark surface.
   */
  compact?: boolean;
  /**
   * Live compass heading in degrees, as a ref written at sensor rate. When
   * present the figure turns with the phone — turn right and you walk around
   * him — while dragging still takes precedence for a few seconds afterwards.
   *
   * A ref rather than a prop value on purpose: the heading changes ~60 times a
   * second and re-rendering the portrait that often would be absurd.
   */
  headingRef?: React.MutableRefObject<number | null>;
}

export default function SpinnyViewer({ compact = false, headingRef }: SpinnyViewerProps = {}) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const imageRefs = useRef<(HTMLImageElement | null)[]>([]);

  /** Continuous frame position. Integers are exact frames; the fraction is in-between. */
  const position = useRef(0);
  /** Frames per second, signed. */
  const velocity = useRef(0);
  /** Coast time constant for the throw in progress, or null once the spring has it. */
  const coastTau = useRef<number | null>(null);
  /** Where the settle spring is pulling to — always a whole frame. */
  const target = useRef(0);
  const animation = useRef<number | null>(null);
  const lastTick = useRef(0);
  const drag = useRef<{ pointerId: number | null; lastX: number; samples: { time: number; position: number }[] }>({
    pointerId: null,
    lastX: 0,
    samples: [],
  });

  /** When the user last touched it; the compass waits this out before taking over. */
  const lastTouched = useRef(0);

  /** Show the nearest frame, ghosting the one we are turning into while moving. */
  function paint() {
    const nearest = Math.round(position.current);
    const offset = position.current - nearest;
    const speedBlend = Math.min(Math.abs(velocity.current) / BLEND_SPEED, 1);
    const ghostOpacity = Math.abs(offset) * speedBlend;
    const nearestIndex = wrapFrame(nearest);
    const ghostIndex = wrapFrame(nearest + Math.sign(offset));

    imageRefs.current.forEach((image, index) => {
      if (!image) return;
      const isGhost = index === ghostIndex && index !== nearestIndex;
      image.style.opacity = String(index === nearestIndex ? 1 : isGhost ? ghostOpacity : 0);
      image.style.zIndex = isGhost ? "1" : "0";
    });
  }

  // Frames are driven imperatively, so re-sync the DOM after any React render.
  useLayoutEffect(paint);

  function stopAnimation() {
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    animation.current = null;
  }

  function startAnimation() {
    stopAnimation();
    lastTick.current = performance.now();
    animation.current = requestAnimationFrame(tick);
  }

  /** Exponential decay, integrated exactly, so the glide is frame-rate independent. */
  function coast(elapsed: number, tau: number) {
    const decay = Math.exp(-elapsed / tau);
    position.current += velocity.current * tau * (1 - decay);
    velocity.current *= decay;

    if (Math.abs(velocity.current) <= SETTLE_SPEED) {
      coastTau.current = null;
      target.current = Math.round(position.current + velocity.current * SETTLE_LEAD_SECONDS);
    }
  }

  function spring(elapsed: number) {
    let remaining = elapsed;
    while (remaining > 0) {
      const step = Math.min(SUBSTEP_SECONDS, remaining);
      remaining -= step;
      const pull = -SPRING_STIFFNESS * (position.current - target.current);
      const damping = -SPRING_DAMPING * velocity.current;
      velocity.current += (pull + damping) * step;
      position.current += velocity.current * step;
    }
  }

  function tick(now: number) {
    const elapsed = Math.min((now - lastTick.current) / 1000, MAX_TICK_SECONDS);
    lastTick.current = now;

    if (coastTau.current !== null) {
      coast(elapsed, coastTau.current);
    } else {
      spring(elapsed);
      if (Math.abs(position.current - target.current) < REST_DISTANCE && Math.abs(velocity.current) < REST_SPEED) {
        // Land exactly on the frame, and keep the running position small.
        position.current = wrapFrame(target.current);
        velocity.current = 0;
        animation.current = null;
        paint();
        return;
      }
    }

    paint();
    animation.current = requestAnimationFrame(tick);
  }

  /** Spring straight onto a whole frame, carrying whatever velocity we already have. */
  function settleTo(frame: number) {
    coastTau.current = null;
    target.current = frame;

    if (prefersReducedMotion()) {
      stopAnimation();
      position.current = wrapFrame(frame);
      velocity.current = 0;
      paint();
      return;
    }

    startAnimation();
  }

  /** Let go: coast on the momentum of the throw, then settle. */
  function release() {
    const speed = Math.abs(velocity.current);

    if (speed <= SETTLE_SPEED || prefersReducedMotion()) {
      settleTo(Math.round(position.current + velocity.current * SETTLE_LEAD_SECONDS));
      return;
    }

    // Heavier throws hold their speed for longer, then give it up gradually.
    const heft = Math.min(speed / FLYWHEEL_SPEED, 1);
    const tau = COAST_MIN_SECONDS + (COAST_MAX_SECONDS - COAST_MIN_SECONDS) * heft;
    // Cap the glide by braking sooner, so the throw still starts at full speed.
    coastTau.current = Math.min(tau, MAX_COAST_FRAMES / speed);
    startAnimation();
  }

  function dismissHint() {
    viewerRef.current?.classList.remove("is-hinting");
  }

  /*
   * Follow the compass. Runs its own loop rather than joining `tick`, because
   * that one is a physics simulation that ends at rest — this never ends, and
   * must yield to the physics whenever a throw is still playing out.
   */
  useEffect(() => {
    if (!headingRef) return;
    let frame = 0;

    const follow = () => {
      frame = requestAnimationFrame(follow);

      const heading = headingRef.current;
      const idle = animation.current === null && drag.current.pointerId === null;
      if (heading === null || !idle || performance.now() - lastTouched.current < HEADING_GRACE_MS) return;

      // Turning right walks you around him, so the figure turns the other way.
      const wanted = -(heading / 360) * FRAME_COUNT;
      // Take the short way round: the seam between frame 8 and 0 is continuous.
      const delta = ((((wanted - position.current) % FRAME_COUNT) + FRAME_COUNT * 1.5) % FRAME_COUNT) - FRAME_COUNT / 2;
      if (Math.abs(delta) < 0.002) return;

      position.current += delta * HEADING_EASE;
      // paint() blends on velocity, so lend it the speed this frame implies.
      velocity.current = delta * HEADING_EASE * 60;
      paint();
    };

    frame = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(frame);
  }, [headingRef]);

  function beginDrag(x: number, pointerId: number) {
    lastTouched.current = performance.now();
    stopAnimation();
    coastTau.current = null;
    velocity.current = 0;
    drag.current = { pointerId, lastX: x, samples: [{ time: performance.now(), position: position.current }] };
    dismissHint();
  }

  function moveDrag(x: number) {
    const state = drag.current;
    position.current -= (x - state.lastX) / PIXELS_PER_FRAME;
    state.lastX = x;

    const now = performance.now();
    state.samples.push({ time: now, position: position.current });
    while (state.samples.length > 2 && now - state.samples[0].time > VELOCITY_WINDOW_MS) state.samples.shift();

    const oldest = state.samples[0];
    const span = (now - oldest.time) / 1000;
    velocity.current = span > 0 ? (position.current - oldest.position) / span : 0;
    paint();
  }

  function endDrag() {
    const samples = drag.current.samples;
    // A finger that came to rest before lifting should not fling.
    if (performance.now() - samples[samples.length - 1].time > VELOCITY_WINDOW_MS) velocity.current = 0;
    drag.current.pointerId = null;
    lastTouched.current = performance.now();
    release();
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (drag.current.pointerId !== null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    beginDrag(event.clientX, event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerId !== drag.current.pointerId) return;
    moveDrag(event.clientX);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerId !== drag.current.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    endDrag();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    lastTouched.current = performance.now();
    dismissHint();
    stopAnimation();
    velocity.current = 0;
    settleTo(Math.round(position.current) + (event.key === "ArrowLeft" ? 1 : -1));
  }

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    // touch-action alone still lets iOS start a rubber-band scroll mid-drag.
    const blockTouchScroll = (event: TouchEvent) => {
      if (drag.current.pointerId !== null) event.preventDefault();
    };
    viewer.addEventListener("touchmove", blockTouchScroll, { passive: false });

    return () => {
      viewer.removeEventListener("touchmove", blockTouchScroll);
      stopAnimation();
    };
  }, []);

  return (
    <div
      ref={viewerRef}
      className={`spinny-viewer${compact ? " is-compact" : " is-hinting"}`}
      role="img"
      aria-label="A portrait. Drag horizontally to turn it."
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      <div className="spinny-stage">
        <div className="spinny-figure">
          <div className="spinny-frame">
            {frames.map((src, index) => (
              <img
                key={src}
                ref={(element) => {
                  imageRefs.current[index] = element;
                }}
                src={src}
                alt=""
                width={394}
                height={876}
                draggable={false}
                style={{ opacity: index === 0 ? 1 : 0 }}
              />
            ))}
          </div>
        </div>
      </div>

      <p className="spinny-hint" aria-hidden="true">
        <span className="spinny-hint-arrow">&lsaquo;&lsaquo;&lsaquo;</span>
        drag to spin
        <span className="spinny-hint-arrow">&rsaquo;&rsaquo;&rsaquo;</span>
      </p>
    </div>
  );
}
