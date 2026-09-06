import { useCallback, useEffect, useRef, useState } from "react";
import { normalize, shortestTurn, type LatLon } from "./geo";

export interface Position {
  coords: LatLon | null;
  accuracy: number | null;
  /** Course over ground, degrees from true north. Null when stationary. */
  heading: number | null;
  speed: number | null;
  error: string | null;
}

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 2_000,
  timeout: 20_000,
};

/** Watches this device's own position for as long as the component is mounted. */
export function useGeolocation(): Position {
  const [state, setState] = useState<Position>({
    coords: null,
    accuracy: null,
    heading: null,
    speed: null,
    error: null,
  });

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setState((prev) => ({ ...prev, error: "This device has no location service." }));
      return;
    }

    const id = navigator.geolocation.watchPosition(
      ({ coords }) =>
        setState({
          coords: { lat: coords.latitude, lon: coords.longitude },
          accuracy: coords.accuracy,
          heading: coords.heading ?? null,
          speed: coords.speed ?? null,
          error: null,
        }),
      (error) =>
        setState((prev) => ({
          ...prev,
          error:
            error.code === error.PERMISSION_DENIED
              ? "Location permission denied."
              : "Couldn't get a location fix.",
        })),
      GEO_OPTIONS,
    );

    return () => navigator.geolocation.clearWatch(id);
  }, []);

  return state;
}

type OrientationPermission = "unknown" | "prompt" | "granted" | "denied" | "unsupported";

export interface Heading {
  /**
   * Where the top of the phone points, degrees from true north — throttled,
   * for anything that renders. Use `live` for animation.
   */
  degrees: number | null;
  /**
   * The same reading at full rate, without re-rendering. The sensor fires at
   * ~60Hz and putting every sample in state re-renders the whole screen for a
   * fraction of a degree, so animation loops read this instead.
   */
  live: React.MutableRefObject<number | null>;
  permission: OrientationPermission;
  request: () => Promise<void>;
}

/** How often the throttled heading reaches React. Text doesn't need 60Hz. */
const HEADING_STATE_INTERVAL_MS = 160;

/** iOS gates the magnetometer behind a call made from a user gesture. */
type PermissionCapableDeviceOrientation = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

/**
 * The device's compass heading. Prefers `deviceorientationabsolute` (Android,
 * true north) and falls back to Safari's `webkitCompassHeading`.
 */
export function useDeviceHeading(): Heading {
  const [degrees, setDegrees] = useState<number | null>(null);
  const [permission, setPermission] = useState<OrientationPermission>("unknown");
  const listening = useRef(false);
  const live = useRef<number | null>(null);
  const lastPublished = useRef(0);

  const listen = useCallback(() => {
    if (listening.current) return;
    listening.current = true;

    const handle = (event: DeviceOrientationEvent) => {
      // Safari reports a ready-made compass heading; elsewhere alpha is
      // anticlockwise from north, and only trustworthy when absolute.
      const webkitHeading = (event as DeviceOrientationEvent & { webkitCompassHeading?: number })
        .webkitCompassHeading;

      let heading: number | null = null;
      if (typeof webkitHeading === "number" && !Number.isNaN(webkitHeading)) {
        heading = webkitHeading;
      } else if (event.absolute && event.alpha !== null) {
        heading = 360 - event.alpha;
      }
      if (heading === null) return;

      // Keep pointing the same way in the world when the screen rotates.
      const corrected = normalize(heading + (screen.orientation?.angle ?? 0));
      live.current = corrected;

      const now = performance.now();
      if (now - lastPublished.current >= HEADING_STATE_INTERVAL_MS) {
        lastPublished.current = now;
        setDegrees(corrected);
        setPermission("granted");
      }
    };

    window.addEventListener("deviceorientationabsolute", handle as EventListener);
    window.addEventListener("deviceorientation", handle as EventListener);
  }, []);

  const request = useCallback(async () => {
    const constructor = DeviceOrientationEvent as PermissionCapableDeviceOrientation;
    if (typeof constructor?.requestPermission === "function") {
      try {
        const result = await constructor.requestPermission();
        setPermission(result === "granted" ? "granted" : "denied");
        if (result !== "granted") return;
      } catch {
        setPermission("denied");
        return;
      }
    }
    listen();
  }, [listen]);

  useEffect(() => {
    if (typeof DeviceOrientationEvent === "undefined") {
      setPermission("unsupported");
      return;
    }
    // Where no explicit grant is needed (Android, desktop) just start listening;
    // `permission` only flips to granted once a reading actually arrives.
    const constructor = DeviceOrientationEvent as PermissionCapableDeviceOrientation;
    if (typeof constructor.requestPermission === "function") {
      setPermission("prompt");
    } else {
      listen();
    }
  }, [listen]);

  return { degrees, live, permission, request };
}

/** One dial angle to ease towards its target. */
export interface AngleTarget {
  element: SVGGraphicsElement | null;
  /** Degrees. Null parks the element where it is. */
  degrees: number | null;
  /** Rotation centre in the SVG's own user units. */
  origin: [number, number];
}

/** Covering half the remaining gap this often reads as responsive but never jittery. */
const HALF_LIFE_MS = 90;
/** Below this, snap: sub-degree easing is invisible and keeps the loop hot. */
const SETTLED_DEG = 0.05;

/**
 * Eases dial angles towards their targets on every frame, writing the SVG
 * `transform` attribute directly.
 *
 * Rotation is deliberately kept out of React state: at 60fps it would re-render
 * the whole screen for a movement of a fraction of a degree. Turns always take
 * the short way round, so a bearing crossing north doesn't spin the dial.
 */
export function useAngleDriver(targets: () => AngleTarget[]): void {
  const latest = useRef(targets);
  const current = useRef(new Map<SVGGraphicsElement, number>());

  // Refreshed after every commit rather than during render, so the frame loop
  // always reads current targets without writing a ref mid-render.
  useEffect(() => {
    latest.current = targets;
  });

  useEffect(() => {
    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const elapsed = Math.min(now - last, 100);
      last = now;

      for (const { element, degrees, origin } of latest.current()) {
        if (!element || degrees === null) continue;

        const previous = current.current.get(element);
        let next: number;
        if (previous === undefined) {
          next = degrees; // First reading lands where it belongs, no sweep from zero.
        } else {
          const delta = shortestTurn(previous, degrees);
          next =
            Math.abs(delta) < SETTLED_DEG
              ? degrees
              : normalize(previous + delta * (1 - 2 ** (-elapsed / HALF_LIFE_MS)));
        }

        current.current.set(element, next);
        element.setAttribute("transform", `rotate(${next.toFixed(2)} ${origin[0]} ${origin[1]})`);
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
}
