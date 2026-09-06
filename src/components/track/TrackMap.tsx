import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { LatLon } from "./geo";
import { config } from "@config";

/** Leaflet's default marker images break under bundlers, so both pins are markup. */
const dot = (className: string, html: string) =>
  L.divIcon({ className: "", html: `<div class="${className}">${html}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] });

const meIcon = dot(
  "relative h-[22px] w-[22px] rounded-full border-2 border-[var(--ink)] bg-[var(--ground)]",
  `<span class="absolute inset-[3px] rounded-full bg-[var(--ink)] opacity-60"></span>`,
);

const bunditIcon = dot(
  "relative h-[22px] w-[22px]",
  `<span class="track-pulse absolute inset-0 rounded-full bg-[var(--ink)]"></span>
   <span class="absolute inset-[3px] rounded-full bg-[var(--ink)] shadow-[0_0_18px_rgba(255,255,255,0.55)]"></span>`,
);

interface TrackMapProps {
  me: LatLon | null;
  bundit: LatLon | null;
  /** Re-fits the view when this changes, so switching tabs re-frames the pair. */
  fitKey: number;
}

/**
 * The plain-map view: both pins and the line between them. It frames the pair
 * on mount and whenever `fitKey` changes, then leaves the view alone so panning
 * and zooming aren't yanked back on every position update.
 */
export default function TrackMap({ me, bundit, fitKey }: TrackMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const meMarker = useRef<L.Marker | null>(null);
  const bunditMarker = useRef<L.Marker | null>(null);
  const link = useRef<L.Polyline | null>(null);

  useEffect(() => {
    if (!container.current || map.current) return;

    const instance = L.map(container.current, {
      zoomControl: true,
      // Bottom right belongs to the contact buttons, and attribution must stay visible.
      attributionControl: false,
      center: [
        me?.lat ?? bundit?.lat ?? config.mapFallbackCenter.lat,
        me?.lon ?? bundit?.lon ?? config.mapFallbackCenter.lon,
      ],
      zoom: 16,
    });

    L.control.attribution({ position: "bottomleft", prefix: false }).addTo(instance);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(instance);

    map.current = instance;
    // The container is sized by flexbox; Leaflet needs a nudge once it settles.
    requestAnimationFrame(() => instance.invalidateSize());

    return () => {
      instance.remove();
      map.current = null;
      meMarker.current = null;
      bunditMarker.current = null;
      link.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    const place = (
      ref: React.MutableRefObject<L.Marker | null>,
      point: LatLon | null,
      icon: L.DivIcon,
      title: string,
    ) => {
      if (!point) {
        if (ref.current) {
          ref.current.remove();
          ref.current = null;
        }
        return;
      }
      const position: L.LatLngExpression = [point.lat, point.lon];
      if (ref.current) ref.current.setLatLng(position);
      else ref.current = L.marker(position, { icon, title, keyboard: false }).addTo(instance);
    };

    place(meMarker, me, meIcon, "You");
    place(bunditMarker, bundit, bunditIcon, config.subject);

    if (me && bundit) {
      const path: L.LatLngExpression[] = [
        [me.lat, me.lon],
        [bundit.lat, bundit.lon],
      ];
      if (link.current) link.current.setLatLngs(path);
      else
        link.current = L.polyline(path, {
          color: "var(--ink)",
          weight: 2,
          opacity: 0.55,
          dashArray: "2 8",
          lineCap: "round",
        }).addTo(instance);
    } else if (link.current) {
      link.current.remove();
      link.current = null;
    }
  }, [me?.lat, me?.lon, bundit?.lat, bundit?.lon]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    instance.invalidateSize();

    if (me && bundit) {
      instance.fitBounds(
        L.latLngBounds([me.lat, me.lon], [bundit.lat, bundit.lon]),
        { padding: [64, 64], maxZoom: 17 },
      );
    } else {
      const only = me ?? bundit;
      if (only) instance.setView([only.lat, only.lon], 16);
    }
  }, [fitKey]);

  return <div ref={container} className="absolute inset-0" />;
}
