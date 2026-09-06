import { TenantProvider } from "./tenant";
import TrackApp from "./TrackApp";

/** The viewer, for both the deployment's own tracker and any hosted one. */
export default function TrackRoot() {
  return (
    <TenantProvider>
      <TrackApp />
    </TenantProvider>
  );
}
