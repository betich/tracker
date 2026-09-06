import { TenantProvider } from "./tenant";
import AdminApp from "./AdminApp";

/** The broadcasting device, for the deployment's own tracker or a hosted one. */
export default function AdminRoot() {
  return (
    <TenantProvider>
      <AdminApp />
    </TenantProvider>
  );
}
