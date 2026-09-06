import { forwardRef } from "react";

export const COMPASS_CENTER: [number, number] = [200, 200];

const [CX, CY] = COMPASS_CENTER;
const TICK_OUTER = 170;
const TICK_COUNT = 120; // One every 3°.
const CARDINALS: Array<{ label: string; at: number; turn: number }> = [
  { label: "N", at: 0, turn: 0 },
  { label: "E", at: 90, turn: 90 },
  { label: "S", at: 180, turn: 0 },
  { label: "W", at: 270, turn: -90 },
];

const NEEDLE_HEAD = "M 200 34 L 210 196 Q 200 203 190 196 Z";
const NEEDLE_TAIL = "M 200 322 L 209 204 Q 200 197 191 204 Z";

/** Half-width of the beacon wedge, in degrees. */
const BEACON_SPREAD = 15;
const BEACON_RADIUS = 168;
const BEACON_ARC_RADIUS = 178;

/** A point on a circle around the dial centre, measured from straight up. */
const onCircle = (degrees: number, radius: number): [number, number] => {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return [CX + radius * Math.cos(radians), CY + radius * Math.sin(radians)];
};

const [wedgeStartX, wedgeStartY] = onCircle(-BEACON_SPREAD, BEACON_RADIUS);
const [wedgeEndX, wedgeEndY] = onCircle(BEACON_SPREAD, BEACON_RADIUS);
const [arcStartX, arcStartY] = onCircle(-BEACON_SPREAD, BEACON_ARC_RADIUS);
const [arcEndX, arcEndY] = onCircle(BEACON_SPREAD, BEACON_ARC_RADIUS);

/** A pie slice from the centre out to the rim, opening toward the bundit. */
const BEACON_WEDGE = `M ${CX} ${CY} L ${wedgeStartX.toFixed(2)} ${wedgeStartY.toFixed(2)} A ${BEACON_RADIUS} ${BEACON_RADIUS} 0 0 1 ${wedgeEndX.toFixed(2)} ${wedgeEndY.toFixed(2)} Z`;
/** The bright cap on the rim, so the direction reads even at a glance. */
const BEACON_ARC = `M ${arcStartX.toFixed(2)} ${arcStartY.toFixed(2)} A ${BEACON_ARC_RADIUS} ${BEACON_ARC_RADIUS} 0 0 1 ${arcEndX.toFixed(2)} ${arcEndY.toFixed(2)}`;

interface CompassProps {
  ringRef: React.Ref<SVGGElement>;
  needleRef: React.Ref<SVGGElement>;
  /** False while there is no fix, or no location of our own to measure from. */
  hasTarget: boolean;
  /** True once the phone is pointed at the bundit; turns the cue green. */
  locked: boolean;
}

/**
 * A rotating compass card with a needle over it: the card carries true north,
 * the needle points at the bundit. Both groups are rotated from a rAF loop
 * outside React (see `useAngleDriver`), so this only draws the face.
 */
const Compass = forwardRef<SVGSVGElement, CompassProps>(function Compass(
  { ringRef, needleRef, hasTarget, locked },
  ref,
) {
  const cue = locked ? "var(--beacon-locked)" : "var(--beacon)";

  return (
    <svg ref={ref} viewBox="0 0 400 400" className="h-full w-full" role="img" aria-hidden="true">
      {/* Lubber line: fixed to the screen, marking straight ahead. */}
      <path d="M 200 6 L 209 24 L 191 24 Z" fill="var(--ink)" opacity={0.9} />

      <g ref={ringRef} style={{ opacity: hasTarget ? 1 : 0.5, transition: "opacity 400ms ease" }}>
        {Array.from({ length: TICK_COUNT }, (_, index) => {
          const angle = index * (360 / TICK_COUNT);
          const major = angle % 15 === 0;
          const radians = ((angle - 90) * Math.PI) / 180;
          const inner = major ? 144 : 154;
          return (
            <line
              key={angle}
              x1={CX + inner * Math.cos(radians)}
              y1={CY + inner * Math.sin(radians)}
              x2={CX + TICK_OUTER * Math.cos(radians)}
              y2={CY + TICK_OUTER * Math.sin(radians)}
              stroke={major ? "var(--tick-major)" : "var(--tick)"}
              strokeWidth={major ? 3 : 1.7}
            />
          );
        })}

        {CARDINALS.map(({ label, at, turn }) => {
          const radians = ((at - 90) * Math.PI) / 180;
          const x = CX + 112 * Math.cos(radians);
          const y = CY + 112 * Math.sin(radians);
          return (
            <text
              key={label}
              x={x}
              y={y}
              transform={`rotate(${turn} ${x} ${y})`}
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--ink)"
              fontSize={44}
              fontWeight={700}
              fontFamily="inherit"
            >
              {label}
            </text>
          );
        })}
      </g>

      {/*
        The beacon rides inside the needle group, so it tracks the bundit for
        free: in this group's frame, "up" is always the direction to walk.
      */}
      <g ref={needleRef} style={{ opacity: hasTarget ? 1 : 0, transition: "opacity 400ms ease" }}>
        <path d={BEACON_WEDGE} fill={cue} opacity={locked ? 0.24 : 0.16} style={{ transition: "fill 300ms ease, opacity 300ms ease" }} />
        <path
          d={BEACON_ARC}
          fill="none"
          stroke={cue}
          strokeWidth={7}
          strokeLinecap="round"
          style={{ transition: "stroke 300ms ease" }}
        />
        <path d={NEEDLE_TAIL} fill="var(--needle-tail)" />
        <path d={NEEDLE_HEAD} fill={locked ? cue : "var(--ink)"} style={{ transition: "fill 300ms ease" }} />
      </g>

      <circle cx={CX} cy={CY} r={7} fill="var(--ground)" />
    </svg>
  );
});

export default Compass;
