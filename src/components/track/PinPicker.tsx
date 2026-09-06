import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LatLon } from "./geo";

/** Close enough to read doorways and stall numbers. */
const PICK_ZOOM = 19;

interface PinPickerProps {
  /** Where to open the map. Usually the current GPS fix. */
  start: LatLon | null;
  onSave: (point: LatLon) => void;
  onCancel: () => void;
}

/**
 * Drop an exact point by hand, for when GPS is too vague to be useful — inside
 * a building, or picking one stall out of a market row.
 *
 * The crosshair is fixed to the centre of the frame and the map moves under it,
 * which is far steadier on a phone than trying to drag a pin onto a target.
 */
export default function PinPicker({ start, onSave, onCancel }: PinPickerProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const [center, setCenter] = useState<LatLon | null>(start);

  useEffect(() => {
    if (!container.current || map.current) return;

    const instance = L.map(container.current, {
      zoomControl: false,
      attributionControl: true,
      center: [start?.lat ?? 13.7563, start?.lon ?? 100.5018],
      zoom: start ? PICK_ZOOM : 13,
      // Fractional zoom makes fine framing possible with a pinch.
      zoomSnap: 0.25,
      wheelPxPerZoomLevel: 90,
    });

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      maxNativeZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(instance);

    const report = () => {
      const point = instance.getCenter();
      setCenter({ lat: point.lat, lon: point.lng });
    };
    instance.on("move", report);
    report();

    map.current = instance;
    requestAnimationFrame(() => instance.invalidateSize());

    return () => {
      instance.off("move", report);
      instance.remove();
      map.current = null;
    };
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <div ref={container} className="absolute inset-0" />

        {/*
          Crosshair. Pointer-events off so it never eats a pan, and above
          Leaflet's panes — the container makes no stacking context, so its
          z-index 400-600 layers would otherwise paint straight over this.
        */}
        <div className="pointer-events-none absolute inset-0 z-[1200] grid place-items-center">
          <svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true">
            <circle cx="36" cy="36" r="22" fill="none" stroke="var(--beacon)" strokeWidth="2.5" />
            <circle cx="36" cy="36" r="3" fill="var(--beacon)" />
            <path
              d="M36 2 V16 M36 56 V70 M2 36 H16 M56 36 H70"
              stroke="var(--beacon)"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <button
          type="button"
          onClick={() => map.current?.setZoom(PICK_ZOOM)}
          className="track-label absolute right-4 top-4 z-[1200] rounded-full border border-[var(--hairline)] bg-black/60 px-4 py-3 text-[9px] font-bold backdrop-blur-sm"
        >
          Zoom in
        </button>
      </div>

      <div className="shrink-0 space-y-3 px-5 pb-4 pt-3">
        <p className="track-label text-center text-[10px] font-medium text-[var(--muted)]">
          {center ? `${center.lat.toFixed(6)}, ${center.lon.toFixed(6)}` : "Locating…"}
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="track-label flex-1 rounded-2xl border border-[var(--hairline)] py-6 text-[11px] font-bold text-[var(--muted)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!center}
            onClick={() => center && onSave(center)}
            className="track-label flex-1 rounded-2xl bg-[var(--ink)] py-6 text-[11px] font-bold text-[#12102e] disabled:opacity-40"
          >
            Save this spot
          </button>
        </div>
      </div>
    </div>
  );
}
